const db = require('../db');

module.exports = {
  listByUser(userId, callback) {
    const sql = `
      SELECT id, userId, methodName, maskedDetails AS cardNumber, maskedDetails, expireDate, createdAt
      FROM payment_methods
      WHERE userId = ?
      ORDER BY createdAt DESC
    `;
    db.query(sql, [userId], callback);
  },
  add(userId, { methodName, cardNumber, expireDate }, callback) {
    const sql = `
      INSERT INTO payment_methods (userId, methodName, maskedDetails, expireDate)
      VALUES (?, ?, ?, ?)
    `;
    db.query(sql, [userId, methodName, cardNumber, expireDate], callback);
  },
  update(userId, id, { methodName, cardNumber, expireDate }, callback) {
    const sql = `
      UPDATE payment_methods
      SET methodName = ?, maskedDetails = ?, expireDate = ?
      WHERE id = ? AND userId = ?
    `;
    db.query(sql, [methodName, cardNumber, expireDate, id, userId], callback);
  },
  remove(userId, id, callback) {
    db.query('DELETE FROM payment_methods WHERE id = ? AND userId = ?', [id, userId], callback);
  }
};
