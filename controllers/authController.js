const adminService = require('../services/adminService');

exports.renderLogin = (req, res) => {
  res.render('login');
};

exports.login = async (req, res) => {
  const { username, password } = req.body;
  try {
    const admin = await adminService.verifyAdmin(username, password);
    if (admin) {
      req.session.loggedIn = true;
      req.session.admin = {
        username: admin.username,
        role: admin.role,
        building_ids: admin.building_ids || 'building_id_1'
      };
      return res.redirect('/dashboard');
    } else {
      return res.render('login', { error: 'Sai tài khoản hoặc mật khẩu' });
    }
  } catch (err) {
    return res.render('login', { error: 'Lỗi hệ thống, thử lại sau.' });
  }
}; 