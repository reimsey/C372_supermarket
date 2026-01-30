const Admin = require('../models/Admin');
const User = require('../models/User');

module.exports = {
  pendingAdmins(req, res) {
    Admin.listPending((err, admins) => {
      if (err) return res.send('Error loading users');
      // reuse viewUsers with user list
      User.listRecent(50, (userErr, users) => {
        if (userErr) console.error('Error loading users:', userErr);
        const roleFilter = String(req.query.role || 'all').toLowerCase();
        const search = String(req.query.q || '').trim().toLowerCase();
        let filtered = roleFilter === 'all'
          ? (users || [])
          : (users || []).filter(item => String(item.role || '').toLowerCase() === roleFilter);
        if (search) {
          filtered = filtered.filter(item => {
            const haystack = `${item.username || ''} ${item.email || ''}`.toLowerCase();
            return haystack.includes(search);
          });
        }
        res.render('viewUsers', {
          users: filtered,
          user: req.session.user,
          roleFilter,
          search,
          messages: req.flash('success'),
          errors: req.flash('error')
        });
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
      const roleFilter = String(req.query.role || 'all').toLowerCase();
      const search = String(req.query.q || '').trim().toLowerCase();
      let filtered = roleFilter === 'all'
        ? (users || [])
        : (users || []).filter(item => String(item.role || '').toLowerCase() === roleFilter);
      if (search) {
        filtered = filtered.filter(item => {
          const haystack = `${item.username || ''} ${item.email || ''}`.toLowerCase();
          return haystack.includes(search);
        });
      }
      res.render('viewUsers', {
        users: filtered,
        user: req.session.user,
        roleFilter,
        search,
        messages: req.flash('success'),
        errors: req.flash('error')
      });
    });
  },

  deleteUser(req, res) {
    const targetId = Number(req.params.id);
    if (!targetId) {
      req.flash('error', 'Invalid user.');
      return res.redirect('/admin/view-signup');
    }
    if (req.session.user && Number(req.session.user.id) === targetId) {
      req.flash('error', 'You cannot delete your own account.');
      return res.redirect('/admin/view-signup');
    }

    User.findById(targetId, (findErr, target) => {
      if (findErr) {
        console.error('Error loading user:', findErr);
        req.flash('error', 'Unable to load user.');
        return res.redirect('/admin/view-signup');
      }
      if (!target) {
        req.flash('error', 'User not found.');
        return res.redirect('/admin/view-signup');
      }
      if (target.role === 'admin') {
        req.flash('error', 'Admin accounts cannot be deleted here.');
        return res.redirect('/admin/view-signup');
      }

      User.deleteById(targetId, (delErr) => {
        if (delErr) {
          console.error('Error deleting user:', delErr);
          req.flash('error', delErr.message || 'Unable to delete user.');
          return res.redirect('/admin/view-signup');
        }
        req.flash('success', 'User deactivated.');
        res.redirect('/admin/view-signup');
      });
    });
  }
};
