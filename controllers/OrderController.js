const Order = require('../models/Order');
const Cart = require('../models/Cart');
const Product = require('../models/Product');
const Wallet = require('../models/Wallet');
const Receipt = require('../models/Receipt');
const DiscountCode = require('../models/DiscountCode');
const discountService = require('../services/discounts');
const checkoutTotals = require('../services/checkoutTotals');
const Loyalty = require('../models/Loyalty');
const Subscription = require('../models/Subscription');
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

      let pricing;
      try {
        pricing = await checkoutTotals.computeTotals(userId, discountSummary);
      } catch (pricingErr) {
        console.error('Pricing evaluation error:', pricingErr);
        req.flash('error', 'Unable to calculate delivery fee right now.');
        return res.redirect('/cart');
      }

      const subtotal = discountSummary.subtotal;
      const discountTotal = discountSummary.totalDiscount;
      const deliveryFee = pricing.deliveryFee;
      const finalTotal = pricing.finalTotal;

      const finalize = (paymentLabel) => {
        let remaining = cart.length;
        let hasError = false;
        const receiptId = crypto.randomUUID();

        const receiptHeader = {
          receipt_id: receiptId,
          userId,
          subtotal,
          discount_amount: discountTotal,
          delivery_fee: deliveryFee,
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
                  if (pricing?.subscription?.is_active && !pricing.subscription.first_delivery_used) {
                    Subscription.markFirstDeliveryUsed(userId).catch((subErr) => {
                      console.error('Error marking first delivery used:', subErr);
                    });
                  }
                  if (pricing?.subscription?.is_active) {
                    const pointsEarned = Math.floor(Number(pricing?.itemsTotal) || 0);
                    if (pointsEarned > 0) {
                      Loyalty.credit(userId, pointsEarned).catch((pointsErr) => {
                        console.error('Error awarding points:', pointsErr);
                      });
                    }
                  }
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
      if (err) {
        console.error('Error loading orders:', err);
        return res.status(500).send(`Error loading orders: ${err.message || err}`);
      }

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
            status: order.receipt_status || 'processing',
            delivered_at: order.delivered_at || null,
            completed_at: order.completed_at || null,
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

      const RefundRequest = require('../models/RefundRequest');
      const purchases = Array.from(grouped.values());
      const receiptIds = purchases.map(p => p.receipt_id).filter(Boolean);
      RefundRequest.listByReceiptIds(receiptIds).then((requests) => {
        const requestMap = new Map((requests || []).map(r => [r.receipt_id, r]));
        purchases.forEach(p => {
          p.refundRequest = requestMap.get(p.receipt_id) || null;
        });
        res.render('purchaseHistory', { purchases, user: req.session.user });
      }).catch((refundErr) => {
        console.error('Error loading refund requests:', refundErr);
        res.render('purchaseHistory', { purchases, user: req.session.user });
      });
    });
  },
  adminViewHistory(req, res) {
    const RefundRequest = require('../models/RefundRequest');
    Order.getAllWithUserProduct(async (err, data) => {
      if (err) {
        console.error('Error loading history:', err);
        return res.status(500).send(`Error loading history: ${err.message || err}`);
      }

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
              contact: order.contact,
              is_active: order.user_is_active
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

      let purchases = Array.from(grouped.values());
      const search = String(req.query.q || '').trim().toLowerCase();
      const sort = String(req.query.sort || 'date-desc').toLowerCase();

      if (search) {
        purchases = purchases.filter(p => {
          const user = p.user || {};
          const haystack = `${user.username || ''} ${user.email || ''} ${user.id || ''}`.toLowerCase();
          return haystack.includes(search);
        });
      }

      purchases.sort((a, b) => {
        switch (sort) {
          case 'date-asc':
            return new Date(a.date).getTime() - new Date(b.date).getTime();
          case 'amount-asc':
            return (a.total || 0) - (b.total || 0);
          case 'amount-desc':
            return (b.total || 0) - (a.total || 0);
          case 'date-desc':
          default:
            return new Date(b.date).getTime() - new Date(a.date).getTime();
        }
      });

      const receiptIds = purchases.map(p => p.receipt_id).filter(Boolean);
      try {
        const requests = await RefundRequest.listByReceiptIds(receiptIds);
        const requestMap = new Map(requests.map(r => [r.receipt_id, r]));
        purchases.forEach(p => {
          p.refundRequest = requestMap.get(p.receipt_id) || null;
        });
      } catch (refundErr) {
        console.error('Error loading refund requests:', refundErr);
      }

      res.render('adminHistory', {
        purchases,
        user: req.session.user,
        sort,
        search
      });
    });
  }
  ,

  adminProcessing(req, res) {
    Order.getAllWithUserProduct((err, data) => {
      if (err) {
        console.error('Error loading orders:', err);
        return res.status(500).send(`Error loading orders: ${err.message || err}`);
      }

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
              contact: order.contact,
              is_active: order.user_is_active
            },
            items: [],
            subtotal: Number(order.subtotal) || 0,
            total: Number(order.final_total) || 0,
            paymentMethod: order.receipt_payment_method || order.paymentMethod || 'N/A',
            receipt_id: order.receipt_id || null,
            status: order.receipt_status || 'processing'
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
      });

      const allOrders = Array.from(grouped.values());
      const ordersInProcess = allOrders.filter(item => item.status === 'processing');
      const ordersCompleted = allOrders.filter(item => item.status === 'delivered' || item.status === 'completed');
      res.render('adminProcessing', {
        orders: ordersInProcess,
        completedOrders: ordersCompleted,
        user: req.session.user,
        messages: req.flash('success'),
        errors: req.flash('error')
      });
    });
  },

  adminMarkDelivered(req, res) {
    const Receipt = require('../models/Receipt');
    const receiptId = req.body.receipt_id;
    if (!receiptId) {
      req.flash('error', 'Missing receipt.');
      return res.redirect('/admin/orders');
    }
    Receipt.markDelivered(receiptId, (err, result) => {
      if (err || !result || result.affectedRows === 0) {
        req.flash('error', 'Unable to mark order delivered.');
        return res.redirect('/admin/orders');
      }
      req.flash('success', 'Order marked as delivered.');
      res.redirect('/admin/orders');
    });
  },

  userMarkReceived(req, res) {
    if (!req.session.user) return res.redirect('/login');
    const receiptId = req.body.receipt_id;
    if (!receiptId) {
      req.flash('error', 'Missing receipt.');
      return res.redirect('/purchase-history');
    }
    const Receipt = require('../models/Receipt');
    Receipt.getByReceiptId(receiptId, (err, data) => {
      if (err || !data) {
        req.flash('error', 'Receipt not found.');
        return res.redirect('/purchase-history');
      }
      if (data.userId !== req.session.user.id) {
        req.flash('error', 'Access denied.');
        return res.redirect('/purchase-history');
      }
      Receipt.markCompleted(receiptId, (markErr, result) => {
        if (markErr || !result || result.affectedRows === 0) {
          req.flash('error', 'Unable to confirm order.');
          return res.redirect('/purchase-history');
        }
        req.flash('success', 'Order marked as completed.');
        res.redirect('/purchase-history');
      });
    });
  }
};
