const db = require('../db');

const Admin = {
    // List recent user sign-ups
    listRecent: (limit, callback) => {
        const sql = `
            SELECT id, username, email, role, createdAt 
            FROM users 
            WHERE role = 'admin' AND verified = 0 
            ORDER BY createdAt DESC 
            LIMIT ?
        `;
        db.query(sql, [limit], (err, results) => {
            if (err) {
                return callback(err, null);
            }
            callback(null, results);
        });
    },

    // Verify an admin
    verify: (adminId, callback) => {
        const sql = `
            UPDATE users 
            SET verified = 1 
            WHERE id = ? AND role = 'admin'
        `;
        db.query(sql, [adminId], (err, result) => {
            if (err) {
                return callback(err, null);
            }
            callback(null, result);
        });
    }
};

module.exports = Admin;