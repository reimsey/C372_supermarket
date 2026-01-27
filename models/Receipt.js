const db = require('../db');

module.exports = {
  create(receipt, callback) {
    const sql = `
      INSERT INTO receipts
      (receipt_id, userId, subtotal, discount_amount, final_total, payment_method)
      VALUES (?, ?, ?, ?, ?, ?)
    `;
    db.query(
      sql,
      [
        receipt.receipt_id,
        receipt.userId,
        receipt.subtotal,
        receipt.discount_amount,
        receipt.final_total,
        receipt.payment_method
      ],
      callback
    );
  },

  addItems(receiptId, items, callback) {
    if (!items || items.length === 0) return callback(null);
    const sql = `
      INSERT INTO receipt_items
      (receipt_id, product_id, product_name, quantity, unit_price)
      VALUES ?
    `;
    const values = items.map(item => [
      receiptId,
      item.productId,
      item.productName,
      item.quantity,
      item.price
    ]);
    db.query(sql, [values], callback);
  },

  getByReceiptId(receiptId, callback) {
    const receiptSql = `
      SELECT receipt_id, userId, subtotal, discount_amount, final_total, payment_method, createdAt,
             refunded_amount, refunded_at, refunded_by
      FROM receipts
      WHERE receipt_id = ?
      LIMIT 1
    `;
    db.query(receiptSql, [receiptId], (err, rows) => {
      if (err) return callback(err);
      if (!rows || rows.length === 0) return callback(null, null);
      const receipt = rows[0];

      const itemsSql = `
        SELECT product_id, product_name, quantity, unit_price
        FROM receipt_items
        WHERE receipt_id = ?
        ORDER BY id ASC
      `;
      db.query(itemsSql, [receiptId], (itemsErr, items) => {
        if (itemsErr) return callback(itemsErr);
        callback(null, { receipt, items, userId: receipt.userId });
      });
    });
  },

  markRefunded(receiptId, refundedBy, amount, callback) {
    const sql = `
      UPDATE receipts
      SET refunded_amount = ?, refunded_at = NOW(), refunded_by = ?
      WHERE receipt_id = ? AND (refunded_amount IS NULL OR refunded_amount = 0)
    `;
    db.query(sql, [amount, refundedBy, receiptId], callback);
  }
};
