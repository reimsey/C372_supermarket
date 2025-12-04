const db = require('../db');

const DEFAULT_CATEGORIES = [
    'Fruits',
    'Vegetables',
    'Dairy',
    'Meat',
    'Baked Goods',
    'Beverages',
    'Snacks',
    'Household Items',
    'Others'
];

const Supermarket = {
    // Products: fetch all
    getAllProducts: (callback) => {
        const sql = 'SELECT * FROM products';
        db.query(sql, (err, results) => {
            if (err) {
                return callback(err, null);
            }
            callback(null, results);
        });
    },

    // Products: fetch one by id
    getProductById: (productId, callback) => {
        const sql = 'SELECT * FROM products WHERE id = ?';
        db.query(sql, [productId], (err, results) => {
            if (err) {
                return callback(err, null);
            }
            callback(null, results[0]);
        });
    },

    // Products: add new
    addProduct: (productData, callback) => {
        const sql = 'INSERT INTO products (productName, quantity, price, image, category) VALUES (?, ?, ?, ?, ?)';
        const { name, quantity, price, image, category } = productData;
        
        db.query(sql, [name, quantity, price, image, category], (err, result) => {
            if (err) {
                return callback(err, null);
            }
            callback(null, result);
        });
    },

    // Products: update existing
    updateProduct: (productId, productData, callback) => {
        const sql = 'UPDATE products SET productName = ?, quantity = ?, price = ?, image = ?, category = ? WHERE id = ?';
        const { name, quantity, price, image, category } = productData;

        db.query(sql, [name, quantity, price, image, category, productId], (err, result) => {
            if (err) {
                return callback(err, null);
            }
            callback(null, result);
        });
    },

    // Products: decrease stock after purchase (guard against negatives)
    decrementProductQuantity: (productId, qty, callback) => {
        const sql = `
            UPDATE products
            SET quantity = quantity - ?
            WHERE id = ? AND quantity >= ?
        `;
        db.query(sql, [qty, productId, qty], (err, result) => {
            if (err) {
                return callback(err);
            }
            // If no rows were affected, there wasn't enough stock
            if (result.affectedRows === 0) {
                return callback(new Error('Insufficient stock'));
            }
            callback(null, result);
        });
    },

    // Products: delete
    deleteProduct: (productId, callback) => {
        const sql = 'DELETE FROM products WHERE id = ?';
        db.query(sql, [productId], (err, result) => {
            if (err) {
                return callback(err, null);
            }
            callback(null, result);
        });
    },
    // ---------------- CART FUNCTIONS ----------------

    // Cart: add to DB cart (legacy)
    addToCart: (userId, productId, qty, callback) => {
        const sql = "INSERT INTO cart (userId, productId, qty) VALUES (?, ?, ?)";
        db.query(sql, [userId, productId, qty], callback);
    },

    // Cart: get items (joins products)
    getCartItems: (userId, callback) => {
        const sql = `
            SELECT 
                cart.id,
                cart.userId,
                cart.productId,
                cart.qty AS quantity,
                products.productName,
                products.price,
                products.image 
            FROM cart 
            JOIN products ON cart.productId = products.id
            WHERE cart.userId = ?
        `;
        db.query(sql, [userId], callback);
    },

    // Cart: add or increment existing item
    addOrUpdateCartItem: (userId, productId, qty, callback) => {
        const checkSql = "SELECT qty FROM cart WHERE userId = ? AND productId = ?";
        db.query(checkSql, [userId, productId], (err, rows) => {
            if (err) return callback(err);
            if (rows && rows.length) {
                const newQty = (rows[0].qty || 0) + qty;
                const updateSql = "UPDATE cart SET qty = ? WHERE userId = ? AND productId = ?";
                return db.query(updateSql, [newQty, userId, productId], callback);
            }
            const insertSql = "INSERT INTO cart (userId, productId, qty) VALUES (?, ?, ?)";
            return db.query(insertSql, [userId, productId, qty], callback);
        });
    },

    // Cart: delete one item
    deleteCartItem: (userId, productId, callback) => {
        const sql = "DELETE FROM cart WHERE userId = ? AND productId = ?";
        db.query(sql, [userId, productId], callback);
    },

    // Cart: clear cart after purchase
    clearCart: (userId, callback) => {
        const sql = "DELETE FROM cart WHERE userId = ?";
        db.query(sql, [userId], callback);
    },

    // ---------------- ORDER FUNCTIONS ----------------

    // Orders: save a line item purchase
    saveOrder: (orderData, callback) => {
        const sql = `
            INSERT INTO orders (userId, productId, qty, price, paymentMethod)
            VALUES (?, ?, ?, ?, ?)
        `;
        db.query(sql, [orderData.userId, orderData.productId, orderData.qty, orderData.price, orderData.paymentMethod || null], callback);
    },

    // Orders: history for a user
    getPurchaseHistory: (userId, callback) => {
        const sql = `
            SELECT orders.*, products.productName, products.image, products.category 
            FROM orders 
            JOIN products ON orders.productId = products.id
            WHERE orders.userId = ?
            ORDER BY purchasedAt DESC
        `;
        db.query(sql, [userId], callback);
    },

    // Orders: all purchases (admin view)
    getAllPurchases: (callback) => {
        const sql = `
            SELECT orders.*, users.username, users.email, users.contact, products.productName, products.category 
            FROM orders 
            JOIN users ON orders.userId = users.id
            JOIN products ON orders.productId = products.id
            ORDER BY purchasedAt DESC
        `;
        db.query(sql, callback);
    },

    // ---------------- PAYMENT METHODS (SIMULATED) ----------------

    getPaymentMethods: (userId, callback) => {
        const sql = `
            SELECT
                id,
                userId,
                methodName,
                maskedDetails AS cardNumber,
                maskedDetails,
                expireDate,
                createdAt
            FROM payment_methods
            WHERE userId = ?
            ORDER BY createdAt DESC
        `;
        db.query(sql, [userId], callback);
    },

    addPaymentMethod: (userId, method, callback) => {
        const cardNumber = method.cardNumber || method.maskedDetails || '';
        const sql = `
            INSERT INTO payment_methods (userId, methodName, maskedDetails, expireDate)
            VALUES (?, ?, ?, ?)
        `;
        db.query(sql, [userId, method.methodName, cardNumber, method.expireDate], callback);
    },

    updatePaymentMethod: (userId, methodId, method, callback) => {
        const cardNumber = method.cardNumber || method.maskedDetails || '';
        const sql = `
            UPDATE payment_methods
            SET methodName = ?, maskedDetails = ?, expireDate = ?
            WHERE id = ? AND userId = ?
        `;
        db.query(sql, [method.methodName, cardNumber, method.expireDate, methodId, userId], callback);
    },

    deletePaymentMethod: (userId, methodId, callback) => {
        const sql = `DELETE FROM payment_methods WHERE id = ? AND userId = ?`;
        db.query(sql, [methodId, userId], callback);
    },

    // ---------------- ADMIN VERIFICATION ----------------

    // Admins: register pending admin
    registerAdmin: (userId, callback) => {
        const sql = "INSERT INTO admins (userId) VALUES (?)";
        db.query(sql, [userId], callback);
    },

    // Admins: verify admin
    verifyAdmin: (adminId, callback) => {
        const sql = "UPDATE admins SET isVerified = 1 WHERE id = ?";
        db.query(sql, [adminId], callback);
    },

    // Admins: list pending
    getPendingAdmins: (callback) => {
        const sql = "SELECT * FROM admins WHERE isVerified = 0";
        db.query(sql, callback);
    },

    // Users: recent signups for admin
    getRecentUsers: (limit, callback) => {
        const sql = `
            SELECT id, username, email, role, address, contact
            FROM users
            ORDER BY id DESC
            LIMIT ?
        `;
        db.query(sql, [limit], callback);
    },

    // ----------- CATEGORY MANAGEMENT -----------
    // Hardcoded categories for forms/filters
    getCategories: (callback) => {
        callback(null, DEFAULT_CATEGORIES.map(name => ({ name })));
    }

    };

    module.exports = Supermarket;
