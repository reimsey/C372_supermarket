const db = require('../db');
const util = require('util');

const query = util.promisify(db.query).bind(db);

module.exports = {
  async getAccount(userId) {
    const rows = await query('SELECT * FROM loyalty_accounts WHERE user_id = ? LIMIT 1', [userId]);
    return rows[0] || { user_id: userId, points_balance: 0, lifetime_earned: 0 };
  },

  async getBalance(userId) {
    const account = await this.getAccount(userId);
    return Number(account.points_balance) || 0;
  },

  async credit(userId, points, note) {
    const amount = Math.max(0, Math.floor(Number(points) || 0));
    if (!amount) return this.getAccount(userId);
    const sql = `
      INSERT INTO loyalty_accounts (user_id, points_balance, lifetime_earned, updated_at)
      VALUES (?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE
        points_balance = points_balance + VALUES(points_balance),
        lifetime_earned = lifetime_earned + VALUES(lifetime_earned),
        updated_at = NOW()
    `;
    await query(sql, [userId, amount, amount]);
    return this.getAccount(userId);
  },

  async debit(userId, points) {
    const amount = Math.max(0, Math.floor(Number(points) || 0));
    if (!amount) return this.getAccount(userId);
    const account = await this.getAccount(userId);
    const balance = Number(account.points_balance) || 0;
    if (balance < amount) {
      const err = new Error('Not enough points');
      err.code = 'INSUFFICIENT_POINTS';
      throw err;
    }
    await query(
      'UPDATE loyalty_accounts SET points_balance = points_balance - ?, updated_at = NOW() WHERE user_id = ?',
      [amount, userId]
    );
    return this.getAccount(userId);
  }
};
