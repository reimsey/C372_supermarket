const DiscountCode = require('../models/DiscountCode');

const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const computeSubtotalFromCart = (cart) => {
  return roundMoney(
    (cart || []).reduce((sum, item) => {
      const price = Number(item.price) || 0;
      const qty = Number(item.quantity) || 0;
      return sum + price * qty;
    }, 0)
  );
};

const normalizeCodes = (codes) => {
  const list = Array.isArray(codes) ? codes : [];
  const seen = new Set();
  const normalized = [];
  list.forEach((code) => {
    const next = DiscountCode.normalizeCode(code);
    if (!next || seen.has(next)) return;
    seen.add(next);
    normalized.push(next);
  });
  return normalized;
};

const isWithinDates = (row) => {
  const now = new Date();
  if (row.starts_at && new Date(row.starts_at) > now) return false;
  if (row.expires_at && new Date(row.expires_at) < now) return false;
  return true;
};

const computeDiscountAmount = (row, eligibleSubtotal) => {
  if (eligibleSubtotal <= 0) return 0;
  let amount = 0;
  if (row.discount_type === 'fixed') {
    amount = Math.min(Number(row.discount_value) || 0, eligibleSubtotal);
  } else {
    const percent = Math.max(0, Number(row.discount_value) || 0);
    amount = eligibleSubtotal * (percent / 100);
    if (row.max_discount) {
      amount = Math.min(amount, Number(row.max_discount) || 0);
    }
  }
  return roundMoney(Math.max(0, amount));
};

const computeEligibleSubtotal = (cart, productIds) => {
  const allowed = new Set((productIds || []).map(id => Number(id)));
  return roundMoney(
    (cart || []).reduce((sum, item) => {
      if (!allowed.has(Number(item.productId))) return sum;
      const price = Number(item.price) || 0;
      const qty = Number(item.quantity) || 0;
      return sum + price * qty;
    }, 0)
  );
};

const sortAutoApplyCandidates = (a, b) => {
  if (b.amount !== a.amount) return b.amount - a.amount;
  const aExpiry = a.expires_at ? new Date(a.expires_at).getTime() : Number.MAX_SAFE_INTEGER;
  const bExpiry = b.expires_at ? new Date(b.expires_at).getTime() : Number.MAX_SAFE_INTEGER;
  return aExpiry - bExpiry;
};

const validateStacking = (rows) => {
  if (!rows || rows.length <= 1) return { ok: true };
  const hasNonStackable = rows.some(row => !row.stackable);
  if (hasNonStackable) {
    return { ok: false, message: 'This voucher cannot be stacked with another.' };
  }
  return { ok: true };
};

const evaluateCodeForCart = async (row, userId, cart, subtotal, options = {}) => {
  if (!row || !row.is_active) return { eligible: false, reason: 'Voucher is inactive.' };
  if (row.is_template) return { eligible: false, reason: 'Voucher template cannot be redeemed directly.' };
  if (row.user_id && Number(row.user_id) !== Number(userId)) {
    return { eligible: false, reason: 'Voucher is not assigned to your account.' };
  }
  if (!row.user_id && !options.allowPublic) {
    return { eligible: false, reason: 'Voucher is not available for your account.' };
  }
  if (!isWithinDates(row)) return { eligible: false, reason: 'Voucher is expired or not active yet.' };

  const usage = await DiscountCode.getUsageCounts(row.id, userId);
  if (row.total_usage_limit !== null && usage.total >= row.total_usage_limit) {
    return { eligible: false, reason: 'Voucher usage limit reached.' };
  }
  if (row.per_user_limit !== null && usage.user >= row.per_user_limit) {
    return { eligible: false, reason: 'You have reached the usage limit for this voucher.' };
  }

  let eligibleSubtotal = subtotal;
  if (row.scope === 'item') {
    // Item-specific vouchers are deprecated; treat as general.
    eligibleSubtotal = subtotal;
  }

  if (eligibleSubtotal <= 0) {
    return { eligible: false, reason: 'No eligible items for this voucher.' };
  }

  const minSpend = Number(row.min_spend) || 0;
  if (eligibleSubtotal < minSpend) {
    return { eligible: false, reason: `Minimum spend $${minSpend.toFixed(2)} not met.` };
  }

  const amount = computeDiscountAmount(row, eligibleSubtotal);
  if (amount <= 0) return { eligible: false, reason: 'Voucher not applicable.' };

  return { eligible: true, amount, eligibleSubtotal };
};

const evaluateCartDiscounts = async (userId, cart, requestedCodes = [], options = {}) => {
  const subtotal = computeSubtotalFromCart(cart);
  const normalizedCodes = normalizeCodes(requestedCodes);
  const applied = [];
  const errors = [];

  const rows = await Promise.all(normalizedCodes.map(code => DiscountCode.getByCode(code)));
  const validRows = [];

  rows.forEach((row, idx) => {
    if (!row) {
      errors.push(`Code ${normalizedCodes[idx]} not found.`);
      return;
    }
    validRows.push(row);
  });

  const stackingCheck = validateStacking(validRows);
  if (!stackingCheck.ok) {
    errors.push(stackingCheck.message);
  } else {
    for (const row of validRows) {
      const eligibility = await evaluateCodeForCart(row, userId, cart, subtotal, options);
      if (!eligibility.eligible) {
        errors.push(`${row.code}: ${eligibility.reason}`);
        continue;
      }
      applied.push({
        id: row.id,
        code: row.code,
        type: row.type,
        scope: row.scope,
        stackable: Boolean(row.stackable),
        amount: eligibility.amount,
        description: row.description,
        auto_apply: Boolean(row.auto_apply),
        expires_at: row.expires_at
      });
    }
  }

  const autoCandidates = await DiscountCode.listAutoApplyActive();
  const autoEvaluated = [];
  for (const row of autoCandidates) {
    if (applied.some(code => code.id === row.id)) continue;
    const eligibility = await evaluateCodeForCart(row, userId, cart, subtotal, options);
    if (!eligibility.eligible) continue;
    autoEvaluated.push({
      row,
      amount: eligibility.amount
    });
  }

  autoEvaluated.sort((a, b) => sortAutoApplyCandidates(
    { amount: a.amount, expires_at: a.row.expires_at },
    { amount: b.amount, expires_at: b.row.expires_at }
  ));

  let autoApplied = null;
  if (autoEvaluated.length > 0) {
    const candidate = autoEvaluated[0].row;
    const candidateRow = {
      id: candidate.id,
      code: candidate.code,
      type: candidate.type,
      scope: candidate.scope,
      stackable: Boolean(candidate.stackable),
      amount: autoEvaluated[0].amount,
      description: candidate.description,
      auto_apply: true,
      expires_at: candidate.expires_at
    };

    const combined = applied.concat(candidateRow);
    const stacking = validateStacking(combined.map(item => ({ stackable: item.stackable })));
    if (stacking.ok) {
      autoApplied = candidateRow;
    }
  }

  const allApplied = autoApplied ? applied.concat(autoApplied) : applied;
  let totalDiscount = roundMoney(allApplied.reduce((sum, item) => sum + (Number(item.amount) || 0), 0));
  totalDiscount = Math.min(totalDiscount, subtotal);
  const finalTotal = roundMoney(subtotal - totalDiscount);

  return {
    subtotal,
    applied,
    autoApplied,
    totalDiscount,
    finalTotal,
    errors,
    normalizedCodes
  };
};

module.exports = {
  evaluateCartDiscounts,
  normalizeCodes,
  computeSubtotalFromCart
};
