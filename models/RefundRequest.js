const db = require('../db');
const util = require('util');

const query = util.promisify(db.query).bind(db);

module.exports = {
  async create({ receiptId, userId, amount, reason }) {
    const sql = `
      INSERT INTO refund_requests (receipt_id, user_id, amount, reason, status)
      VALUES (?, ?, ?, ?, 'pending')
    `;
    const result = await query(sql, [receiptId, userId, amount, reason || null]);
    return result.insertId;
  },

  async getByReceiptId(receiptId) {
    const rows = await query('SELECT * FROM refund_requests WHERE receipt_id = ? LIMIT 1', [receiptId]);
    return rows[0] || null;
  },

  async getById(id) {
    const rows = await query('SELECT * FROM refund_requests WHERE id = ? LIMIT 1', [id]);
    return rows[0] || null;
  },

  async listByReceiptIds(receiptIds) {
    if (!receiptIds || receiptIds.length === 0) return [];
    const rows = await query(
      'SELECT * FROM refund_requests WHERE receipt_id IN (?)',
      [receiptIds]
    );
    return rows || [];
  },

  async listAllWithDetails() {
    const sql = `
      SELECT rr.*, users.username, users.email
      FROM refund_requests rr
      LEFT JOIN users ON rr.user_id = users.id
      ORDER BY rr.created_at DESC
    `;
    return query(sql);
  },

  async approve(id, adminId) {
    const sql = `
      UPDATE refund_requests
      SET status = 'approved', approved_by = ?, approved_at = NOW()
      WHERE id = ? AND status = 'pending'
    `;
    const result = await query(sql, [adminId, id]);
    return result.affectedRows > 0;
  },

  async reject(id, adminId, note) {
    const sql = `
      UPDATE refund_requests
      SET status = 'rejected', approved_by = ?, approved_at = NOW(), admin_note = ?
      WHERE id = ? AND status = 'pending'
    `;
    const result = await query(sql, [adminId, note || null, id]);
    return result.affectedRows > 0;
  }
};
