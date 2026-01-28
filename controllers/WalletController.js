const Wallet = require('../models/Wallet');
const Receipt = require('../models/Receipt');
const PaymentMethod = require('../models/PaymentMethod');

module.exports = {
  showWallet(req, res) {
    if (!req.session.user) return res.redirect('/login');
    const userId = req.session.user.id;

    Wallet.getBalance(userId, (balErr, balance) => {
      if (balErr) return res.status(500).send('Error loading wallet');
      Wallet.listLedger(userId, 25, (ledgerErr, ledger) => {
        if (ledgerErr) return res.status(500).send('Error loading wallet history');
        PaymentMethod.listByUser(userId, (pmErr, methods) => {
          if (pmErr) return res.status(500).send('Error loading payment methods');
          const messages = req.flash('success') || [];
          const errors = req.flash('error') || [];
          if (req.query.topup === 'success') messages.push('Wallet top-up successful');
          if (req.query.topup === 'fail') errors.push('Wallet top-up failed');
          res.render('wallet', {
            user: req.session.user,
            balance: Number(balance) || 0,
            ledger: ledger || [],
            paymentMethods: methods || [],
            messages,
            errors
          });
        });
      });
    });
  },

  topUp(req, res) {
    if (!req.session.user) return res.redirect('/login');
    const userId = req.session.user.id;
    const amount = req.body.amount;
    const paymentMethodLabel = req.body.paymentMethodLabel || 'Saved payment method';

    Wallet.credit(
      userId,
      amount,
      { type: 'topup', reference_type: 'wallet_topup', note: `Wallet top-up via ${paymentMethodLabel}` },
      (err) => {
        if (err) {
          req.flash('error', err.message || 'Top-up failed');
          return res.redirect('/wallet');
        }
        req.flash('success', 'Top-up successful');
        res.redirect('/wallet');
      }
    );
  },

  refundToWallet(req, res) {
    if (!req.session.user) return res.redirect('/login');
    const receiptId = req.body.receipt_id;
    const note = req.body.note || 'Refund to wallet';

    if (!receiptId) {
      req.flash('error', 'Missing receipt for refund');
      return res.redirect('/admin/history');
    }

    Receipt.getByReceiptId(receiptId, (err, data) => {
      if (err) {
        req.flash('error', 'Error loading receipt');
        return res.redirect('/admin/history');
      }
      if (!data) {
        req.flash('error', 'Receipt not found');
        return res.redirect('/admin/history');
      }

      const receipt = data.receipt;
      if (Number(receipt.refunded_amount) > 0) {
        req.flash('error', `Already refunded $${Number(receipt.refunded_amount).toFixed(2)}`);
        return res.redirect('/admin/history');
      }

      const amount = Number(receipt.final_total) || 0;
      const userId = receipt.userId;

      Wallet.credit(
        userId,
        amount,
        { type: 'refund', reference_type: 'receipt_refund', reference_id: receiptId, note },
        (creditErr) => {
          if (creditErr) {
            const msg = creditErr.code === 'ER_DUP_ENTRY' ? 'Already refunded' : (creditErr.message || 'Refund failed');
            req.flash('error', msg);
            return res.redirect('/admin/history');
          }
          Receipt.markRefunded(receiptId, req.session.user.id, amount, (markErr, result) => {
            if (markErr) {
              req.flash('error', markErr.message || 'Refund recorded failed');
              return res.redirect('/admin/history');
            }
            if (!result || result.affectedRows === 0) {
              req.flash('error', 'Already refunded');
              return res.redirect('/admin/history');
            }
            req.flash('success', 'Refund sent to wallet');
            res.redirect('/admin/history');
          });
        }
      );
    });
  }
};
