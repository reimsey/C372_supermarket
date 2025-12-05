const db = require('../db');

const DEFAULT_CATEGORIES = [
  'Fruits','Vegetables','Dairy','Meat','Baked Goods','Beverages','Snacks','Household Items','Others'
];

module.exports = {
  getAll(callback) {
    db.query('SELECT * FROM products', callback);
  },
  getById(id, callback) {
    db.query('SELECT * FROM products WHERE id = ?', [id], (err, rows) => {
      if (err) return callback(err);
      callback(null, rows[0] || null);
    });
  },
  add({ name, quantity, price, image, category }, callback) {
    const sql = 'INSERT INTO products (productName, quantity, price, image, category) VALUES (?, ?, ?, ?, ?)';
    db.query(sql, [name, quantity, price, image, category], callback);
  },
  update(id, { name, quantity, price, image, category }, callback) {
    const sql = 'UPDATE products SET productName = ?, quantity = ?, price = ?, image = ?, category = ? WHERE id = ?';
    db.query(sql, [name, quantity, price, image, category, id], callback);
  },
  remove(id, callback) {
    db.query('DELETE FROM products WHERE id = ?', [id], callback);
  },
  decrementQuantity(id, qty, callback) {
    const sql = `
      UPDATE products
      SET quantity = quantity - ?
      WHERE id = ? AND quantity >= ?
    `;
    db.query(sql, [qty, id, qty], (err, result) => {
      if (err) return callback(err);
      if (result.affectedRows === 0) return callback(new Error('Insufficient stock'));
      callback(null, result);
    });
  },
  getCategories(callback) {
    callback(null, DEFAULT_CATEGORIES.map(name => ({ name })));
  }
};
