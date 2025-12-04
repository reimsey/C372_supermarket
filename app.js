const express = require('express');
const db = require('./db'); // use centralized db connection
const session = require('express-session');
const flash = require('connect-flash');
const multer = require('multer');
const app = express();
const SupermarketController = require('./controllers/SupermarketControllers');
const Supermarket = require('./models/Supermarket'); // for add-to-cart and shopping rendering

// Set up multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'public/images'); // Directory to save uploaded files
    },
    filename: (req, file, cb) => {
        cb(null, file.originalname);
    }
});

const upload = multer({ storage: storage });

// Set up view engine
app.set('view engine', 'ejs');
//  enable static files
app.use(express.static('public'));
// enable form processing
app.use(express.urlencoded({
    extended: false
}));

// Session Middleware
app.use(session({
    secret: 'secret',
    resave: false,
    saveUninitialized: true,
    // Session expires after 1 week of inactivity
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

app.use(flash());

// Middleware to check if user is logged in
const checkAuthenticated = (req, res, next) => {
    if (req.session.user) {
        return next();
    } else {
        req.flash('error', 'Please log in to view this resource');
        res.redirect('/login');
    }
};

// Middleware to check if user is admin
const checkAdmin = (req, res, next) => {
    if (req.session.user && req.session.user.role === 'admin') {
        return next();
    } else {
        req.flash('error', 'Access denied');
        res.redirect('/shopping');
    }
};

// Middleware for form validation
const validateRegistration = (req, res, next) => {
    const { username, email, password, address, contact, role } = req.body;

    if (!username || !email || !password || !address || !contact || !role) {
        return res.status(400).send('All fields are required.');
    }

    if (password.length < 6) {
        req.flash('error', 'Password should be at least 6 or more characters long');
        req.flash('formData', req.body);
        return res.redirect('/register');
    }
    next();
};

// Define routes
app.get('/', (req, res) => {
    Supermarket.getAllProducts((err, results) => {
        if (err) {
            console.error('Error fetching products for home preview:', err);
            return res.render('index', { user: req.session.user, previewProducts: [] });
        }
        // limit preview to a handful
        const previewProducts = (results || []).slice(0, 6);
        res.render('index', { user: req.session.user, previewProducts });
    });
});

// Use controller for inventory (list products)
app.get('/inventory', checkAuthenticated, checkAdmin, SupermarketController.listProducts);

// Registration routes (use centralized db)
app.get('/register', (req, res) => {
    res.render('register', { messages: req.flash('error'), formData: req.flash('formData')[0] });
});

app.post('/register', validateRegistration, (req, res) => {
    const { username, email, password, address, contact, role } = req.body;

    const sql = 'INSERT INTO users (username, email, password, address, contact, role) VALUES (?, ?, SHA1(?), ?, ?, ?)';
    db.query(sql, [username, email, password, address, contact, role], (err, result) => {
        if (err) {
            console.error('Error registering user:', err);
            return res.status(500).send('Registration failed');
        }
        req.flash('success', 'Registration successful! Please log in.');
        res.redirect('/login');
    });
});

// Login routes (use centralized db)
app.get('/login', (req, res) => {
    res.render('login', { messages: req.flash('success'), errors: req.flash('error') });
});

app.post('/login', (req, res) => {
    const { email, password } = req.body;

    // Validate email and password
    if (!email || !password) {
        req.flash('error', 'All fields are required.');
        return res.redirect('/login');
    }

    const sql = 'SELECT * FROM users WHERE email = ? AND password = SHA1(?)';
    db.query(sql, [email, password], (err, results) => {
        if (err) {
            console.error('Login error:', err);
            return res.status(500).send('Login error');
        }

        if (results.length > 0) {
            // Successful login
            req.session.user = results[0];
            req.flash('success', 'Login successful!');
            if (req.session.user.role === 'user')
                res.redirect('/shopping');
            else
                res.redirect('/inventory');
        } else {
            // Invalid credentials
            req.flash('error', 'Invalid email or password.');
            res.redirect('/login');
        }
    });
});

// Shopping - render shopping view with all products (use model)
app.get('/shopping', checkAuthenticated, (req, res) => {
    Supermarket.getAllProducts((err, results) => {
        if (err) {
            console.error('Error fetching products for shopping:', err);
            return res.status(500).send('Failed to load products');
        }
        Supermarket.getCategories((catErr, categories) => {
            const categoryOptions = (!catErr && categories && categories.length) ? categories : [];
            res.render('shopping', { user: req.session.user, products: results, categories: categoryOptions });
        });
    });
});

// Add to cart (DB-backed)
app.post('/add-to-cart/:id', checkAuthenticated, SupermarketController.addToCart);

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});


// Use controller for product details
app.get('/product/:id', checkAuthenticated, SupermarketController.getProduct);

// Use controller for add product form and submission
app.get('/addProduct', checkAuthenticated, checkAdmin, SupermarketController.showAddForm);
app.post('/addProduct', checkAuthenticated, checkAdmin, upload.single('image'), SupermarketController.addProduct);

// Use controller for update product form and submission
app.get('/updateProduct/:id', checkAuthenticated, checkAdmin, SupermarketController.showUpdateForm);
app.post('/updateProduct/:id', checkAuthenticated, checkAdmin, upload.single('image'), SupermarketController.updateProduct);

// Use controller for deleting a product
app.get('/deleteProduct/:id', checkAuthenticated, checkAdmin, SupermarketController.deleteProduct);

// CART
app.post('/add-to-cart', checkAuthenticated, SupermarketController.addToCart);
app.get('/cart', checkAuthenticated, SupermarketController.viewCart);
app.post('/cart/remove/:id', checkAuthenticated, SupermarketController.removeFromCart);

// PURCHASE
app.post('/purchase', checkAuthenticated, SupermarketController.purchase);
app.get('/purchase-history', checkAuthenticated, SupermarketController.purchaseHistory);

// PAYMENT METHODS (simulated)
app.get('/payment-methods', checkAuthenticated, SupermarketController.listPaymentMethods);
app.post('/payment-methods', checkAuthenticated, SupermarketController.addPaymentMethod);
app.post('/payment-methods/:id/update', checkAuthenticated, SupermarketController.updatePaymentMethod);
app.post('/payment-methods/:id/delete', checkAuthenticated, SupermarketController.deletePaymentMethod);

// ADMIN
app.get('/admin/history', checkAuthenticated, checkAdmin, SupermarketController.adminViewHistory);
app.get('/admin/view-signup', checkAuthenticated, checkAdmin, SupermarketController.pendingAdmins);
app.post('/admin/verify/:id', checkAuthenticated, checkAdmin, SupermarketController.verifyAdmin);

// HELP
app.get('/help', (req, res) => {
    res.render('help', { user: req.session.user });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
