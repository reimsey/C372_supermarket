const db = require('../db');

const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const ensureWalletRow = (userId, callback) => {
  db.query('INSERT IGNORE INTO wallets (userId, balance) VALUES (?, 0.00)', [userId], callback);
};

const withTransaction = (work, callback) => {
  db.beginTransaction((beginErr) => {
    if (beginErr) return callback(beginErr);
    work((err, result) => {
      if (err) return db.rollback(() => callback(err));
      db.commit((commitErr) => {
        if (commitErr) return db.rollback(() => callback(commitErr));
        callback(null, result);
      });
    });
  });
};

module.exports = {
  getBalance(userId, callback) {
    ensureWalletRow(userId, (err) => {
      if (err) return callback(err);
      db.query('SELECT balance FROM wallets WHERE userId = ?', [userId], (selErr, rows) => {
        if (selErr) return callback(selErr);
        const balance = rows && rows[0] ? Number(rows[0].balance) : 0;
        callback(null, balance);
      });
    });
  },

  listLedger(userId, limit, callback) {
    const sql = `
      SELECT type, amount, balance_after, reference_type, reference_id, note, createdAt
      FROM wallet_ledger
      WHERE userId = ?
      ORDER BY createdAt DESC
      LIMIT ?
    `;
    db.query(sql, [userId, limit], callback);
  },

  credit(userId, amount, meta, callback) {
    const amt = roundMoney(Math.max(0, Number(amount) || 0));
    if (amt <= 0) return callback(new Error('Invalid amount'));

    withTransaction((done) => {
      ensureWalletRow(userId, (ensureErr) => {
        if (ensureErr) return done(ensureErr);
        db.query('SELECT balance FROM wallets WHERE userId = ? FOR UPDATE', [userId], (selErr, rows) => {
          if (selErr) return done(selErr);
          const current = rows && rows[0] ? Number(rows[0].balance) : 0;
          const next = roundMoney(current + amt);

          db.query('UPDATE wallets SET balance = ? WHERE userId = ?', [next, userId], (updErr) => {
            if (updErr) return done(updErr);
            const ledgerSql = `
              INSERT INTO wallet_ledger (userId, type, amount, balance_after, reference_type, reference_id, note)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `;
            db.query(
              ledgerSql,
              [userId, meta.type, amt, next, meta.reference_type || null, meta.reference_id || null, meta.note || null],
              (ledErr) => done(ledErr, next)
            );
          });
        });
      });
    }, callback);
  },

  debit(userId, amount, meta, callback) {
    const amt = roundMoney(Math.max(0, Number(amount) || 0));
    if (amt <= 0) return callback(new Error('Invalid amount'));

    withTransaction((done) => {
      ensureWalletRow(userId, (ensureErr) => {
        if (ensureErr) return done(ensureErr);
        db.query('SELECT balance FROM wallets WHERE userId = ? FOR UPDATE', [userId], (selErr, rows) => {
          if (selErr) return done(selErr);
          const current = rows && rows[0] ? Number(rows[0].balance) : 0;
          if (current < amt) return done(new Error('Insufficient wallet balance'));
          const next = roundMoney(current - amt);

          db.query('UPDATE wallets SET balance = ? WHERE userId = ?', [next, userId], (updErr) => {
            if (updErr) return done(updErr);
            const ledgerSql = `
              INSERT INTO wallet_ledger (userId, type, amount, balance_after, reference_type, reference_id, note)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `;
            db.query(
              ledgerSql,
              [userId, meta.type, amt, next, meta.reference_type || null, meta.reference_id || null, meta.note || null],
              (ledErr) => done(ledErr, next)
            );
          });
        });
      });
    }, callback);
  }
};
