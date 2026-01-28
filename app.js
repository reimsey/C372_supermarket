const express = require('express');
const db = require('./db');
const session = require('express-session');
const flash = require('connect-flash');
const multer = require('multer');
const app = express();

const Product = require('./models/Product');
const Cart = require('./models/Cart');
const Order = require('./models/Order');
const PaymentMethod = require('./models/PaymentMethod');
const Receipt = require('./models/Receipt');
const paypal = require('./models/Paypal');
const Wallet = require('./models/Wallet');
const nets = require('./services/nets');
const discountService = require('./services/discounts');
const DiscountCode = require('./models/DiscountCode');
const crypto = require('crypto');

const ProductController = require('./controllers/ProductController');
const CartController = require('./controllers/CartController');
const OrderController = require('./controllers/OrderController');
const PaymentMethodController = require('./controllers/PaymentMethodController');
const AdminController = require('./controllers/AdminController');
const WalletController = require('./controllers/WalletController');
const ReceiptController = require('./controllers/ReceiptController');
const DiscountController = require('./controllers/DiscountController');

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
app.use(express.json());
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
app.post('/cart/discounts/apply', checkAuthenticated, async (req, res) => {
  const codeInput = req.body.code;
  const code = DiscountCode.normalizeCode(codeInput);
  if (!code) {
    req.flash('error', 'Please enter a voucher or coupon code.');
    return res.redirect('/cart');
  }

  const currentCodes = req.session.appliedDiscountCodes || [];
  if (currentCodes.includes(code)) {
    req.flash('error', 'This code is already applied.');
    return res.redirect('/cart');
  }

  const nextCodes = currentCodes.concat(code);

  try {
    const cartItems = await new Promise((resolve, reject) => {
      Cart.getItemsByUser(req.session.user.id, (err, items) => (err ? reject(err) : resolve(items || [])));
    });
    if (!cartItems || cartItems.length === 0) {
      req.flash('error', 'Your cart is empty.');
      return res.redirect('/cart');
    }

    const summary = await discountService.evaluateCartDiscounts(req.session.user.id, cartItems, nextCodes);
    if (summary.errors && summary.errors.length > 0) {
      req.flash('error', summary.errors.join(' '));
      return res.redirect('/cart');
    }

    req.session.appliedDiscountCodes = summary.applied.map(item => item.code);
    req.flash('success', 'Discount applied.');
    res.redirect('/cart');
  } catch (err) {
    console.error('Error applying discount:', err);
    req.flash('error', 'Unable to apply discount right now.');
    res.redirect('/cart');
  }
});

app.post('/cart/discounts/remove', checkAuthenticated, (req, res) => {
  const code = DiscountCode.normalizeCode(req.body.code);
  const currentCodes = req.session.appliedDiscountCodes || [];
  req.session.appliedDiscountCodes = currentCodes.filter(item => item !== code);
  req.flash('success', 'Discount removed.');
  res.redirect('/cart');
});

const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const finalizePurchase = (userId, cart, subtotal, discountSummary, paymentLabel, done) => {
  let remaining = cart.length;
  let finished = false;
  const receiptId = crypto.randomUUID();

  const failOnce = (err) => {
    if (finished) return;
    finished = true;
    done(err);
  };

  const succeedOnce = () => {
    if (finished) return;
    finished = true;
    done(null, receiptId);
  };

  const discountTotal = discountSummary?.totalDiscount || 0;
  const finalTotal = discountSummary?.finalTotal || subtotal;
  const appliedCodes = discountSummary?.applied || [];
  const autoApplied = discountSummary?.autoApplied ? [discountSummary.autoApplied] : [];

  const receiptHeader = {
    receipt_id: receiptId,
    userId,
    subtotal,
    discount_amount: discountTotal,
    final_total: finalTotal,
    payment_method: paymentLabel
  };

  Receipt.create(receiptHeader, (receiptErr) => {
    if (receiptErr) return failOnce(receiptErr);
    Receipt.addItems(receiptId, cart, async (itemsErr) => {
      if (itemsErr) return failOnce(itemsErr);
      try {
        await DiscountCode.recordRedemptions(userId, receiptId, appliedCodes.concat(autoApplied));
      } catch (redemptionErr) {
        console.error('Error recording discount redemptions:', redemptionErr);
      }
    });
  });

  cart.forEach(item => {
    const orderData = {
      userId,
      productId: item.productId,
      qty: item.quantity,
      price: item.price,
      paymentMethod: paymentLabel,
      receiptId
    };

    Order.saveLineItem(orderData, (err) => {
      if (err) return failOnce(err);
      Product.decrementQuantity(item.productId, item.quantity, (stockErr) => {
        if (stockErr) return failOnce(stockErr);
        remaining -= 1;
        if (remaining === 0) {
          Cart.clear(userId, (clearErr) => {
            if (clearErr) console.error('Error clearing cart after PayPal:', clearErr);
            succeedOnce();
          });
        }
      });
    });
  });
};

