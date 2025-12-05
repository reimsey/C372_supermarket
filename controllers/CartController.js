const Cart = require('../models/Cart');
const Product = require('../models/Product');

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
      res.render('cart', { cart: items || [], user: req.session.user, paymentMethods: req.paymentMethods || [] });
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
