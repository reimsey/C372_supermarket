const db = require('../db');

module.exports = {
  getItemsByUser(userId, callback) {
    const sql = `
      SELECT 
        cart.id,
        cart.userId,
        cart.productId,
        cart.qty AS quantity,
        products.productName,
        products.price,
        products.image,
        products.category
      FROM cart
      JOIN products ON cart.productId = products.id
      WHERE cart.userId = ?
    `;
    db.query(sql, [userId], callback);
  },
  addOrIncrement(userId, productId, qty, callback) {
    const checkSql = 'SELECT qty FROM cart WHERE userId = ? AND productId = ?';
    db.query(checkSql, [userId, productId], (err, rows) => {
      if (err) return callback(err);
      if (rows && rows.length) {
        const newQty = (rows[0].qty || 0) + qty;
        return db.query(
          'UPDATE cart SET qty = ? WHERE userId = ? AND productId = ?',
          [newQty, userId, productId],
          callback
        );
      }
      return db.query(
        'INSERT INTO cart (userId, productId, qty) VALUES (?, ?, ?)',
        [userId, productId, qty],
        callback
      );
    });
  },
  deleteItem(userId, productId, callback) {
    db.query('DELETE FROM cart WHERE userId = ? AND productId = ?', [userId, productId], callback);
  },
  clear(userId, callback) {
    db.query('DELETE FROM cart WHERE userId = ?', [userId], callback);
  }
};
