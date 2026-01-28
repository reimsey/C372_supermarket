const DiscountCode = require('../models/DiscountCode');
const Product = require('../models/Product');

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
      const codes = await DiscountCode.listAll();
      res.render('adminDiscounts', { user: req.session.user, codes, messages: req.flash('success'), errors: req.flash('error') });
    } catch (err) {
      console.error('Error loading discounts:', err);
      res.status(500).send('Error loading discounts');
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
      console.error('Error loading discount form:', err);
      res.status(500).send('Error loading discount form');
    }
  },

  async create(req, res) {
    try {
      const payload = buildPayload(req.body);
      const productIds = normalizeProductIds(req.body.productIds);
      const id = await DiscountCode.create(payload);
      if (payload.scope === 'item') {
        await DiscountCode.setProducts(id, productIds);
      }
      req.flash('success', 'Discount created');
      res.redirect('/admin/discounts');
    } catch (err) {
      console.error('Error creating discount:', err);
      req.flash('error', err.message || 'Error creating discount');
      res.redirect('/admin/discounts/new');
    }
  },

  async showEdit(req, res) {
    try {
      const code = await DiscountCode.getById(req.params.id);
      if (!code) return res.status(404).send('Discount not found');
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
      console.error('Error loading discount edit:', err);
      res.status(500).send('Error loading discount edit');
    }
  },

  async update(req, res) {
    try {
      const payload = buildPayload(req.body);
      const productIds = normalizeProductIds(req.body.productIds);
      await DiscountCode.update(req.params.id, payload);
      if (payload.scope === 'item') {
        await DiscountCode.setProducts(req.params.id, productIds);
      } else {
        await DiscountCode.setProducts(req.params.id, []);
      }
      req.flash('success', 'Discount updated');
      res.redirect('/admin/discounts');
    } catch (err) {
      console.error('Error updating discount:', err);
      req.flash('error', err.message || 'Error updating discount');
      res.redirect(`/admin/discounts/${req.params.id}/edit`);
    }
  },

  async toggle(req, res) {
    try {
      await DiscountCode.toggleActive(req.params.id, req.body.is_active === '1');
      req.flash('success', 'Discount updated');
      res.redirect('/admin/discounts');
    } catch (err) {
      console.error('Error toggling discount:', err);
      req.flash('error', 'Error updating discount');
      res.redirect('/admin/discounts');
    }
  },

  async remove(req, res) {
    try {
      await DiscountCode.remove(req.params.id);
      req.flash('success', 'Discount deleted');
      res.redirect('/admin/discounts');
    } catch (err) {
      console.error('Error deleting discount:', err);
      req.flash('error', 'Error deleting discount');
      res.redirect('/admin/discounts');
    }
  }
};