const finalizePaypalPurchase = (userId, cart, subtotal, discountSummary, done) => {
  finalizePurchase(userId, cart, subtotal, discountSummary, 'PayPal', done);
};

const finalizeNetsPurchase = (userId, cart, subtotal, discountSummary, done) => {
  finalizePurchase(userId, cart, subtotal, discountSummary, 'NETS QR', done);
};

const netsProcessed = new Map();
const walletTopupProcessed = new Map();
const walletTopupPending = new Map();

const creditWalletTopup = (userId, amount, label, referenceType, referenceId, done) => {
  Wallet.credit(
    userId,
    amount,
    {
      type: 'topup',
      reference_type: referenceType || 'wallet_topup',
      reference_id: referenceId || null,
      note: `Wallet top-up via ${label}`
    },
    done
  );
};

// PayPal routes
app.post('/paypal/create-order', checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  Cart.getItemsByUser(userId, async (cartErr, cart) => {
    if (cartErr) return res.status(500).json({ message: 'Error loading cart' });
    if (!cart || cart.length === 0) return res.status(400).json({ message: 'Cart is empty' });

    let discountSummary;
    try {
      discountSummary = await discountService.evaluateCartDiscounts(
        userId,
        cart,
        req.session.appliedDiscountCodes || []
      );
    } catch (discountErr) {
      console.error('Discount evaluation failed:', discountErr);
      return res.status(500).json({ message: 'Unable to apply discounts' });
    }
    if (discountSummary.errors && discountSummary.errors.length > 0) {
      return res.status(400).json({ message: discountSummary.errors.join(' ') });
    }

    try {
      const order = await paypal.createOrder(discountSummary.finalTotal);
      res.json(order);
    } catch (err) {
      console.error('PayPal create order failed:', err);
      res.status(500).json({ message: 'Unable to create PayPal order' });
    }
  });
});

app.post('/paypal/capture-order', checkAuthenticated, async (req, res) => {
  const userId = req.session.user.id;
  const { orderID, cartItemIds } = req.body || {};
  if (!orderID) return res.status(400).json({ message: 'Missing PayPal order ID' });

  Cart.getItemsByUser(userId, async (cartErr, cart) => {
    if (cartErr) return res.status(500).json({ message: 'Error loading cart' });
    if (!cart || cart.length === 0) return res.status(400).json({ message: 'Cart is empty' });

    if (Array.isArray(cartItemIds) && cartItemIds.length > 0) {
      const cartIds = new Set(cart.map(item => Number(item.productId)));
      const invalid = cartItemIds.filter(id => !cartIds.has(Number(id)));
      if (invalid.length > 0) {
        return res.status(400).json({ message: 'Cart items no longer available' });
      }
    }

    try {
      const capture = await paypal.captureOrder(orderID);
      if (!capture || capture.status !== 'COMPLETED') {
        return res.status(400).json({ message: 'PayPal payment not completed' });
      }

      let discountSummary;
      try {
        discountSummary = await discountService.evaluateCartDiscounts(
          userId,
          cart,
          req.session.appliedDiscountCodes || []
        );
      } catch (discountErr) {
        console.error('Discount evaluation failed:', discountErr);
        return res.status(500).json({ message: 'Unable to apply discounts' });
      }
      if (discountSummary.errors && discountSummary.errors.length > 0) {
        return res.status(400).json({ message: discountSummary.errors.join(' ') });
      }

      const subtotal = discountSummary.subtotal;

      finalizePaypalPurchase(userId, cart, subtotal, discountSummary, (finalErr, receiptId) => {
        if (finalErr) {
          console.error('PayPal finalize error:', finalErr);
          return res.status(500).json({ message: 'Error finalizing PayPal purchase' });
        }
        req.session.appliedDiscountCodes = [];
        res.json({ receiptId, receiptUrl: `/receipt/${receiptId}` });
      });
    } catch (err) {
      console.error('PayPal capture failed:', err);
      res.status(500).json({ message: 'Unable to capture PayPal order' });
    }
  });
});

