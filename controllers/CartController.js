const Cart = require('../models/Cart');
const Product = require('../models/Product');
const Wallet = require('../models/Wallet');
const discountService = require('../services/discounts');
const DiscountCode = require('../models/DiscountCode');
const Loyalty = require('../models/Loyalty');
const checkoutTotals = require('../services/checkoutTotals');

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

module.exports = {
  addToCart(req, res) {
    if (!req.session.user) return res.redirect('/login');
    const userId = req.session.user.id;
    const productId = parseInt(req.params.id || req.body.productId, 10);
    const qty = parseInt(req.body.quantity || req.body.qty, 10) || 1;

    Product.getById(productId, (err, product) => {
      if (err || !product) return res.status(400).send('Invalid product');
      Cart.addOrIncrement(userId, productId, qty, (addErr) => {
        if (addErr) return res.status(500).send('Error adding to cart');
        req.flash('success', 'Added to cart.');
        res.redirect('/cart');
      });
    });
  },
  buyNow(req, res) {
    if (!req.session.user) return res.redirect('/login');
    const userId = req.session.user.id;
    const productId = parseInt(req.body.productId, 10);
    const qty = parseInt(req.body.qty, 10) || 1;

    Product.getById(productId, (err, product) => {
      if (err || !product) return res.status(400).send('Invalid product');
      Cart.clear(userId, (clearErr) => {
        if (clearErr) return res.status(500).send('Error preparing cart');
        Cart.addOrIncrement(userId, productId, qty, (addErr) => {
          if (addErr) return res.status(500).send('Error starting checkout');
          req.flash('success', 'Buy now started. Cart now contains only this item.');
          res.redirect('/cart');
        });
      });
    });
  },
  async viewCart(req, res) {
    if (!req.session.user) return res.redirect('/login');
    Cart.getItemsByUser(req.session.user.id, async (err, items) => {
      if (err) console.error('Error loading cart:', err);
      const subtotal = computeSubtotalFromCart(items);
      const appliedCodes = req.session.appliedDiscountCodes || [];

      let discountSummary = {
        subtotal,
        applied: [],
        autoApplied: null,
        totalDiscount: 0,
        finalTotal: subtotal,
        errors: []
      };

      try {
        discountSummary = await discountService.evaluateCartDiscounts(req.session.user.id, items || [], appliedCodes);
      } catch (discountErr) {
        console.error('Error evaluating discounts:', discountErr);
      }

      req.session.appliedDiscountCodes = discountSummary.applied.map(item => item.code);
      if (discountSummary.errors && discountSummary.errors.length > 0) {
        req.flash('error', discountSummary.errors.join(' '));
      }

      try {
        const [pricing, voucherList, pointsBalance] = await Promise.all([
          checkoutTotals.computeTotals(req.session.user.id, discountSummary),
          DiscountCode.listUserVouchers(req.session.user.id),
          Loyalty.getBalance(req.session.user.id)
        ]);

        const availableVouchers = (voucherList || []).filter(voucher => Number(voucher.user_used) === 0);

        Wallet.getBalance(req.session.user.id, (balErr, balance) => {
          if (balErr) console.error('Error loading wallet balance:', balErr);
          res.render('cart', {
            cart: items || [],
            user: req.session.user,
            paymentMethods: req.paymentMethods || [],
            walletBalance: roundMoney(balance || 0),
            cartSubtotal: subtotal,
            discountSummary,
            appliedCodes: req.session.appliedDiscountCodes || [],
            pricing,
            availableVouchers,
            pointsBalance: Number(pointsBalance) || 0,
            messages: req.flash('success'),
            errors: req.flash('error')
          });
        });
      } catch (pricingErr) {
        console.error('Error calculating totals:', pricingErr);
        Wallet.getBalance(req.session.user.id, (balErr, balance) => {
          if (balErr) console.error('Error loading wallet balance:', balErr);
          res.render('cart', {
            cart: items || [],
            user: req.session.user,
            paymentMethods: req.paymentMethods || [],
            walletBalance: roundMoney(balance || 0),
            cartSubtotal: subtotal,
            discountSummary,
            appliedCodes: req.session.appliedDiscountCodes || [],
            pricing: {
              itemsTotal: discountSummary.finalTotal,
              deliveryFee: 0,
              finalTotal: discountSummary.finalTotal,
              baseDeliveryFee: 0,
              freeDeliveryThreshold: 0
            },
            availableVouchers: [],
            pointsBalance: 0,
            messages: req.flash('success'),
            errors: req.flash('error')
          });
        });
      }
    });
  },
  removeFromCart(req, res) {
    if (!req.session.user) return res.redirect('/login');
    Cart.deleteItem(req.session.user.id, parseInt(req.params.id, 10), (err) => {
      if (err) console.error('Error removing item:', err);
      res.redirect('/cart');
    });
  }
};
