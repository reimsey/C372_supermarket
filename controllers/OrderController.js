const Order = require('../models/Order');
const Cart = require('../models/Cart');
const Product = require('../models/Product');
const PaymentMethod = require('../models/PaymentMethod');
const Wallet = require('../models/Wallet');
const Receipt = require('../models/Receipt');
const crypto = require('crypto');

const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

module.exports = {
  purchase(req, res) {
    if (!req.session.user) return res.redirect('/login');
    const userId = req.session.user.id;
    const selectedMethodId = req.body.paymentMethodId ? parseInt(req.body.paymentMethodId, 10) : null;
    const fallbackLabel = req.body.paymentMethodLabel || 'Pay on Delivery';
    const payWithWallet = req.body.payWithWallet === '1';
    Cart.getItemsByUser(userId, (cartErr, cart) => {
      if (cartErr) return res.status(500).send('Error loading cart');
      if (!cart || cart.length === 0) return res.redirect('/cart');

      const subtotal = roundMoney(
        cart.reduce((sum, item) => {
          const price = Number(item.price) || 0;
          const qty = Number(item.quantity) || 0;
          return sum + price * qty;
        }, 0)
      );

      const finalize = (paymentLabel) => {
        let remaining = cart.length;
        let hasError = false;
        const receiptId = crypto.randomUUID();

        const receiptHeader = {
          receipt_id: receiptId,
          userId,
          subtotal,
          discount_amount: 0,
          final_total: subtotal,
          payment_method: paymentLabel
        };

        Receipt.create(receiptHeader, (receiptErr) => {
          if (receiptErr && !hasError) {
            hasError = true;
            return res.status(500).send('Error creating receipt');
          }
          Receipt.addItems(receiptId, cart, (itemsErr) => {
            if (itemsErr && !hasError) {
              hasError = true;
              return res.status(500).send('Error saving receipt items');
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
                  res.redirect(`/receipt/${receiptId}`);
                });
              }
            });
          });
        });
      };

      const proceedPayment = (label) => {
        if (!payWithWallet) return finalize(label);
        Wallet.debit(
          userId,
          subtotal,
          { type: 'purchase', reference_type: 'order', note: 'Wallet purchase' },
          (walletErr) => {
            if (walletErr) {
              req.flash('error', walletErr.message || 'Wallet payment failed');
              return res.redirect('/cart');
            }
            finalize('Wallet');
          }
        );
      };

      if (selectedMethodId) {
        PaymentMethod.listByUser(userId, (err, methods) => {
          if (err) return res.status(500).send('Error processing payment method');
          const chosen = (methods || []).find(m => m.id === selectedMethodId);
          const number = chosen ? (chosen.cardNumber || chosen.maskedDetails || '') : '';
          const label = chosen ? `${chosen.methodName} ${number}` : fallbackLabel;
          proceedPayment(label);
        });
      } else {
        proceedPayment(fallbackLabel);
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
