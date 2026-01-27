const db = require('../db');

module.exports = {
  saveLineItem({ userId, productId, qty, price, paymentMethod, receiptId }, callback) {
    const sql = `
      INSERT INTO orders (userId, productId, qty, price, paymentMethod, receipt_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `;
    db.query(sql, [userId, productId, qty, price, paymentMethod || null, receiptId || null], callback);
  },
  getHistoryByUser(userId, callback) {
    const sql = `
      SELECT orders.*, products.productName, products.image, products.category,
             receipts.subtotal, receipts.discount_amount, receipts.final_total,
             receipts.receipt_id AS receipt_id, receipts.payment_method AS receipt_payment_method,
             receipts.refunded_amount AS refunded_amount, receipts.refunded_at AS refunded_at
      FROM orders
      JOIN products ON orders.productId = products.id
      LEFT JOIN receipts ON orders.receipt_id = receipts.receipt_id
      WHERE orders.userId = ?
      ORDER BY orders.purchasedAt DESC
    `;
    db.query(sql, [userId], callback);
  },
  getAllWithUserProduct(callback) {
    const sql = `
      SELECT orders.*, users.username, users.email, users.contact,
             products.productName, products.category,
             receipts.subtotal, receipts.discount_amount, receipts.final_total,
             receipts.receipt_id AS receipt_id, receipts.payment_method AS receipt_payment_method,
             receipts.refunded_amount AS refunded_amount, receipts.refunded_at AS refunded_at
      FROM orders
      JOIN users ON orders.userId = users.id
      JOIN products ON orders.productId = products.id
      LEFT JOIN receipts ON orders.receipt_id = receipts.receipt_id
      ORDER BY orders.purchasedAt DESC
    `;
    db.query(sql, callback);
  }
};