// PayPal wallet top-up
app.post('/wallet/paypal/create-order', checkAuthenticated, async (req, res) => {
  const amount = roundMoney(Number(req.body?.amount));
  if (!amount || amount <= 0) return res.status(400).json({ message: 'Invalid amount' });
  req.session.walletTopupAmount = amount;

  try {
    const order = await paypal.createOrder(amount);
    res.json(order);
  } catch (err) {
    console.error('PayPal wallet top-up create failed:', err);
    res.status(500).json({ message: 'Unable to create PayPal order' });
  }
});

app.post('/wallet/paypal/capture-order', checkAuthenticated, async (req, res) => {
  const { orderID } = req.body || {};
  if (!orderID) return res.status(400).json({ message: 'Missing PayPal order ID' });
  const amount = req.session.walletTopupAmount;
  if (!amount) return res.status(400).json({ message: 'Missing top-up amount' });

  try {
    const capture = await paypal.captureOrder(orderID);
    if (!capture || capture.status !== 'COMPLETED') {
      return res.status(400).json({ message: 'PayPal payment not completed' });
    }
    creditWalletTopup(req.session.user.id, amount, 'PayPal', 'wallet_topup_paypal', orderID, (err) => {
      if (err) {
        console.error('Wallet top-up credit error:', err);
        return res.status(500).json({ message: 'Failed to credit wallet' });
      }
      req.session.walletTopupAmount = null;
      res.json({ success: true, redirectUrl: '/wallet?topup=success' });
    });
  } catch (err) {
    console.error('PayPal wallet top-up capture failed:', err);
    res.status(500).json({ message: 'Unable to capture PayPal order' });
  }
});

// NETS QR routes
app.post('/nets/create-order', checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  if (!process.env.API_KEY || !process.env.PROJECT_ID) {
    req.flash('error', 'NETS is not configured. Please contact admin.');
    return res.redirect('/cart');
  }

  Cart.getItemsByUser(userId, async (cartErr, cart) => {
    if (cartErr) return res.status(500).send('Error loading cart');
    if (!cart || cart.length === 0) {
      req.flash('error', 'Your cart is empty.');
      return res.redirect('/cart');
    }

    let discountSummary;
    try {
      discountSummary = await discountService.evaluateCartDiscounts(
        userId,
        cart,
        req.session.appliedDiscountCodes || []
      );
    } catch (discountErr) {
      console.error('Discount evaluation failed:', discountErr);
      req.flash('error', 'Unable to apply discounts');
      return res.redirect('/cart');
    }
    if (discountSummary.errors && discountSummary.errors.length > 0) {
      req.flash('error', discountSummary.errors.join(' '));
      return res.redirect('/cart');
    }

    try {
      const { qrData, fullResponse } = await nets.requestQr(discountSummary.finalTotal.toFixed(2));
      if (qrData.response_code === '00' && Number(qrData.txn_status) === 1 && qrData.qr_code) {
        return res.render('netsQr', {
          user: req.session.user,
          total: discountSummary.finalTotal.toFixed(2),
          title: 'Scan to Pay',
          qrCodeUrl: `data:image/png;base64,${qrData.qr_code}`,
          txnRetrievalRef: qrData.txn_retrieval_ref,
          networkCode: qrData.network_status,
          timer: 300,
          fullNetsResponse: fullResponse,
          cartItems: cart,
          discountSummary
        });
      }

      const errorMsg = qrData.error_message || 'Transaction failed. Please try again.';
      return res.render('netsTxnFailStatus', { user: req.session.user, message: errorMsg });
    } catch (err) {
      console.error('NETS create order failed:', err);
      res.render('netsTxnFailStatus', { user: req.session.user, message: 'Unable to create NETS QR.' });
    }
  });
});

