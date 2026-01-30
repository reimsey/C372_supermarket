const DiscountCode = require('../models/DiscountCode');

module.exports = {
  async viewVoucher(req, res) {
    if (!req.session.user) return res.redirect('/login');
    const userId = req.session.user.id;
    const voucherId = Number(req.params.id);
    if (!voucherId) return res.status(400).send('Invalid voucher');

    try {
      const voucher = await DiscountCode.getById(voucherId);
      if (!voucher || voucher.is_template || Number(voucher.user_id) !== Number(userId)) {
        return res.status(404).send('Voucher not found');
      }

      res.render('voucherDetails', {
        user: req.session.user,
        voucher,
        products: [],
        messages: req.flash('success'),
        errors: req.flash('error')
      });
    } catch (err) {
      console.error('Error loading voucher details:', err);
      res.status(500).send('Unable to load voucher details');
    }
  }
};
