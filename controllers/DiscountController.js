const DiscountCode = require('../models/DiscountCode');
const LoyaltySettings = require('../models/LoyaltySettings');
const crypto = require('crypto');

const parseBool = (value) => value === '1' || value === 'on' || value === true;

const parseNumber = (value, fallback = null) => {
  const num = Number(value);
  if (Number.isNaN(num)) return fallback;
  return num;
};

const parseDate = (value) => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date;
};

const buildPayload = (body) => ({
  type: body.type,
  scope: 'general',
  discount_type: body.discount_type,
  discount_value: parseNumber(body.discount_value, 0),
  min_spend: parseNumber(body.min_spend, 0),
  max_discount: parseNumber(body.max_discount, null),
  starts_at: parseDate(body.starts_at),
  expires_at: parseDate(body.expires_at),
  total_usage_limit: parseNumber(body.total_usage_limit, null),
  per_user_limit: parseNumber(body.per_user_limit, null),
  stackable: parseBool(body.stackable),
  auto_apply: parseBool(body.auto_apply),
  is_active: parseBool(body.is_active),
  description: body.description
});

const generateCode = async () => {
  for (let i = 0; i < 5; i += 1) {
    const code = `VCH-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    // Ensure uniqueness
    // eslint-disable-next-line no-await-in-loop
    const existing = await DiscountCode.getByCode(code);
    if (!existing) return code;
  }
  return `VCH-${Date.now()}`;
};

module.exports = {
  async list(req, res) {
    try {
      const [codes, settings] = await Promise.all([
        DiscountCode.listTemplates(),
        LoyaltySettings.getSettings()
      ]);
      res.render('adminDiscounts', {
        user: req.session.user,
        codes,
        pointValue: Number(settings?.point_value) || 0.01,
        messages: req.flash('success'),
        errors: req.flash('error')
      });
    } catch (err) {
      console.error('Error loading vouchers:', err);
      res.status(500).send('Error loading vouchers');
    }
  },

  async showNew(req, res) {
    try {
      res.render('adminDiscountForm', {
        user: req.session.user,
        form: {},
        isEdit: false,
        messages: req.flash('success'),
        errors: req.flash('error')
      });
    } catch (err) {
      console.error('Error loading voucher form:', err);
      res.status(500).send('Error loading voucher form');
    }
  },

  async create(req, res) {
    try {
      const payload = buildPayload(req.body);
      payload.code = await generateCode();
      payload.type = 'voucher';
      payload.discount_type = 'fixed';
      payload.stackable = false;
      payload.auto_apply = false;
      payload.is_template = true;
      payload.user_id = null;
      const id = await DiscountCode.create(payload);
      req.flash('success', 'Voucher created');
      res.redirect('/admin/discounts');
    } catch (err) {
      console.error('Error creating voucher:', err);
      req.flash('error', err.message || 'Error creating voucher');
      res.redirect('/admin/discounts/new');
    }
  },

  async showEdit(req, res) {
    try {
      const code = await DiscountCode.getById(req.params.id);
      if (!code || !code.is_template) return res.status(404).send('Voucher not found');
      res.render('adminDiscountForm', {
        user: req.session.user,
        form: code,
        isEdit: true,
        messages: req.flash('success'),
        errors: req.flash('error')
      });
    } catch (err) {
      console.error('Error loading voucher edit:', err);
      res.status(500).send('Error loading voucher edit');
    }
  },

  async update(req, res) {
    try {
      const existing = await DiscountCode.getById(req.params.id);
      if (!existing || !existing.is_template) return res.status(404).send('Voucher not found');
      const payload = buildPayload(req.body);
      payload.code = existing.code;
      payload.type = 'voucher';
      payload.discount_type = 'fixed';
      payload.stackable = false;
      payload.auto_apply = false;
      payload.is_template = true;
      await DiscountCode.update(req.params.id, payload);
      req.flash('success', 'Voucher updated');
      res.redirect('/admin/discounts');
    } catch (err) {
      console.error('Error updating voucher:', err);
      req.flash('error', err.message || 'Error updating voucher');
      res.redirect(`/admin/discounts/${req.params.id}/edit`);
    }
  },

  async toggle(req, res) {
    try {
      const nextActive = req.body.is_active === '1';
      await DiscountCode.toggleActive(req.params.id, nextActive);
      if (!nextActive) {
        await DiscountCode.deactivateClaimedByTemplateId(req.params.id);
      }
      req.flash('success', 'Voucher updated');
      res.redirect('/admin/discounts');
    } catch (err) {
      console.error('Error toggling voucher:', err);
      req.flash('error', 'Error updating voucher');
      res.redirect('/admin/discounts');
    }
  },

  async remove(req, res) {
    try {
      await DiscountCode.remove(req.params.id);
      req.flash('success', 'Voucher deleted');
      res.redirect('/admin/discounts');
    } catch (err) {
      console.error('Error deleting voucher:', err);
      req.flash('error', 'Error deleting voucher');
      res.redirect('/admin/discounts');
    }
  },

  async updatePointValue(req, res) {
    try {
      const value = Number(req.body.point_value);
      if (!value || value <= 0) {
        req.flash('error', 'Point value must be greater than 0.');
        return res.redirect('/admin/discounts');
      }
      await LoyaltySettings.setPointValue(value);
      req.flash('success', 'Point value updated.');
      res.redirect('/admin/discounts');
    } catch (err) {
      console.error('Error updating point value:', err);
      req.flash('error', 'Unable to update point value.');
      res.redirect('/admin/discounts');
    }
  }
};
