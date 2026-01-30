const db = require('../db');

module.exports = {
  create({ username, email, password, address, contact, role }, callback) {
    const sql = 'INSERT INTO users (username, email, password, address, contact, role) VALUES (?, ?, SHA1(?), ?, ?, ?)';
    db.query(sql, [username, email, password, address, contact, role], callback);
  },
  findByEmailAndPassword(email, password, callback) {
    const sql = 'SELECT * FROM users WHERE email = ? AND password = SHA1(?) AND is_active = 1';
    db.query(sql, [email, password], (err, rows) => {
      if (err) return callback(err);
      callback(null, rows[0] || null);
    });
  },
  findById(id, callback) {
    db.query('SELECT * FROM users WHERE id = ?', [id], (err, rows) => {
      if (err) return callback(err);
      callback(null, rows[0] || null);
    });
  },
  listRecent(limit, callback) {
    const sql = `
      SELECT id, username, email, role, address, contact, is_active
      FROM users
      ORDER BY id DESC
      LIMIT ?
    `;
    db.query(sql, [limit], callback);
  },
  deleteById(id, callback) {
    db.query('UPDATE users SET is_active = 0 WHERE id = ?', [id], callback);
  }
};
