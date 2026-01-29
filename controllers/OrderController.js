const Order = require('../models/Order');
const Cart = require('../models/Cart');
const Product = require('../models/Product');
const Wallet = require('../models/Wallet');
const Receipt = require('../models/Receipt');
const DiscountCode = require('../models/DiscountCode');
const discountService = require('../services/discounts');
const crypto = require('crypto');

const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

module.exports = {
  async purchase(req, res) {
    if (!req.session.user) return res.redirect('/login');
    const userId = req.session.user.id;
    const payWithWallet = req.body.payWithWallet === '1';
    const paymentLabel = req.body.paymentMethodLabel || '';
    Cart.getItemsByUser(userId, async (cartErr, cart) => {
      if (cartErr) return res.status(500).send('Error loading cart');
      if (!cart || cart.length === 0) return res.redirect('/cart');
      const isCardPayment = Boolean(paymentLabel && paymentLabel.toLowerCase().includes('card'));
      if (!payWithWallet && !isCardPayment) {
        req.flash('error', 'Please select a payment method.');
        return res.redirect('/cart');
      }
      if (isCardPayment) {
        const cardNumber = String(req.body.cardNumber || '').trim();
        const cardExpiry = String(req.body.cardExpiry || '').trim();
        const cardCvv = String(req.body.cardCvv || '').trim();
        if (!cardNumber || !cardExpiry || !cardCvv) {
          req.flash('error', 'Please fill in your card details.');
          return res.redirect('/cart');
        }
      }

      let discountSummary = null;
      try {
        discountSummary = await discountService.evaluateCartDiscounts(
          userId,
          cart,
          req.session.appliedDiscountCodes || []
        );
      } catch (discountErr) {
        console.error('Discount evaluation error:', discountErr);
        req.flash('error', 'Unable to apply vouchers right now.');
        return res.redirect('/cart');
      }

      if (discountSummary.errors && discountSummary.errors.length > 0) {
        req.flash('error', discountSummary.errors.join(' '));
        return res.redirect('/cart');
      }

      const subtotal = discountSummary.subtotal;
      const discountTotal = discountSummary.totalDiscount;
      const finalTotal = discountSummary.finalTotal;

      const finalize = (paymentLabel) => {
        let remaining = cart.length;
        let hasError = false;
        const receiptId = crypto.randomUUID();

        const receiptHeader = {
          receipt_id: receiptId,
          userId,
          subtotal,
          discount_amount: discountTotal,
          final_total: finalTotal,
          payment_method: paymentLabel
        };

        Receipt.create(receiptHeader, async (receiptErr) => {
          if (receiptErr && !hasError) {
            hasError = true;
            return res.status(500).send('Error creating receipt');
          }
          Receipt.addItems(receiptId, cart, async (itemsErr) => {
            if (itemsErr && !hasError) {
              hasError = true;
              return res.status(500).send('Error saving receipt items');
            }
            try {
              await DiscountCode.recordRedemptions(
                userId,
                receiptId,
                discountSummary.applied.concat(discountSummary.autoApplied ? [discountSummary.autoApplied] : [])
              );
            } catch (redemptionErr) {
              console.error('Error recording discount redemptions:', redemptionErr);
            }
          });
        });

        cart.forEach(item => {
          const orderData = {
            userId,
            productId: item.productId,
            qty: item.quantity,
            price: item.price,
            paymentMethod: paymentLabel,
            receiptId
          };

          Order.saveLineItem(orderData, (err) => {
            if (err && !hasError) {
              hasError = true;
              return res.status(500).send('Error processing purchase');
            }
            Product.decrementQuantity(item.productId, item.quantity, (stockErr) => {
              if (stockErr && !hasError) {
                hasError = true;
                return res.status(500).send('Not enough stock');
              }
              remaining -= 1;
              if (remaining === 0 && !hasError) {
                Cart.clear(userId, (clearErr) => {
                  if (clearErr) console.error('Error clearing cart:', clearErr);
                  req.session.appliedDiscountCodes = [];
                  res.redirect(`/receipt/${receiptId}`);
                });
              }
            });
          });
        });
      };

      if (payWithWallet) {
        Wallet.debit(
          userId,
          finalTotal,
          { type: 'purchase', reference_type: 'order', note: 'Wallet purchase' },
          (walletErr) => {
            if (walletErr) {
              req.flash('error', walletErr.message || 'Wallet payment failed');
              return res.redirect('/cart');
            }
            finalize('Wallet');
          }
        );
      } else {
        finalize(paymentLabel || 'Card');
      }
    });
  },
  purchaseHistory(req, res) {
    if (!req.session.user) return res.redirect('/login');
    const userId = req.session.user.id;

    Order.getHistoryByUser(userId, (err, orders) => {
      if (err) return res.send('Error loading orders');

      const grouped = new Map();
      orders.forEach(order => {
        const key = order.receipt_id ? `receipt-${order.receipt_id}` : `${userId}-${new Date(order.purchasedAt).getTime()}`;
        if (!grouped.has(key)) {
          grouped.set(key, {
            date: order.purchasedAt,
            items: [],
            subtotal: Number(order.subtotal) || 0,
            discount_amount: Number(order.discount_amount) || 0,
            total: Number(order.final_total) || 0,
            paymentMethod: order.receipt_payment_method || order.paymentMethod || 'N/A',
            receipt_id: order.receipt_id || null,
            refunded_amount: Number(order.refunded_amount) || 0,
            refunded_at: order.refunded_at || null
          });
        }
        const entry = grouped.get(key);
        const price = Number(order.price) || 0;
        entry.items.push({
          productName: order.productName,
          qty: order.qty,
          price,
          category: order.category || 'N/A'
        });
        if (!entry.total) entry.total = roundMoney(entry.items.reduce((sum, item) => sum + item.price * (item.qty || 0), 0));
      });

      res.render('purchaseHistory', { purchases: Array.from(grouped.values()), user: req.session.user });
    });
  },
  adminViewHistory(req, res) {
    Order.getAllWithUserProduct((err, data) => {
      if (err) return res.send('Error loading history');

      const grouped = new Map();
      data.forEach(order => {
        const key = order.receipt_id ? `receipt-${order.receipt_id}` : `${order.userId}-${new Date(order.purchasedAt).getTime()}`;
        if (!grouped.has(key)) {
          grouped.set(key, {
            date: order.purchasedAt,
            user: {
              id: order.userId,
              username: order.username,
              email: order.email,
              contact: order.contact
            },
            items: [],
            subtotal: Number(order.subtotal) || 0,
            discount_amount: Number(order.discount_amount) || 0,
            total: Number(order.final_total) || 0,
            paymentMethod: order.receipt_payment_method || order.paymentMethod || 'N/A',
            receipt_id: order.receipt_id || null,
            refunded_amount: Number(order.refunded_amount) || 0,
            refunded_at: order.refunded_at || null
          });
        }
        const entry = grouped.get(key);
        const price = Number(order.price) || 0;
        entry.items.push({
          productName: order.productName,
          qty: order.qty,
          price,
          category: order.category || 'N/A'
        });
        if (!entry.total) entry.total = roundMoney(entry.items.reduce((sum, item) => sum + item.price * (item.qty || 0), 0));
      });

      res.render('adminHistory', { purchases: Array.from(grouped.values()), user: req.session.user });
    });
  }
};
