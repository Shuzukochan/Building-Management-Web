const { db } = require('../config/database');
const bcrypt = require('bcrypt');

// Số rounds để hash password (10 là đủ an toàn và nhanh)
const SALT_ROUNDS = 10;

// Lấy admin theo username (dùng key)
async function getAdminByUsername(username) {
  const snapshot = await db.ref('admins').child(username).once('value');
  return snapshot.exists() ? snapshot.val() : null;
}

// Hash mật khẩu
async function hashPassword(password) {
  try {
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    return hashedPassword;
  } catch (error) {
    console.error('Error hashing password:', error);
    throw new Error('Lỗi mã hóa mật khẩu');
  }
}

// So sánh mật khẩu với hash
async function comparePassword(password, hashedPassword) {
  try {
    const isMatch = await bcrypt.compare(password, hashedPassword);
    return isMatch;
  } catch (error) {
    console.error('Error comparing password:', error);
    return false;
  }
}

// Hàm xác thực tài khoản admin
async function verifyAdmin(username, password) {
  try {
    const admin = await getAdminByUsername(username);
    if (!admin) return null;
    
    // Kiểm tra xem password đã được hash chưa (để tương thích với dữ liệu cũ)
    if (admin.password && admin.password.startsWith('$2b$')) {
      // Password đã được hash - so sánh với bcrypt
      const isMatch = await comparePassword(password, admin.password);
      return isMatch ? admin : null;
    } else {
      // Password chưa hash (dữ liệu cũ) - so sánh trực tiếp và hash lại
      if (admin.password === password) {
        // Tự động hash password cũ để upgrade security
        const hashedPassword = await hashPassword(password);
        await db.ref(`admins/${username}/password`).set(hashedPassword);
        console.log(`🔐 Auto-upgraded password security for admin: ${username}`);
        return admin;
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error verifying admin:', error);
    return null;
  }
}

module.exports = { 
  getAdminByUsername, 
  verifyAdmin, 
  hashPassword, 
  comparePassword 
}; 