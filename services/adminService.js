const { db } = require('../config/database');

// Lấy admin theo username (dùng key)
async function getAdminByUsername(username) {
  const snapshot = await db.ref('admins').child(username).once('value');
  return snapshot.exists() ? snapshot.val() : null;
}

// Hàm xác thực tài khoản admin
async function verifyAdmin(username, password) {
  const admin = await getAdminByUsername(username);
  if (!admin) return null;
  // TODO: Đổi sang so sánh hash nếu cần
  if (admin.password === password) {
    return admin;
  }
  return null;
}

module.exports = { getAdminByUsername, verifyAdmin }; 