// NETS QR wallet top-up
app.post('/wallet/nets/create-order', checkAuthenticated, async (req, res) => {
  if (!process.env.API_KEY || !process.env.PROJECT_ID) {
    req.flash('error', 'NETS is not configured. Please contact admin.');
    return res.redirect('/wallet');
  }
  const amount = roundMoney(Number(req.body?.amount));
  if (!amount || amount <= 0) {
    req.flash('error', 'Invalid amount for top-up');
    return res.redirect('/wallet');
  }

  try {
    const { qrData, fullResponse } = await nets.requestQr(amount.toFixed(2));
    if (qrData.response_code === '00' && Number(qrData.txn_status) === 1 && qrData.qr_code) {
      walletTopupPending.set(qrData.txn_retrieval_ref, { userId: req.session.user.id, amount });
      return res.render('netsQr', {
        user: req.session.user,
        total: amount.toFixed(2),
        title: 'Scan to Top Up',
        qrCodeUrl: `data:image/png;base64,${qrData.qr_code}`,
        txnRetrievalRef: qrData.txn_retrieval_ref,
        networkCode: qrData.network_status,
        timer: 300,
        fullNetsResponse: fullResponse,
        topupAmount: amount.toFixed(2),
        sseUrl: `/wallet/nets/sse/payment-status/${qrData.txn_retrieval_ref}`,
        successUrl: '/wallet?topup=success',
        failUrl: '/wallet?topup=fail'
      });
    }

    const errorMsg = qrData.error_message || 'Transaction failed. Please try again.';
    return res.render('netsTxnFailStatus', { user: req.session.user, message: errorMsg });
  } catch (err) {
    console.error('NETS wallet top-up create failed:', err);
    res.render('netsTxnFailStatus', { user: req.session.user, message: 'Unable to create NETS QR.' });
  }
});

app.get('/nets-qr/success', checkAuthenticated, (req, res) => {
  res.render('netsTxnSuccessStatus', { user: req.session.user, message: 'Transaction Successful!' });
});

app.get('/nets-qr/fail', checkAuthenticated, (req, res) => {
  res.render('netsTxnFailStatus', { user: req.session.user, message: 'Transaction Failed. Please try again.' });
});

app.get('/nets/sse/payment-status/:txnRetrievalRef', checkAuthenticated, async (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  const txnRetrievalRef = req.params.txnRetrievalRef;
  const userId = req.session.user.id;
  let pollCount = 0;
  const maxPolls = 60; // 5 minutes if polling every 5s
  let frontendTimeoutStatus = 0;
  let processingSuccess = false;

  const interval = setInterval(async () => {
    pollCount += 1;

    try {
      const response = await nets.queryStatus(txnRetrievalRef, frontendTimeoutStatus);
      res.write(`data: ${JSON.stringify(response)}\n\n`);

      const resData = response?.result?.data || {};
      if (resData.response_code === '00' && Number(resData.txn_status) === 1) {
        if (processingSuccess) return;
        processingSuccess = true;
        clearInterval(interval);

        if (netsProcessed.has(txnRetrievalRef)) {
          const receiptId = netsProcessed.get(txnRetrievalRef);
          res.write(`data: ${JSON.stringify({ success: true, receiptUrl: `/receipt/${receiptId}` })}\n\n`);
          return res.end();
        }

        return Cart.getItemsByUser(userId, async (cartErr, cart) => {
          if (cartErr || !cart || cart.length === 0) {
            res.write(`data: ${JSON.stringify({ fail: true, error: 'Cart not available' })}\n\n`);
            return res.end();
          }
          let discountSummary;
          try {
            discountSummary = await discountService.evaluateCartDiscounts(
              userId,
              cart,
              req.session.appliedDiscountCodes || []
            );
          } catch (discountErr) {
            console.error('Discount evaluation failed:', discountErr);
            res.write(`data: ${JSON.stringify({ fail: true, error: 'Unable to apply discounts' })}\n\n`);
            return res.end();
          }
          if (discountSummary.errors && discountSummary.errors.length > 0) {
            res.write(`data: ${JSON.stringify({ fail: true, error: discountSummary.errors.join(' ') })}\n\n`);
            return res.end();
          }

          const subtotal = discountSummary.subtotal;

          finalizeNetsPurchase(userId, cart, subtotal, discountSummary, (finalErr, receiptId) => {
            if (finalErr) {
              console.error('NETS finalize error:', finalErr);
              res.write(`data: ${JSON.stringify({ fail: true, error: 'Error finalizing NETS purchase' })}\n\n`);
              return res.end();
            }
            netsProcessed.set(txnRetrievalRef, receiptId);
            req.session.appliedDiscountCodes = [];
            res.write(`data: ${JSON.stringify({ success: true, receiptUrl: `/receipt/${receiptId}` })}\n\n`);
            return res.end();
          });
        });
      }

      if (frontendTimeoutStatus === 1 && resData && (resData.response_code !== '00' || Number(resData.txn_status) === 2)) {
        res.write(`data: ${JSON.stringify({ fail: true, ...resData })}\n\n`);
        clearInterval(interval);
        return res.end();
      }
    } catch (err) {
      clearInterval(interval);
      res.write(`data: ${JSON.stringify({ fail: true, error: err.message })}\n\n`);
      return res.end();
    }

    if (pollCount >= maxPolls) {
      clearInterval(interval);
      frontendTimeoutStatus = 1;
      res.write(`data: ${JSON.stringify({ fail: true, error: 'Timeout' })}\n\n`);
      res.end();
    }
  }, 5000);

  req.on('close', () => {
    clearInterval(interval);
  });
});

