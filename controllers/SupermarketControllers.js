const Supermarket = require('../models/Supermarket'); // model layer

// Controller layer: request handlers + view rendering

const SupermarketController = {
    // Admin inventory list
    listProducts: (req, res) => {
        Supermarket.getAllProducts((err, products) => {
            if (err) {
                console.error('Error fetching products:', err);
                return res.status(500).json({ error: 'Failed to fetch products' });
            }
            Supermarket.getCategories((catErr, categories) => {
                const categoryOptions = (!catErr && categories && categories.length) ? categories : [];
                res.render('inventory', { 
                    products: products,
                    user: req.session.user,
                    categories: categoryOptions
                });
            });
        });
    },

    // Product detail page
    getProduct: (req, res) => {
        const productId = req.params.id;
        
        Supermarket.getProductById(productId, (err, product) => {
            if (err) {
                console.error('Error fetching product:', err);
                return res.status(500).json({ error: 'Failed to fetch product' });
            }
            if (!product) {
                return res.status(404).send('Product not found');
            }
            res.render('product', { 
                product: product,
                user: req.session.user 
            });
        });
    },

    // Add new product
    addProduct: (req, res) => {
        const productData = {
            name: req.body.name,
            quantity: req.body.quantity,
            price: req.body.price,
            image: req.file ? req.file.filename : null,
            category: req.body.category || 'Others'
        };

        Supermarket.addProduct(productData, (err, result) => {
            if (err) {
                console.error('Error adding product:', err);
                return res.status(500).json({ error: 'Failed to add product' });
            }
            res.redirect('/inventory');
        });
    },

    // Update product
    updateProduct: (req, res) => {
        const productId = req.params.id;
        const productData = {
            name: req.body.name,
            quantity: req.body.quantity,
            price: req.body.price,
            image: req.file ? req.file.filename : req.body.currentImage,
            category: req.body.category || 'Others'
        };

        Supermarket.updateProduct(productId, productData, (err, result) => {
            if (err) {
                console.error('Error updating product:', err);
                return res.status(500).json({ error: 'Failed to update product' });
            }
            res.redirect('/inventory');
        });
    },

    // Delete product
    deleteProduct: (req, res) => {
        const productId = req.params.id;

        Supermarket.deleteProduct(productId, (err, result) => {
            if (err) {
                console.error('Error deleting product:', err);
                return res.status(500).json({ error: 'Failed to delete product' });
            }
            res.redirect('/inventory');
        });
    },

    // Show add product form
    showAddForm: (req, res) => {
        Supermarket.getCategories((err, categories) => {
            const categoryOptions = (!err && categories && categories.length) ? categories : [];
            res.render('addProduct', {
                user: req.session.user,
                categories: categoryOptions
            });
        });
    },

    // Show update product form
    showUpdateForm: (req, res) => {
        const productId = req.params.id;
        
        Supermarket.getProductById(productId, (err, product) => {
            if (err) {
                console.error('Error fetching product:', err);
                return res.status(500).json({ error: 'Failed to fetch product' });
            }
            if (!product) {
                return res.status(404).send('Product not found');
            }
            Supermarket.getCategories((catErr, categories) => {
                const categoryOptions = (!catErr && categories && categories.length) ? categories : [];
                res.render('updateProduct', { 
                    product: product,
                    user: req.session.user,
                    categories: categoryOptions
                });
            });
        });
    },
    
        // ---------------- CART CONTROLLER ----------------

    // Cart add (DB-backed)
    addToCart: (req, res) => {
        if (!req.session.user) return res.redirect('/login');
        const userId = req.session.user.id;
        const productId = parseInt(req.params.id || req.body.productId, 10);
        const qty = parseInt(req.body.quantity || req.body.qty, 10) || 1;

        Supermarket.getProductById(productId, (err, product) => {
            if (err || !product) {
                console.error("Error fetching product for cart:", err);
                return res.status(400).send("Invalid product");
            }
            Supermarket.addOrUpdateCartItem(userId, productId, qty, (addErr) => {
                if (addErr) {
                    console.error("Error adding to cart:", addErr);
                    return res.status(500).send("Error adding to cart");
                }
                res.redirect('/cart');
            });
        });
    },

    // Show DB cart and saved payment methods
    viewCart: (req, res) => {
        if (!req.session.user) return res.redirect('/login');
        const userId = req.session.user.id;
        Supermarket.getCartItems(userId, (cartErr, items) => {
            const cart = (!cartErr && items) ? items : [];
            if (cartErr) {
                console.error("Error loading cart items:", cartErr);
            }
            Supermarket.getPaymentMethods(userId, (pmErr, methods) => {
                if (pmErr) {
                    console.error("Error loading payment methods:", pmErr);
                }
                res.render('cart', { cart, user: req.session.user, paymentMethods: methods || [] });
            });
        });
    },

    // Checkout: save orders, decrement stock, clear cart
    purchase: (req, res) => {
        if (!req.session.user) return res.redirect('/login');
        const userId = req.session.user.id;
        const selectedMethodId = req.body.paymentMethodId ? parseInt(req.body.paymentMethodId, 10) : null;
        const fallbackLabel = req.body.paymentMethodLabel || 'Pay on Delivery';

        Supermarket.getCartItems(userId, (cartErr, cart) => {
            if (cartErr) {
                console.error("Error loading cart for purchase:", cartErr);
                return res.status(500).send("Error loading cart");
            }
            if (!cart || cart.length === 0) {
                return res.redirect('/cart');
            }

            const finalize = (paymentLabel) => {
                let remaining = cart.length;
                let hasError = false;

                cart.forEach(item => {
                    const orderData = {
                        userId,
                        productId: item.productId,
                        qty: item.quantity,
                        price: item.price,
                        paymentMethod: paymentLabel
                    };

                    Supermarket.saveOrder(orderData, (err) => {
                        if (err && !hasError) {
                            hasError = true;
                            console.error("Error saving order:", err);
                            return res.status(500).send("Error processing purchase");
                        }

                        // Decrement product stock after saving the order
                        Supermarket.decrementProductQuantity(item.productId, item.quantity, (stockErr) => {
                            if (stockErr && !hasError) {
                                hasError = true;
                                console.error("Error updating stock:", stockErr);
                                return res.status(500).send("Not enough stock for one of the items");
                            }

                            remaining -= 1;
                            if (remaining === 0 && !hasError) {
                                Supermarket.clearCart(userId, (clearErr) => {
                                    if (clearErr) {
                                        console.error("Error clearing cart after purchase:", clearErr);
                                    }
                                    res.redirect('/purchase-history');
                                });
                            }
                        });
                    });
                });
            };

            if (selectedMethodId) {
                Supermarket.getPaymentMethods(userId, (err, methods) => {
                    if (err) {
                        console.error("Error loading payment method:", err);
                        return res.status(500).send("Error processing payment method");
                    }
                    const chosen = (methods || []).find(m => m.id === selectedMethodId);
                    const number = chosen ? (chosen.cardNumber || chosen.maskedDetails || '') : '';
                    const label = chosen ? `${chosen.methodName} ${number}` : fallbackLabel;
                    finalize(label);
                });
            } else {
                finalize(fallbackLabel);
            }
        });
    },

    // Remove one item from cart (DB-backed)
    removeFromCart: (req, res) => {
        if (!req.session.user) return res.redirect('/login');
        const userId = req.session.user.id;
        const productId = parseInt(req.params.id, 10);

        Supermarket.deleteCartItem(userId, productId, (err) => {
            if (err) {
                console.error("Error removing item from cart:", err);
            }
            res.redirect('/cart');
        });
    },

    // User purchase history (grouped)
    purchaseHistory: (req, res) => {
        if (!req.session.user) return res.redirect('/login');
        const userId = req.session.user.id;

        Supermarket.getPurchaseHistory(userId, (err, orders) => {
            if (err) {
                console.error("Error loading orders:", err);
                return res.send("Error loading orders");
            }

            // Group orders by purchase event (timestamp)
            const grouped = new Map();
            orders.forEach(order => {
                const ts = new Date(order.purchasedAt).getTime();
                const key = `${userId}-${ts}`;
                if (!grouped.has(key)) {
                    grouped.set(key, {
                        date: order.purchasedAt,
                        items: [],
                        total: 0,
                        paymentMethod: order.paymentMethod || 'N/A'
                    });
                }
                const entry = grouped.get(key);
                const price = Number(order.price) || 0;
                entry.items.push({
                    productName: order.productName,
                    qty: order.qty,
                    price,
                    category: order.category || 'N/A'
                });
                entry.total += price * (order.qty || 0);
            });

            res.render('purchaseHistory', { 
                purchases: Array.from(grouped.values()),
                user: req.session.user
            });
        });
    },

    // ---------------- ADMIN CONTROLLER ----------------

    // Admin: grouped view of all purchases
    adminViewHistory: (req, res) => {
        Supermarket.getAllPurchases((err, data) => {
            if (err) return res.send("Error loading history");

            // Group by user + purchase timestamp to collect items in a purchase
            const grouped = new Map();
            data.forEach(order => {
                const ts = new Date(order.purchasedAt).getTime();
                const key = `${order.userId}-${ts}`;
                if (!grouped.has(key)) {
                    grouped.set(key, {
                        date: order.purchasedAt,
                        user: {
                            id: order.userId,
                            username: order.username,
                            email: order.email,
                            contact: order.contact
                        },
                        items: [],
                        total: 0,
                        paymentMethod: order.paymentMethod || 'N/A'
                    });
                }
                const entry = grouped.get(key);
                const price = Number(order.price) || 0;
                entry.items.push({
                    productName: order.productName,
                    qty: order.qty,
                    price,
                    category: order.category || 'N/A'
                });
                entry.total += price * (order.qty || 0);
            });

            res.render('adminHistory', { purchases: Array.from(grouped.values()), user: req.session.user });
        });
    },

    // Admin: verify new admin
    verifyAdmin: (req, res) => {
        const adminId = req.params.id;

        Supermarket.verifyAdmin(adminId, () => {
            res.redirect('/admin/view-signup');
        });
    },

    // Admin: view recent signups
    pendingAdmins: (req, res) => {
        // Show newest registered users (both roles) to admins
        Supermarket.getRecentUsers(50, (err, users) => {
            if (err) {
                console.error("Error loading recent users:", err);
                return res.send("Error loading users");
            }
            res.render('viewUsers', { users, user: req.session.user });
        });
    },

    // ---------------- PAYMENT METHOD MANAGEMENT ----------------

    // List payment methods
    listPaymentMethods: (req, res) => {
        if (!req.session.user) return res.redirect('/login');
        Supermarket.getPaymentMethods(req.session.user.id, (err, methods) => {
            if (err) {
                console.error("Error loading payment methods:", err);
                // Gracefully show empty list if table/columns missing
                return res.render('paymentMethods', { user: req.session.user, methods: [] });
            }
            res.render('paymentMethods', { user: req.session.user, methods });
        });
    },

    // Add new payment method (simulated)
    addPaymentMethod: (req, res) => {
        if (!req.session.user) return res.redirect('/login');
        const method = {
            methodName: req.body.methodName,
            cardNumber: req.body.cardNumber || req.body.maskedDetails,
            expireDate: req.body.expireDate
        };
        Supermarket.addPaymentMethod(req.session.user.id, method, (err) => {
            if (err) {
                console.error("Error adding payment method:", err);
            }
            res.redirect('/payment-methods');
        });
    },

    // Update existing payment method
    updatePaymentMethod: (req, res) => {
        if (!req.session.user) return res.redirect('/login');
        const methodId = parseInt(req.params.id, 10);
        const method = {
            methodName: req.body.methodName,
            cardNumber: req.body.cardNumber || req.body.maskedDetails,
            expireDate: req.body.expireDate
        };
        Supermarket.updatePaymentMethod(req.session.user.id, methodId, method, (err) => {
            if (err) {
                console.error("Error updating payment method:", err);
            }
            res.redirect('/payment-methods');
        });
    },

    // Delete payment method
    deletePaymentMethod: (req, res) => {
        if (!req.session.user) return res.redirect('/login');
        const methodId = parseInt(req.params.id, 10);
        Supermarket.deletePaymentMethod(req.session.user.id, methodId, (err) => {
            if (err) {
                console.error("Error deleting payment method:", err);
            }
            res.redirect('/payment-methods');
        });
    }

};

module.exports = SupermarketController;
