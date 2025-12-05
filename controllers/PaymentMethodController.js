const PaymentMethod = require('../models/PaymentMethod');

module.exports = {
  list(req, res) {
    if (!req.session.user) return res.redirect('/login');
    PaymentMethod.listByUser(req.session.user.id, (err, methods) => {
      if (err) {
        console.error('Error loading payment methods:', err);
        return res.render('paymentMethods', { user: req.session.user, methods: [] });
      }
      res.render('paymentMethods', { user: req.session.user, methods });
    });
  },
  add(req, res) {
    if (!req.session.user) return res.redirect('/login');
    const method = {
      methodName: req.body.methodName,
      cardNumber: req.body.cardNumber || req.body.maskedDetails,
      expireDate: req.body.expireDate
    };
    PaymentMethod.add(req.session.user.id, method, (err) => {
      if (err) console.error('Error adding payment method:', err);
      res.redirect('/payment-methods');
    });
  },
  update(req, res) {
    if (!req.session.user) return res.redirect('/login');
    const methodId = parseInt(req.params.id, 10);
    const method = {
      methodName: req.body.methodName,
      cardNumber: req.body.cardNumber || req.body.maskedDetails,
      expireDate: req.body.expireDate
    };
    PaymentMethod.update(req.session.user.id, methodId, method, (err) => {
      if (err) console.error('Error updating payment method:', err);
      res.redirect('/payment-methods');
    });
  },
  remove(req, res) {
    if (!req.session.user) return res.redirect('/login');
    const methodId = parseInt(req.params.id, 10);
    PaymentMethod.remove(req.session.user.id, methodId, (err) => {
      if (err) console.error('Error deleting payment method:', err);
      res.redirect('/payment-methods');
    });
  }
};
