const Admin = require('../models/Admin');
const User = require('../models/User');

module.exports = {
  pendingAdmins(req, res) {
    Admin.listPending((err, admins) => {
      if (err) return res.send('Error loading users');
      // reuse viewUsers with user list
      User.listRecent(50, (userErr, users) => {
        if (userErr) console.error('Error loading users:', userErr);
        res.render('viewUsers', { users: users || [], user: req.session.user });
      });
    });
  },
  verifyAdmin(req, res) {
    Admin.verify(req.params.id, (err) => {
      if (err) console.error('Error verifying admin:', err);
      res.redirect('/admin/view-signup');
    });
  },
  viewRecentUsers(req, res) {
    User.listRecent(50, (err, users) => {
      if (err) return res.send('Error loading users');
      res.render('viewUsers', { users, user: req.session.user });
    });
  }
};
