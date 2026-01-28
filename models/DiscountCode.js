const db = require('../db');
const util = require('util');

const query = util.promisify(db.query).bind(db);

const normalizeCode = (code) => String(code || '').trim().toUpperCase();

module.exports = {
  normalizeCode,

  async listAll() {
    const sql = `
      SELECT d.*,
             (SELECT COUNT(*) FROM discount_code_redemptions r WHERE r.discount_code_id = d.id) AS total_used
      FROM discount_codes d
      ORDER BY d.created_at DESC
    `;
    return query(sql);
  },

  async getById(id) {
    const rows = await query('SELECT * FROM discount_codes WHERE id = ?', [id]);
    return rows[0] || null;
  },

  async getByCode(code) {
    const normalized = normalizeCode(code);
    const rows = await query('SELECT * FROM discount_codes WHERE UPPER(code) = UPPER(?) LIMIT 1', [normalized]);
    return rows[0] || null;
  },

  async listAutoApplyActive() {
    const sql = `
      SELECT *
      FROM discount_codes
      WHERE auto_apply = 1 AND is_active = 1
      ORDER BY created_at DESC
    `;
    return query(sql);
  },

  async create(data) {
    const sql = `
      INSERT INTO discount_codes
      (code, type, scope, discount_type, discount_value, min_spend, max_discount, starts_at, expires_at,
       total_usage_limit, per_user_limit, stackable, auto_apply, is_active, description)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const params = [
      normalizeCode(data.code),
      data.type,
      data.scope,
      data.discount_type,
      data.discount_value,
      data.min_spend || 0,
      data.max_discount || null,
      data.starts_at || null,
      data.expires_at || null,
      data.total_usage_limit || null,
      data.per_user_limit || null,
      data.stackable ? 1 : 0,
      data.auto_apply ? 1 : 0,
      data.is_active ? 1 : 0,
      data.description || null
    ];
    const result = await query(sql, params);
    return result.insertId;
  },

  async update(id, data) {
    const sql = `
      UPDATE discount_codes
      SET code = ?, type = ?, scope = ?, discount_type = ?, discount_value = ?, min_spend = ?, max_discount = ?,
          starts_at = ?, expires_at = ?, total_usage_limit = ?, per_user_limit = ?,
          stackable = ?, auto_apply = ?, is_active = ?, description = ?
      WHERE id = ?
    `;
    const params = [
      normalizeCode(data.code),
      data.type,
      data.scope,
      data.discount_type,
      data.discount_value,
      data.min_spend || 0,
      data.max_discount || null,
      data.starts_at || null,
      data.expires_at || null,
      data.total_usage_limit || null,
      data.per_user_limit || null,
      data.stackable ? 1 : 0,
      data.auto_apply ? 1 : 0,
      data.is_active ? 1 : 0,
      data.description || null,
      id
    ];
    return query(sql, params);
  },

  async toggleActive(id, isActive) {
    return query('UPDATE discount_codes SET is_active = ? WHERE id = ?', [isActive ? 1 : 0, id]);
  },

  async remove(id) {
    return query('DELETE FROM discount_codes WHERE id = ?', [id]);
  },

  async listProductIds(id) {
    const rows = await query('SELECT product_id FROM discount_code_products WHERE discount_code_id = ?', [id]);
    return rows.map(row => row.product_id);
  },

  async setProducts(id, productIds) {
    await query('DELETE FROM discount_code_products WHERE discount_code_id = ?', [id]);
    if (!productIds || productIds.length === 0) return;
    const values = productIds.map(productId => [id, productId]);
    const sql = 'INSERT INTO discount_code_products (discount_code_id, product_id) VALUES ?';
    return query(sql, [values]);
  },

  async getUsageCounts(id, userId) {
    const totalRows = await query(
      'SELECT COUNT(*) AS total FROM discount_code_redemptions WHERE discount_code_id = ?',
      [id]
    );
    const userRows = await query(
      'SELECT COUNT(*) AS total FROM discount_code_redemptions WHERE discount_code_id = ? AND user_id = ?',
      [id, userId]
    );
    return {
      total: totalRows[0]?.total || 0,
      user: userRows[0]?.total || 0
    };
  },

  async recordRedemptions(userId, receiptId, appliedCodes) {
    if (!appliedCodes || appliedCodes.length === 0) return;

    const redemptionValues = appliedCodes.map(code => [
      code.id,
      userId,
      receiptId,
      code.amount
    ]);

    const receiptValues = appliedCodes.map(code => [
      receiptId,
      code.id,
      code.code,
      code.amount
    ]);

    await query(
      'INSERT INTO discount_code_redemptions (discount_code_id, user_id, order_receipt_id, discount_amount) VALUES ?',
      [redemptionValues]
    );
    await query(
      'INSERT INTO receipt_discounts (receipt_id, discount_code_id, code, discount_amount) VALUES ?',
      [receiptValues]
    );
  }
};
