const db = require('../db');

module.exports = {
  saveLineItem({ userId, productId, qty, price, paymentMethod }, callback) {
    const sql = `
      INSERT INTO orders (userId, productId, qty, price, paymentMethod)
      VALUES (?, ?, ?, ?, ?)
    `;
    db.query(sql, [userId, productId, qty, price, paymentMethod || null], callback);
  },
  getHistoryByUser(userId, callback) {
    const sql = `
      SELECT orders.*, products.productName, products.image, products.category
      FROM orders
      JOIN products ON orders.productId = products.id
      WHERE orders.userId = ?
      ORDER BY purchasedAt DESC
    `;
    db.query(sql, [userId], callback);
  },
  getAllWithUserProduct(callback) {
    const sql = `
      SELECT orders.*, users.username, users.email, users.contact,
             products.productName, products.category
      FROM orders
      JOIN users ON orders.userId = users.id
      JOIN products ON orders.productId = products.id
      ORDER BY purchasedAt DESC
    `;
    db.query(sql, callback);
  }
};
