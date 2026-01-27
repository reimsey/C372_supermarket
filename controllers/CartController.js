const Cart = require('../models/Cart');
const Product = require('../models/Product');
const Wallet = require('../models/Wallet');

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
        res.redirect('/cart');
      });
    });
  },
  viewCart(req, res) {
    if (!req.session.user) return res.redirect('/login');
    Cart.getItemsByUser(req.session.user.id, (err, items) => {
      if (err) console.error('Error loading cart:', err);
      const subtotal = computeSubtotalFromCart(items);
      Wallet.getBalance(req.session.user.id, (balErr, balance) => {
        if (balErr) console.error('Error loading wallet balance:', balErr);
        res.render('cart', {
          cart: items || [],
          user: req.session.user,
          paymentMethods: req.paymentMethods || [],
          walletBalance: roundMoney(balance || 0),
          cartSubtotal: subtotal,
          messages: req.flash('success'),
          errors: req.flash('error')
        });
      });
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