app.get('/wallet/nets/sse/payment-status/:txnRetrievalRef', checkAuthenticated, async (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  const txnRetrievalRef = req.params.txnRetrievalRef;
  const pending = walletTopupPending.get(txnRetrievalRef);
  let pollCount = 0;
  const maxPolls = 60;
  let frontendTimeoutStatus = 0;
  let processingSuccess = false;

  if (!pending || pending.userId !== req.session.user.id) {
    res.write(`data: ${JSON.stringify({ fail: true, redirectUrl: '/wallet?topup=fail' })}\n\n`);
    return res.end();
  }

  const interval = setInterval(async () => {
    pollCount += 1;
    try {
      const response = await nets.queryStatus(txnRetrievalRef, frontendTimeoutStatus);
      res.write(`data: ${JSON.stringify(response)}\n\n`);

      const resData = response?.result?.data || {};
      if (resData.response_code === '00' && Number(resData.txn_status) === 1) {
        if (processingSuccess) return;
        processingSuccess = true;
        clearInterval(interval);

        if (walletTopupProcessed.has(txnRetrievalRef)) {
          res.write(`data: ${JSON.stringify({ success: true, redirectUrl: '/wallet?topup=success' })}\n\n`);
          return res.end();
        }

        return creditWalletTopup(pending.userId, pending.amount, 'NETS QR', 'wallet_topup_nets', txnRetrievalRef, (err) => {
          if (err) {
            console.error('NETS wallet top-up credit error:', err);
            res.write(`data: ${JSON.stringify({ fail: true, redirectUrl: '/wallet?topup=fail' })}\n\n`);
            return res.end();
          }
          walletTopupProcessed.set(txnRetrievalRef, true);
          walletTopupPending.delete(txnRetrievalRef);
          res.write(`data: ${JSON.stringify({ success: true, redirectUrl: '/wallet?topup=success' })}\n\n`);
          return res.end();
        });
      }

      if (frontendTimeoutStatus === 1 && resData && (resData.response_code !== '00' || Number(resData.txn_status) === 2)) {
        res.write(`data: ${JSON.stringify({ fail: true, redirectUrl: '/wallet?topup=fail' })}\n\n`);
        clearInterval(interval);
        return res.end();
      }
    } catch (err) {
      clearInterval(interval);
      res.write(`data: ${JSON.stringify({ fail: true, redirectUrl: '/wallet?topup=fail' })}\n\n`);
      return res.end();
    }

    if (pollCount >= maxPolls) {
      clearInterval(interval);
      frontendTimeoutStatus = 1;
      res.write(`data: ${JSON.stringify({ fail: true, redirectUrl: '/wallet?topup=fail' })}\n\n`);
      res.end();
    }
  }, 5000);

  req.on('close', () => {
    clearInterval(interval);
  });
});

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
app.get('/admin/discounts', checkAuthenticated, checkAdmin, DiscountController.list);
app.get('/admin/discounts/new', checkAuthenticated, checkAdmin, DiscountController.showNew);
app.post('/admin/discounts', checkAuthenticated, checkAdmin, DiscountController.create);
app.get('/admin/discounts/:id/edit', checkAuthenticated, checkAdmin, DiscountController.showEdit);
app.post('/admin/discounts/:id', checkAuthenticated, checkAdmin, DiscountController.update);
app.post('/admin/discounts/:id/toggle', checkAuthenticated, checkAdmin, DiscountController.toggle);
app.post('/admin/discounts/:id/delete', checkAuthenticated, checkAdmin, DiscountController.remove);

// Help
app.get('/help', (req, res) => {
  res.render('help', { user: req.session.user });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
