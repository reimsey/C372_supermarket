const express = require('express');
const db = require('./db');
const session = require('express-session');
const flash = require('connect-flash');
const multer = require('multer');
const app = express();

const Product = require('./models/Product');
const PaymentMethod = require('./models/PaymentMethod');

const ProductController = require('./controllers/ProductController');
const CartController = require('./controllers/CartController');
const OrderController = require('./controllers/OrderController');
const PaymentMethodController = require('./controllers/PaymentMethodController');
const AdminController = require('./controllers/AdminController');
const WalletController = require('./controllers/WalletController');
const ReceiptController = require('./controllers/ReceiptController');

// Multer config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'public/images'),
  filename: (req, file, cb) => cb(null, file.originalname)
});
const upload = multer({ storage });

// View engine & middleware
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: false }));
app.use(session({
  secret: 'secret',
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
}));
app.use(flash());

// Auth middleware
const checkAuthenticated = (req, res, next) => {
  if (req.session.user) return next();
  req.flash('error', 'Please log in to view this resource');
  res.redirect('/login');
};
const checkAdmin = (req, res, next) => {
  if (req.session.user && req.session.user.role === 'admin') return next();
  req.flash('error', 'Access denied');
  res.redirect('/shopping');
};

// Home (preview products)
app.get('/', (req, res) => {
  Product.getAll((err, results) => {
    if (err) {
      console.error('Error fetching products for home preview:', err);
      return res.render('index', { user: req.session.user, previewProducts: [] });
    }
    const previewProducts = (results || []).slice(0, 6);
    res.render('index', { user: req.session.user, previewProducts });
  });
});

// Auth routes (existing logic kept)
app.get('/register', (req, res) => {
  res.render('register', { messages: req.flash('error'), formData: req.flash('formData')[0] });
});
app.post('/register', (req, res) => {
  const { username, email, password, address, contact, role } = req.body;
  if (!username || !email || !password || !address || !contact || !role) {
    req.flash('error', 'All fields are required.');
    req.flash('formData', req.body);
    return res.redirect('/register');
  }
  if (password.length < 6) {
    req.flash('error', 'Password should be at least 6 or more characters long');
    req.flash('formData', req.body);
    return res.redirect('/register');
  }
  const sql = 'INSERT INTO users (username, email, password, address, contact, role) VALUES (?, ?, SHA1(?), ?, ?, ?)';
  db.query(sql, [username, email, password, address, contact, role], (err) => {
    if (err) {
      console.error('Error registering user:', err);
      return res.status(500).send('Registration failed');
    }
    req.flash('success', 'Registration successful! Please log in.');
    res.redirect('/login');
  });
});
app.get('/login', (req, res) => {
  res.render('login', { messages: req.flash('success'), errors: req.flash('error') });
});
app.post('/login', (req, res) => {
  const { email, password } = req.body;
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
      req.session.user = results[0];
      req.flash('success', 'Login successful!');
      if (req.session.user.role === 'user') res.redirect('/shopping');
      else res.redirect('/inventory');
    } else {
      req.flash('error', 'Invalid email or password.');
      res.redirect('/login');
    }
  });
});
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// Products / shopping
app.get('/inventory', checkAuthenticated, checkAdmin, ProductController.listInventory);
app.get('/shopping', checkAuthenticated, ProductController.listShopping);
app.get('/product/:id', checkAuthenticated, ProductController.showProduct);
app.get('/addProduct', checkAuthenticated, checkAdmin, ProductController.showAddForm);
app.post('/addProduct', checkAuthenticated, checkAdmin, upload.single('image'), ProductController.addProduct);
app.get('/updateProduct/:id', checkAuthenticated, checkAdmin, ProductController.showUpdateForm);
app.post('/updateProduct/:id', checkAuthenticated, checkAdmin, upload.single('image'), ProductController.updateProduct);
app.get('/deleteProduct/:id', checkAuthenticated, checkAdmin, ProductController.deleteProduct);

// Cart (inject payment methods before rendering cart)
app.post('/add-to-cart/:id', checkAuthenticated, CartController.addToCart);
app.post('/add-to-cart', checkAuthenticated, CartController.addToCart);
app.get('/cart',
  checkAuthenticated,
  (req, res, next) => {
    PaymentMethod.listByUser(req.session.user.id, (err, methods) => {
      if (err) console.error('Error loading payment methods:', err);
      req.paymentMethods = methods || [];
      next();
    });
  },
  (req, res) => {
    CartController.viewCart(req, res);
  }
);
app.post('/cart/remove/:id', checkAuthenticated, CartController.removeFromCart);

// Orders
app.post('/purchase', checkAuthenticated, OrderController.purchase);
app.get('/purchase-history', checkAuthenticated, OrderController.purchaseHistory);

// Payment methods
app.get('/payment-methods', checkAuthenticated, PaymentMethodController.list);
app.post('/payment-methods', checkAuthenticated, PaymentMethodController.add);
app.post('/payment-methods/:id/update', checkAuthenticated, PaymentMethodController.update);
app.post('/payment-methods/:id/delete', checkAuthenticated, PaymentMethodController.remove);
app.get('/wallet', checkAuthenticated, WalletController.showWallet);
app.post('/wallet/topup', checkAuthenticated, WalletController.topUp);
app.post('/wallet/refund', checkAuthenticated, checkAdmin, WalletController.refundToWallet);
app.get('/receipt/:receiptId', checkAuthenticated, ReceiptController.viewReceipt);
app.get('/receipt/:receiptId/pdf', checkAuthenticated, ReceiptController.downloadPdf);

// Admin
app.get('/admin/history', checkAuthenticated, checkAdmin, OrderController.adminViewHistory);
app.get('/admin/view-signup', checkAuthenticated, checkAdmin, AdminController.viewRecentUsers);
app.post('/admin/verify/:id', checkAuthenticated, checkAdmin, AdminController.verifyAdmin);

// Help
app.get('/help', (req, res) => {
  res.render('help', { user: req.session.user });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
