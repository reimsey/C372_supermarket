const Wallet = require('../models/Wallet');
const Subscription = require('../models/Subscription');
const DiscountCode = require('../models/DiscountCode');
const crypto = require('crypto');

const subscriptionPrice = () => Math.round((Number(process.env.SUBSCRIPTION_PRICE) || 40) * 100) / 100;

module.exports = {
  async showBenefits(req, res) {
    if (!req.session.user) return res.redirect('/login');
    try {
      const userId = req.session.user.id;
      const subscription = await Subscription.getByUser(userId);
      const [templates, userVouchers] = await Promise.all([
        DiscountCode.listTemplates(),
        DiscountCode.listUserVouchers(userId)
      ]);

      const claimedTemplateIds = new Set(
        (userVouchers || []).map(voucher => Number(voucher.template_id)).filter(Boolean)
      );

      const messages = req.flash('success');
      const errors = req.flash('error');
      if (req.query.status === 'active') messages.push('Subscription activated.');
      if (req.query.status === 'fail') errors.push('Subscription payment failed.');
      res.render('subscription', {
        user: req.session.user,
        subscription,
        subscriptionPrice: subscriptionPrice(),
        templates: (templates || []).filter(template => template.is_active),
        claimedTemplateIds,
        claimedCoupons: userVouchers || [],
        messages,
        errors
      });
    } catch (err) {
      console.error('Error loading subscription:', err);
      req.flash('error', 'Unable to load subscription details.');
      res.redirect('/shopping');
    }
  },

  async showCheckout(req, res) {
    if (!req.session.user) return res.redirect('/login');
    try {
      const subscription = await Subscription.getByUser(req.session.user.id);
      if (subscription?.is_active) {
        req.flash('success', 'Subscription already active.');
        return res.redirect('/subscription');
      }
      Wallet.getBalance(req.session.user.id, (balErr, balance) => {
        if (balErr) {
          console.error('Error loading wallet balance:', balErr);
        }
        res.render('subscriptionCheckout', {
          user: req.session.user,
          walletBalance: Number(balance) || 0,
          subscriptionPrice: subscriptionPrice(),
          netsConfigured: Boolean(process.env.API_KEY && process.env.PROJECT_ID),
          messages: req.flash('success'),
          errors: req.flash('error')
        });
      });
    } catch (err) {
      console.error('Error loading subscription checkout:', err);
      req.flash('error', 'Unable to load subscription checkout.');
      res.redirect('/subscription');
    }
  },

  subscribeWithWallet(req, res) {
    if (!req.session.user) return res.redirect('/login');
    const userId = req.session.user.id;
    const price = subscriptionPrice();

    Wallet.debit(
      userId,
      price,
      { type: 'subscription', reference_type: 'subscription', note: 'Subscription purchase' },
      async (walletErr) => {
        if (walletErr) {
          req.flash('error', walletErr.message || 'Subscription payment failed');
          return res.redirect('/subscription/checkout');
        }
        try {
          await Subscription.ensureActive(userId);
          req.flash('success', 'Subscription activated.');
          res.redirect('/subscription');
        } catch (err) {
          console.error('Subscription activation failed:', err);
          req.flash('error', 'Subscription activation failed.');
          res.redirect('/subscription/checkout');
        }
      }
    );
  }
  ,

  async claimCoupon(req, res) {
    if (!req.session.user) return res.redirect('/login');
    const userId = req.session.user.id;
    const templateId = Number(req.body.templateId);
    if (!templateId) {
      req.flash('error', 'Please select a coupon to claim.');
      return res.redirect('/subscription');
    }

    try {
      const subscription = await Subscription.getByUser(userId);
      if (!subscription?.is_active) {
        req.flash('error', 'Subscription required to claim coupons.');
        return res.redirect('/subscription');
      }

      const [template, userVouchers] = await Promise.all([
        DiscountCode.getById(templateId),
        DiscountCode.listUserVouchers(userId)
      ]);

      if (!template || !template.is_template || !template.is_active) {
        req.flash('error', 'Coupon is not available.');
        return res.redirect('/subscription');
      }

      const alreadyClaimed = (userVouchers || []).some(voucher => Number(voucher.template_id) === templateId);
      if (alreadyClaimed) {
        req.flash('error', 'You already claimed this coupon.');
        return res.redirect('/subscription');
      }

      const code = `CPN-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      await DiscountCode.createUserVoucherFromTemplate(templateId, userId, code);
      req.flash('success', 'Coupon claimed. It is now available in your cart.');
      res.redirect('/subscription');
    } catch (err) {
      console.error('Coupon claim failed:', err);
      req.flash('error', 'Unable to claim coupon right now.');
      res.redirect('/subscription');
    }
  }
};
