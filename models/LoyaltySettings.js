const db = require('../db');
const util = require('util');

const query = util.promisify(db.query).bind(db);

const DEFAULT_POINT_VALUE = 0.01;

module.exports = {
  async getSettings() {
    const rows = await query('SELECT * FROM loyalty_settings WHERE id = 1');
    if (!rows || rows.length === 0) {
      return { id: 1, point_value: DEFAULT_POINT_VALUE };
    }
    return rows[0];
  },

  async setPointValue(pointValue) {
    const value = Number(pointValue) || DEFAULT_POINT_VALUE;
    const sql = `
      INSERT INTO loyalty_settings (id, point_value)
      VALUES (1, ?)
      ON DUPLICATE KEY UPDATE point_value = VALUES(point_value)
    `;
    await query(sql, [value]);
    return this.getSettings();
  }
};
