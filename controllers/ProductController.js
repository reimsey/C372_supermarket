const Product = require('../models/Product');

module.exports = {
  listInventory(req, res) {
    Product.getAll((err, products) => {
      if (err) return res.status(500).send('Failed to fetch products');
      Product.getCategories((catErr, categories) => {
        const categoryOptions = (!catErr && categories) ? categories : [];
        res.render('inventory', { products, user: req.session.user, categories: categoryOptions });
      });
    });
  },
  listShopping(req, res) {
    Product.getAll((err, products) => {
      if (err) return res.status(500).send('Failed to load products');
      Product.getCategories((catErr, categories) => {
        const categoryOptions = (!catErr && categories) ? categories : [];
        res.render('shopping', { user: req.session.user, products: products || [], categories: categoryOptions });
      });
    });
  },
  showProduct(req, res) {
    Product.getById(req.params.id, (err, product) => {
      if (err) return res.status(500).send('Failed to fetch product');
      if (!product) return res.status(404).send('Product not found');
      res.render('product', { product, user: req.session.user });
    });
  },
  showAddForm(req, res) {
    Product.getCategories((err, categories) => {
      const categoryOptions = (!err && categories) ? categories : [];
      res.render('addProduct', { user: req.session.user, categories: categoryOptions });
    });
  },
  addProduct(req, res) {
    const data = {
      name: req.body.name,
      quantity: req.body.quantity,
      price: req.body.price,
      image: req.file ? req.file.filename : null,
      category: req.body.category || 'Others'
    };
    Product.add(data, (err) => {
      if (err) return res.status(500).send('Failed to add product');
      res.redirect('/inventory');
    });
  },
  showUpdateForm(req, res) {
    Product.getById(req.params.id, (err, product) => {
      if (err) return res.status(500).send('Failed to fetch product');
      if (!product) return res.status(404).send('Product not found');
      Product.getCategories((catErr, categories) => {
        const categoryOptions = (!catErr && categories) ? categories : [];
        res.render('updateProduct', { product, user: req.session.user, categories: categoryOptions });
      });
    });
  },
  updateProduct(req, res) {
    const data = {
      name: req.body.name,
      quantity: req.body.quantity,
      price: req.body.price,
      image: req.file ? req.file.filename : req.body.currentImage,
      category: req.body.category || 'Others'
    };
    Product.update(req.params.id, data, (err) => {
      if (err) return res.status(500).send('Failed to update product');
      res.redirect('/inventory');
    });
  },
  deleteProduct(req, res) {
    Product.remove(req.params.id, (err) => {
      if (err) return res.status(500).send('Failed to delete product');
      res.redirect('/inventory');
    });
  }
};
