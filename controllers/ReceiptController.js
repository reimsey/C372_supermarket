const Receipt = require('../models/Receipt');
const RefundRequest = require('../models/RefundRequest');

module.exports = {
  viewReceipt(req, res) {
    if (!req.session.user) return res.redirect('/login');
    const receiptId = req.params.receiptId;

    Receipt.getByReceiptId(receiptId, (err, data) => {
      if (err) return res.status(500).send('Error loading receipt');
      if (!data) return res.status(404).send('Receipt not found');

      const isAdmin = req.session.user.role === 'admin';
      if (!isAdmin && data.userId !== req.session.user.id) {
        return res.status(403).send('Access denied');
      }

      RefundRequest.getByReceiptId(receiptId).then((refundRequest) => {
        res.render('receipt', {
          user: req.session.user,
          receipt: data.receipt,
          items: data.items,
          discounts: data.discounts || [],
          refundRequest
        });
      }).catch((refundErr) => {
        console.error('Error loading refund request:', refundErr);
        res.render('receipt', {
          user: req.session.user,
          receipt: data.receipt,
          items: data.items,
          discounts: data.discounts || [],
          refundRequest: null
        });
      });
    });
  },

  downloadPdf(req, res) {
    if (!req.session.user) return res.redirect('/login');
    const receiptId = req.params.receiptId;

    Receipt.getByReceiptId(receiptId, (err, data) => {
      if (err) return res.status(500).send('Error loading receipt');
      if (!data) return res.status(404).send('Receipt not found');

      const isAdmin = req.session.user.role === 'admin';
      if (!isAdmin && data.userId !== req.session.user.id) {
        return res.status(403).send('Access denied');
      }

      const PDFDocument = require('pdfkit');
      const doc = new PDFDocument({ size: 'A4', margin: 50 });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="receipt-${receiptId}.pdf"`);
      doc.pipe(res);

      doc.fontSize(18).text('Supermarket Receipt', { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).text(`Receipt ID: ${receiptId}`);
      doc.text(`Date: ${data.receipt.createdAt}`);
      doc.text(`Payment Method: ${data.receipt.payment_method || 'N/A'}`);
      doc.moveDown();

      doc.fontSize(12).text('Items', { underline: true });
      doc.moveDown(0.5);
      data.items.forEach((item) => {
        doc.text(`${item.product_name} x${item.quantity} @ $${Number(item.unit_price).toFixed(2)}`);
      });
      doc.moveDown();

      doc.text(`Subtotal: $${Number(data.receipt.subtotal).toFixed(2)}`);
      doc.text(`Vouchers: -$${Number(data.receipt.discount_amount).toFixed(2)}`);
      doc.text(`Delivery: $${Number(data.receipt.delivery_fee || 0).toFixed(2)}`);
      if (data.discounts && data.discounts.length > 0) {
        doc.text('Voucher Codes:', { underline: true });
        data.discounts.forEach((discount) => {
          doc.text(`${discount.code}: -$${Number(discount.discount_amount).toFixed(2)}`);
        });
      }
      doc.text(`Final Paid: $${Number(data.receipt.final_total).toFixed(2)}`, { underline: true });

      doc.end();
    });
  }
};
