const crypto = require('crypto');
const Loyalty = require('../models/Loyalty');
const LoyaltySettings = require('../models/LoyaltySettings');
const DiscountCode = require('../models/DiscountCode');

const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const computePointsCost = (amount, pointValue) => {
  const value = Number(pointValue) || 0.01;
  const dollars = Math.max(0, Number(amount) || 0);
  return Math.max(1, Math.ceil(dollars / value));
};

module.exports = {
  async showRewards(req, res) {
    if (!req.session.user) return res.redirect('/login');
    const userId = req.session.user.id;

    try {
      const [balance, settings, templates, userVouchers] = await Promise.all([
        Loyalty.getBalance(userId),
        LoyaltySettings.getSettings(),
        DiscountCode.listTemplates(),
        DiscountCode.listUserVouchers(userId)
      ]);

      const pointValue = Number(settings?.point_value) || 0.01;
      const availableTemplates = (templates || []).filter(t => t.is_active && t.discount_type === 'fixed');
      const vouchers = (userVouchers || []).map(voucher => ({
        ...voucher,
        used: Number(voucher.user_used) > 0
      }));

      const templateCards = availableTemplates.map(template => ({
        ...template,
        points_cost: computePointsCost(template.discount_value, pointValue)
      }));

      res.render('rewards', {
        user: req.session.user,
        pointsBalance: Number(balance) || 0,
        pointValue,
        templates: templateCards,
        vouchers,
        messages: req.flash('success'),
        errors: req.flash('error')
      });
    } catch (err) {
      console.error('Error loading rewards:', err);
      req.flash('error', 'Unable to load rewards right now.');
      res.redirect('/shopping');
    }
  },

  async redeemVoucher(req, res) {
    if (!req.session.user) return res.redirect('/login');
    const userId = req.session.user.id;
    const templateId = Number(req.body.templateId);
    if (!templateId) {
      req.flash('error', 'Select a voucher to redeem.');
      return res.redirect('/rewards');
    }

    try {
      const settings = await LoyaltySettings.getSettings();
      const template = await DiscountCode.getById(templateId);

      if (!template || !template.is_template || !template.is_active) {
        req.flash('error', 'Voucher is not available.');
        return res.redirect('/rewards');
      }
      if (template.discount_type !== 'fixed') {
        req.flash('error', 'Only fixed-amount vouchers can be redeemed.');
        return res.redirect('/rewards');
      }

      const pointValue = Number(settings?.point_value) || 0.01;
      const pointsCost = computePointsCost(template.discount_value, pointValue);

      await Loyalty.debit(userId, pointsCost);

      const code = `VCH-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      await DiscountCode.createUserVoucherFromTemplate(templateId, userId, code);

      req.flash('success', `Voucher redeemed for ${pointsCost} points.`);
      res.redirect('/rewards');
    } catch (err) {
      if (err.code === 'INSUFFICIENT_POINTS') {
        req.flash('error', 'Not enough points to redeem this voucher.');
        return res.redirect('/rewards');
      }
      console.error('Voucher redemption failed:', err);
      req.flash('error', 'Unable to redeem voucher right now.');
      res.redirect('/rewards');
    }
  }
};
