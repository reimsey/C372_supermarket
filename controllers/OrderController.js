const Order = require('../models/Order');
const Cart = require('../models/Cart');
const Product = require('../models/Product');
const PaymentMethod = require('../models/PaymentMethod');

module.exports = {
  purchase(req, res) {
    if (!req.session.user) return res.redirect('/login');
    const userId = req.session.user.id;
    const selectedMethodId = req.body.paymentMethodId ? parseInt(req.body.paymentMethodId, 10) : null;
    const fallbackLabel = req.body.paymentMethodLabel || 'Pay on Delivery';

    Cart.getItemsByUser(userId, (cartErr, cart) => {
      if (cartErr) return res.status(500).send('Error loading cart');
      if (!cart || cart.length === 0) return res.redirect('/cart');

      const finalize = (paymentLabel) => {
        let remaining = cart.length;
        let hasError = false;

        cart.forEach(item => {
          const orderData = {
            userId,
            productId: item.productId,
            qty: item.quantity,
            price: item.price,
            paymentMethod: paymentLabel
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
                  res.redirect('/purchase-history');
                });
              }
            });
          });
        });
      };

      if (selectedMethodId) {
        PaymentMethod.listByUser(userId, (err, methods) => {
          if (err) return res.status(500).send('Error processing payment method');
          const chosen = (methods || []).find(m => m.id === selectedMethodId);
          const number = chosen ? (chosen.cardNumber || chosen.maskedDetails || '') : '';
          const label = chosen ? `${chosen.methodName} ${number}` : fallbackLabel;
          finalize(label);
        });
      } else {
        finalize(fallbackLabel);
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
        const ts = new Date(order.purchasedAt).getTime();
        const key = `${userId}-${ts}`;
        if (!grouped.has(key)) {
          grouped.set(key, {
            date: order.purchasedAt,
            items: [],
            total: 0,
            paymentMethod: order.paymentMethod || 'N/A'
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
        entry.total += price * (order.qty || 0);
      });

      res.render('purchaseHistory', { purchases: Array.from(grouped.values()), user: req.session.user });
    });
  },
  adminViewHistory(req, res) {
    Order.getAllWithUserProduct((err, data) => {
      if (err) return res.send('Error loading history');

      const grouped = new Map();
      data.forEach(order => {
        const ts = new Date(order.purchasedAt).getTime();
        const key = `${order.userId}-${ts}`;
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
            total: 0,
            paymentMethod: order.paymentMethod || 'N/A'
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
        entry.total += price * (order.qty || 0);
      });

      res.render('adminHistory', { purchases: Array.from(grouped.values()), user: req.session.user });
    });
  }
};
