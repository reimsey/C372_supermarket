const db = require('../db');
const util = require('util');

const query = util.promisify(db.query).bind(db);

module.exports = {
  async getByUser(userId) {
    const rows = await query('SELECT * FROM subscriptions WHERE user_id = ? LIMIT 1', [userId]);
    return rows[0] || null;
  },

  async ensureActive(userId) {
    const sql = `
      INSERT INTO subscriptions (user_id, is_active, started_at, first_delivery_used)
      VALUES (?, 1, NOW(), 0)
      ON DUPLICATE KEY UPDATE is_active = 1, started_at = IFNULL(started_at, NOW())
    `;
    await query(sql, [userId]);
    return this.getByUser(userId);
  },

  async markFirstDeliveryUsed(userId) {
    await query(
      'UPDATE subscriptions SET first_delivery_used = 1, updated_at = NOW() WHERE user_id = ? AND first_delivery_used = 0',
      [userId]
    );
  }
};
