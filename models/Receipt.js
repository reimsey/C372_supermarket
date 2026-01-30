const db = require('../db');

module.exports = {
  create(receipt, callback) {
    const sql = `
      INSERT INTO receipts
      (receipt_id, userId, subtotal, discount_amount, delivery_fee, final_total, payment_method, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
    db.query(
      sql,
      [
        receipt.receipt_id,
        receipt.userId,
        receipt.subtotal,
        receipt.discount_amount,
        receipt.delivery_fee || 0,
        receipt.final_total,
        receipt.payment_method,
        receipt.status || 'processing'
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
      SELECT receipt_id, userId, subtotal, discount_amount, delivery_fee, final_total, payment_method, status,
             createdAt, delivered_at, completed_at,
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
        const discountSql = `
          SELECT code, discount_amount
          FROM receipt_discounts
          WHERE receipt_id = ?
          ORDER BY id ASC
        `;
        db.query(discountSql, [receiptId], (discErr, discounts) => {
          if (discErr) return callback(discErr);
          callback(null, { receipt, items, discounts: discounts || [], userId: receipt.userId });
        });
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
  },

  markDelivered(receiptId, callback) {
    const sql = `
      UPDATE receipts
      SET status = 'delivered', delivered_at = NOW()
      WHERE receipt_id = ? AND status = 'processing'
    `;
    db.query(sql, [receiptId], callback);
  },

  markCompleted(receiptId, callback) {
    const sql = `
      UPDATE receipts
      SET status = 'completed', completed_at = NOW()
      WHERE receipt_id = ? AND status = 'delivered'
    `;
    db.query(sql, [receiptId], callback);
  }
};
