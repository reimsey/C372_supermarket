const RefundRequest = require('../models/RefundRequest');
const Receipt = require('../models/Receipt');
const Wallet = require('../models/Wallet');

module.exports = {
  async requestRefund(req, res) {
    if (!req.session.user) return res.redirect('/login');
    const userId = req.session.user.id;
    const receiptId = req.body.receipt_id;
    const reason = req.body.reason || 'Refund requested';

    if (!receiptId) {
      req.flash('error', 'Missing receipt.');
      return res.redirect('/purchase-history');
    }

    Receipt.getByReceiptId(receiptId, async (err, data) => {
      if (err) {
        req.flash('error', 'Error loading receipt');
        return res.redirect('/purchase-history');
      }
      if (!data) {
        req.flash('error', 'Receipt not found');
        return res.redirect('/purchase-history');
      }
      if (data.userId !== userId) {
        req.flash('error', 'Access denied');
        return res.redirect('/purchase-history');
      }
      if (Number(data.receipt.refunded_amount) > 0) {
        req.flash('error', 'Receipt already refunded');
        return res.redirect(`/receipt/${receiptId}`);
      }
      if (data.receipt.status !== 'completed') {
        req.flash('error', 'Refunds are available only after order completion.');
        return res.redirect(`/receipt/${receiptId}`);
      }

      try {
        const existing = await RefundRequest.getByReceiptId(receiptId);
        if (existing) {
          req.flash('error', 'Refund request already submitted.');
          return res.redirect(`/receipt/${receiptId}`);
        }
        const amount = Number(data.receipt.final_total) || 0;
        await RefundRequest.create({ receiptId, userId, amount, reason });
        req.flash('success', 'Refund request submitted.');
        res.redirect(`/receipt/${receiptId}`);
      } catch (createErr) {
        console.error('Refund request failed:', createErr);
        req.flash('error', 'Unable to submit refund request.');
        res.redirect(`/receipt/${receiptId}`);
      }
    });
  },

  async listRequests(req, res) {
    try {
      const requests = await RefundRequest.listAllWithDetails();
      res.render('adminRefunds', {
        user: req.session.user,
        requests: requests || [],
        messages: req.flash('success'),
        errors: req.flash('error')
      });
    } catch (err) {
      console.error('Error loading refund requests:', err);
      res.status(500).send('Error loading refunds');
    }
  },

  async approve(req, res) {
    if (!req.session.user) return res.redirect('/login');
    const adminId = req.session.user.id;
    const requestId = Number(req.params.id);
    if (!requestId) {
      req.flash('error', 'Invalid refund request.');
      return res.redirect('/admin/history');
    }

    try {
      const request = await RefundRequest.getById(requestId);
      if (!request || request.status !== 'pending') {
        req.flash('error', 'Refund request not available.');
        return res.redirect('/admin/history');
      }

      Receipt.getByReceiptId(request.receipt_id, (receiptErr, data) => {
        if (receiptErr || !data) {
          req.flash('error', 'Receipt not found.');
          return res.redirect('/admin/history');
        }
        if (Number(data.receipt.refunded_amount) > 0) {
          req.flash('error', 'Receipt already refunded.');
          return res.redirect('/admin/history');
        }

        const amount = Number(request.amount) || Number(data.receipt.final_total) || 0;
        const userId = data.receipt.userId;

        Wallet.credit(
          userId,
          amount,
          { type: 'refund', reference_type: 'receipt_refund', reference_id: request.receipt_id, note: 'Admin approved refund' },
          async (creditErr) => {
            if (creditErr) {
              req.flash('error', creditErr.message || 'Refund failed');
              return res.redirect('/admin/history');
            }
            Receipt.markRefunded(request.receipt_id, adminId, amount, async (markErr, result) => {
              if (markErr || !result || result.affectedRows === 0) {
                req.flash('error', 'Refund record failed');
                return res.redirect('/admin/history');
              }
              await RefundRequest.approve(requestId, adminId);
              req.flash('success', 'Refund approved and credited to wallet.');
              res.redirect('/admin/history');
            });
          }
        );
      });
    } catch (err) {
      console.error('Refund approve failed:', err);
      req.flash('error', 'Unable to approve refund.');
      res.redirect('/admin/history');
    }
  },

  async reject(req, res) {
    if (!req.session.user) return res.redirect('/login');
    const adminId = req.session.user.id;
    const requestId = Number(req.params.id);
    const note = req.body.note || 'Refund rejected';
    if (!requestId) {
      req.flash('error', 'Invalid refund request.');
      return res.redirect('/admin/history');
    }

    try {
      const updated = await RefundRequest.reject(requestId, adminId, note);
      if (!updated) {
        req.flash('error', 'Refund request not available.');
        return res.redirect('/admin/history');
      }
      req.flash('success', 'Refund rejected.');
      res.redirect('/admin/history');
    } catch (err) {
      console.error('Refund reject failed:', err);
      req.flash('error', 'Unable to reject refund.');
      res.redirect('/admin/history');
    }
  }
};
