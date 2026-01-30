const DiscountCode = require('../models/DiscountCode');
const Product = require('../models/Product');
const LoyaltySettings = require('../models/LoyaltySettings');

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
  code: body.code,
  type: body.type,
  scope: body.scope,
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

const normalizeProductIds = (value) => {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.map(id => parseInt(id, 10)).filter(Boolean);
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
      const products = await new Promise((resolve, reject) => {
        Product.getAll((err, rows) => (err ? reject(err) : resolve(rows || [])));
      });
      res.render('adminDiscountForm', {
        user: req.session.user,
        products,
        form: {},
        selectedProducts: [],
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
      payload.type = 'voucher';
      payload.discount_type = 'fixed';
      payload.stackable = false;
      payload.auto_apply = false;
      payload.is_template = true;
      payload.user_id = null;
      const productIds = normalizeProductIds(req.body.productIds);
      const id = await DiscountCode.create(payload);
      if (payload.scope === 'item') {
        await DiscountCode.setProducts(id, productIds);
      }
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
      const products = await new Promise((resolve, reject) => {
        Product.getAll((err, rows) => (err ? reject(err) : resolve(rows || [])));
      });
      const selectedProducts = await DiscountCode.listProductIds(code.id);
      res.render('adminDiscountForm', {
        user: req.session.user,
        products,
        form: code,
        selectedProducts,
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
      const payload = buildPayload(req.body);
      payload.type = 'voucher';
      payload.discount_type = 'fixed';
      payload.stackable = false;
      payload.auto_apply = false;
      payload.is_template = true;
      const productIds = normalizeProductIds(req.body.productIds);
      await DiscountCode.update(req.params.id, payload);
      if (payload.scope === 'item') {
        await DiscountCode.setProducts(req.params.id, productIds);
      } else {
        await DiscountCode.setProducts(req.params.id, []);
      }
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
