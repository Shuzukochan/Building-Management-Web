const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middleware/auth");
const { db } = require("../config/database");
const { sendNotification, sendTopicNotification, getUserTokens } = require("../controllers/notificationController");
const { getRoomStatistics, getMonthlyStatistics } = require("../controllers/statisticsController");
const { markPayment, createTestPayment, getUnpaidPreviousMonths } = require("../controllers/paymentController");
const { calculateMonthlyUsageByType } = require("../services/statisticsService");
const { updateGateway, getGateway, deleteGateway } = require("../controllers/gatewayController");
const { verifyAdmin, hashPassword } = require("../services/adminService");
const { setNodePeriod, setWaterInitialCalibration } = require("../controllers/settingsController");

// Feedback API removed - dashboard is read-only

// Firebase config (matching index.js)
router.get("/firebase-config", (req, res) => {
  try {
    const config = {
    databaseURL: process.env.DATABASE_URL,
      apiKey: process.env.FIREBASE_API_KEY || 'demo-api-key',
      appId: process.env.FIREBASE_APP_ID || 'demo-app-id',
      projectId: 'building-management-firebase', // Add project ID
      messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || 'demo-sender-id'
    };
    
    res.json(config); // Return config directly, not wrapped in success object
  } catch (error) {
    console.error('Error getting Firebase config:', error);
    res.status(500).json({
      success: false,
      error: 'Lỗi khi lấy cấu hình Firebase'
    });
  }
});

// Payment routes
router.post("/mark-payment", requireAuth, markPayment);
router.post("/create-test-payment", requireAuth, createTestPayment);
router.get("/unpaid-previous-months", requireAuth, getUnpaidPreviousMonths);

// Statistics routes
router.get("/monthly-statistics", requireAuth, getMonthlyStatistics);
router.get("/room-statistics/:roomId", requireAuth, getRoomStatistics);

// Notification routes
router.post("/send-notification", requireAuth, sendNotification);
router.post("/send-topic-notification", requireAuth, sendTopicNotification);
router.get("/user-tokens", requireAuth, getUserTokens);

// Node period routes
router.post("/set-node-period", requireAuth, setNodePeriod);
router.post("/set-water-initial-calibration", requireAuth, setWaterInitialCalibration);

// Gateway routes
router.post("/update-gateway", requireAuth, updateGateway);
router.get("/gateway", requireAuth, getGateway);
router.post("/delete-gateway", requireAuth, deleteGateway);

// Change password route
router.post("/change-password", requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const username = req.session.admin.username;

    // Validation
    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Thiếu mật khẩu hiện tại hoặc mật khẩu mới!'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Mật khẩu mới phải có ít nhất 6 ký tự!'
      });
    }

    // Verify current password
    const admin = await verifyAdmin(username, currentPassword);
    if (!admin) {
      return res.status(401).json({
        success: false,
        message: 'Mật khẩu hiện tại không đúng!'
      });
    }

    // Hash password mới trước khi lưu
    const hashedNewPassword = await hashPassword(newPassword);

    // Update password in Firebase
    await db.ref(`admins/${username}/password`).set(hashedNewPassword);

    console.log(`🔐 Password changed for admin: ${username}`);

    res.json({
      success: true,
      message: 'Đổi mật khẩu thành công!'
    });

  } catch (error) {
    console.error('Error changing password:', error);
    res.status(500).json({
      success: false,
      message: 'Lỗi server khi đổi mật khẩu: ' + error.message
    });
  }
});

// Building management routes
router.get('/buildings', requireAuth, async (req, res) => {
  try {
    // Kiểm tra quyền super_admin
    if (!req.session.admin || req.session.admin.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Chỉ Super Admin mới có quyền quản lý tòa nhà!'
      });
    }

    // Lấy danh sách tòa nhà từ Firebase
    const buildingsSnapshot = await db.ref('buildings').once('value');
    const buildingsData = buildingsSnapshot.val() || {};

    // Lấy thống kê admin cho từng tòa nhà
    const adminsSnapshot = await db.ref('admins').once('value');
    const adminsData = adminsSnapshot.val() || {};

    const buildings = [];
    
    for (const [buildingId, buildingData] of Object.entries(buildingsData)) {
      // Đếm số phòng
      const roomCount = buildingData.rooms ? Object.keys(buildingData.rooms).length : 0;
      
      // Đếm số admin được phân công cho tòa nhà này
      const adminCount = Object.values(adminsData).filter(admin => {
        if (Array.isArray(admin.building_ids)) {
          return admin.building_ids.includes(buildingId);
        } else {
          return admin.building_ids === buildingId;
        }
      }).length;

      buildings.push({
        id: buildingId,
        name: buildingData.name || buildingId,
        roomCount: roomCount,
        adminCount: adminCount
      });
    }

    // Sắp xếp theo ID từ bé tới lớn
    buildings.sort((a, b) => {
      // Extract số từ building_id (ví dụ: building_id_1 -> 1)
      const idA = parseInt(a.id.replace('building_id_', '')) || 0;
      const idB = parseInt(b.id.replace('building_id_', '')) || 0;
      return idA - idB;
    });

    res.json({
      success: true,
      buildings: buildings
    });

  } catch (error) {
    console.error('Error getting buildings:', error);
    res.status(500).json({
      success: false,
      message: 'Lỗi server khi lấy danh sách tòa nhà: ' + error.message
    });
  }
});

router.post('/buildings', requireAuth, async (req, res) => {
  try {
    // Kiểm tra quyền super_admin
    if (!req.session.admin || req.session.admin.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Chỉ Super Admin mới có quyền tạo tòa nhà!'
      });
    }

    const { buildingName } = req.body;

    // Validation
    if (!buildingName || !buildingName.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Tên tòa nhà không được để trống!'
      });
    }

    // Auto-generate building_id theo thứ tự
    const buildingsSnapshot = await db.ref('buildings').once('value');
    const existingBuildings = buildingsSnapshot.val() || {};
    
    // Tìm số thứ tự tiếp theo
    let nextNumber = 1;
    const existingNumbers = Object.keys(existingBuildings)
      .filter(id => id.startsWith('building_id_'))
      .map(id => {
        const match = id.match(/building_id_(\d+)$/);
        return match ? parseInt(match[1]) : 0;
      })
      .filter(num => num > 0);
    
    if (existingNumbers.length > 0) {
      nextNumber = Math.max(...existingNumbers) + 1;
    }
    
    const buildingId = `building_id_${nextNumber}`;

    // Kiểm tra tên tòa nhà đã tồn tại chưa
    const duplicateName = Object.values(existingBuildings).find(building => 
      building.name && building.name.toLowerCase().trim() === buildingName.toLowerCase().trim()
    );
    
    if (duplicateName) {
      return res.status(400).json({
        success: false,
        message: 'Tên tòa nhà đã tồn tại!'
      });
    }

    // Tạo tòa nhà mới
    const buildingData = {
      name: buildingName.trim(),
      rooms: {},
      service_feedbacks: {}
    };

    await db.ref(`buildings/${buildingId}`).set(buildingData);

    console.log(`✅ Created new building: ${buildingId} (${buildingName}) by ${req.session.admin.username}`);

    res.json({
      success: true,
      message: `Tạo tòa nhà thành công! Mã tòa nhà: ${buildingId}`,
      data: {
        buildingId: buildingId,
        buildingName: buildingName.trim()
      }
    });

  } catch (error) {
    console.error('Error creating building:', error);
    res.status(500).json({
      success: false,
      message: 'Lỗi server khi tạo tòa nhà: ' + error.message
    });
  }
});

router.put('/buildings/:buildingId', requireAuth, async (req, res) => {
  try {
    // Kiểm tra quyền super_admin
    if (!req.session.admin || req.session.admin.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Chỉ Super Admin mới có quyền sửa tòa nhà!'
      });
    }

    const { buildingId } = req.params;
    const { buildingName } = req.body;

    if (!buildingName || !buildingName.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Tên tòa nhà không được để trống!'
      });
    }

    // Kiểm tra tòa nhà tồn tại
    const buildingSnapshot = await db.ref(`buildings/${buildingId}`).once('value');
    if (!buildingSnapshot.exists()) {
      return res.status(404).json({
        success: false,
        message: 'Tòa nhà không tồn tại!'
      });
    }

    // Cập nhật tên tòa nhà
    await db.ref(`buildings/${buildingId}/name`).set(buildingName.trim());

    console.log(`✅ Updated building name: ${buildingId} -> ${buildingName} by ${req.session.admin.username}`);

    res.json({
      success: true,
      message: 'Cập nhật tên tòa nhà thành công!',
      data: {
        buildingId: buildingId,
        buildingName: buildingName.trim()
      }
    });

  } catch (error) {
    console.error('Error updating building:', error);
    res.status(500).json({
      success: false,
      message: 'Lỗi server khi cập nhật tòa nhà: ' + error.message
    });
  }
});

router.delete('/buildings/:buildingId', requireAuth, async (req, res) => {
  try {
    // Kiểm tra quyền super_admin
    if (!req.session.admin || req.session.admin.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Chỉ Super Admin mới có quyền xóa tòa nhà!'
      });
    }

    const { buildingId } = req.params;

    // Kiểm tra tòa nhà tồn tại
    const buildingSnapshot = await db.ref(`buildings/${buildingId}`).once('value');
    if (!buildingSnapshot.exists()) {
      return res.status(404).json({
        success: false,
        message: 'Tòa nhà không tồn tại!'
      });
    }

    const buildingData = buildingSnapshot.val();

    // Kiểm tra có phòng nào không
    const roomCount = buildingData.rooms ? Object.keys(buildingData.rooms).length : 0;
    if (roomCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Không thể xóa tòa nhà có ${roomCount} phòng! Vui lòng xóa hết phòng trước.`
      });
    }

    // Kiểm tra có admin nào được phân công không
    const adminsSnapshot = await db.ref('admins').once('value');
    const adminsData = adminsSnapshot.val() || {};
    
    const assignedAdmins = Object.entries(adminsData).filter(([username, admin]) => {
      if (Array.isArray(admin.building_ids)) {
        return admin.building_ids.includes(buildingId);
      } else {
        return admin.building_ids === buildingId;
      }
    });

    if (assignedAdmins.length > 0) {
      const adminNames = assignedAdmins.map(([username]) => username).join(', ');
      return res.status(400).json({
        success: false,
        message: `Không thể xóa tòa nhà có admin được phân công (${adminNames})! Vui lòng cập nhật phân công admin trước.`
      });
    }

    // Xóa tòa nhà
    await db.ref(`buildings/${buildingId}`).remove();

    console.log(`✅ Deleted building: ${buildingId} by ${req.session.admin.username}`);

    res.json({
      success: true,
      message: 'Xóa tòa nhà thành công!'
    });

  } catch (error) {
    console.error('Error deleting building:', error);
    res.status(500).json({
      success: false,
      message: 'Lỗi server khi xóa tòa nhà: ' + error.message
    });
  }
});

// Admin account management routes
router.post('/create-admin-account', requireAuth, async (req, res) => {
  try {
    // Kiểm tra quyền super_admin
    if (!req.session.admin || req.session.admin.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Chỉ Super Admin mới có quyền tạo tài khoản!'
      });
    }

    const { username, password, role, building_ids } = req.body;

    // Validation
    if (!username || !password || !role) {
      return res.status(400).json({
        success: false,
        message: 'Thiếu thông tin cần thiết!'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Mật khẩu phải có ít nhất 6 ký tự!'
      });
    }

    if (!['admin', 'super_admin'].includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'Vai trò không hợp lệ!'
      });
    }

    // Validate username format
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return res.status(400).json({
        success: false,
        message: 'Tên đăng nhập chỉ được chứa chữ cái, số và dấu gạch dưới!'
      });
    }

    // Kiểm tra username đã tồn tại chưa
    const existingAdmin = await db.ref(`admins/${username}`).once('value');
    if (existingAdmin.exists()) {
      return res.status(400).json({
        success: false,
        message: 'Tên đăng nhập đã tồn tại!'
      });
    }

    // Hash password trước khi lưu
    const hashedPassword = await hashPassword(password);

    // Tạo dữ liệu admin
    const adminData = {
      username: username,
      password: hashedPassword, // Mật khẩu đã được mã hóa
      role: role
    };

    // Xử lý building_ids
    if (role === 'admin') {
      if (!building_ids || !building_ids.length) {
        return res.status(400).json({
          success: false,
          message: 'Admin thường phải được phân công tòa nhà!'
        });
      }
      // Lưu dưới dạng string để nhất quán với cấu trúc cũ
      adminData.building_ids = Array.isArray(building_ids) ? building_ids[0] : building_ids;
    } else if (role === 'super_admin') {
      // Super admin có quyền truy cập tất cả tòa nhà
      const buildingsSnapshot = await db.ref('buildings').once('value');
      const buildingsData = buildingsSnapshot.val() || {};
      adminData.building_ids = Object.keys(buildingsData);
    }

    // Lưu vào Firebase
    await db.ref(`admins/${username}`).set(adminData);

    console.log(`✅ Created new admin account: ${username} (${role}) by ${req.session.admin.username}`);

    res.json({
      success: true,
      message: `Tạo tài khoản ${role} thành công!`,
      data: {
        username: username,
        role: role,
        building_ids: adminData.building_ids
      }
    });

  } catch (error) {
    console.error('Error creating admin account:', error);
    res.status(500).json({
      success: false,
      message: 'Lỗi server khi tạo tài khoản: ' + error.message
    });
  }
});

router.post('/create-sample-admin', async (req, res) => {
  try {
    // Hash password cho sample admin
    const hashedPassword = await hashPassword('admin123');
    
    const sample = {
      username: 'admin',
      password: hashedPassword,
      role: 'super_admin',
      building_ids: ['building_id_1', 'building_id_2']
    };
    // Kiểm tra nếu đã tồn tại thì không tạo lại
    const ref = db.ref('admins').child(sample.username);
    const snapshot = await ref.once('value');
    if (snapshot.exists()) {
      return res.json({ message: 'Admin mẫu đã tồn tại!' });
    }
    await ref.set(sample);
    res.json({ message: 'Tạo admin mẫu thành công!\nTài khoản: admin / admin123' });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi tạo admin mẫu!' });
  }
});

router.post('/migrate-database', async (req, res) => {
  try {
    console.log('🔄 Bắt đầu di chuyển database...');
    
    // 1. Lấy dữ liệu hiện tại
    const [roomsSnapshot, feedbacksSnapshot] = await Promise.all([
      db.ref('rooms').once('value'),
      db.ref('service_feedbacks').once('value')
    ]);
    
    const roomsData = roomsSnapshot.val() || {};
    const feedbacksData = feedbacksSnapshot.val() || {};
    
    console.log(`📊 Tìm thấy ${Object.keys(roomsData).length} phòng và ${Object.keys(feedbacksData).length} feedback`);
    
    // 2. Kiểm tra đã migrate chưa
    const buildingSnapshot = await db.ref('buildings/building_id_1').once('value');
    if (buildingSnapshot.exists()) {
      return res.json({ message: 'Dữ liệu đã được di chuyển rồi!' });
    }
    
    // 3. Tạo cấu trúc building mới
    const buildingData = {
      name: 'Tòa nhà A',
      rooms: roomsData,
      service_feedbacks: feedbacksData,
      migrated_from: 'root_level'
    };
    
    // 4. Lưu vào building_id_1
    await db.ref('buildings/building_id_1').set(buildingData);
    console.log('✅ Đã lưu dữ liệu vào buildings/building_id_1');
    
    // 5. Tạo building_id_2 trống
    await db.ref('buildings/building_id_2').set({
      name: 'Tòa nhà B',
      rooms: {},
      service_feedbacks: {}
    });
    console.log('✅ Đã tạo Tòa nhà B trống');
    
    // 6. Xóa dữ liệu cũ (backup trước khi xóa)
    await Promise.all([
      db.ref('backup_rooms').set(roomsData),
      db.ref('backup_service_feedbacks').set(feedbacksData)
    ]);
    console.log('✅ Đã backup dữ liệu cũ');
    
    await Promise.all([
      db.ref('rooms').remove(),
      db.ref('service_feedbacks').remove()
    ]);
    console.log('✅ Đã xóa dữ liệu cũ');
    
    res.json({ 
      message: `Thành công! Đã di chuyển ${Object.keys(roomsData).length} phòng và ${Object.keys(feedbacksData).length} feedback vào Tòa nhà A.`
    });
    
  } catch (error) {
    console.error('❌ Lỗi migration:', error);
    res.status(500).json({ message: 'Lỗi khi di chuyển dữ liệu: ' + error.message });
  }
});

router.delete('/delete-admin-account', requireAuth, async (req, res) => {
  try {
    // Kiểm tra quyền super_admin
    if (!req.session.admin || req.session.admin.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Chỉ Super Admin mới có quyền xóa tài khoản!'
      });
    }

    const { username } = req.body;

    // Validation
    if (!username) {
      return res.status(400).json({
        success: false,
        message: 'Thiếu tên tài khoản cần xóa!'
      });
    }

    // Không cho phép xóa chính mình
    if (username === req.session.admin.username) {
      return res.status(400).json({
        success: false,
        message: 'Không thể xóa tài khoản đang đăng nhập!'
      });
    }

    // Kiểm tra tài khoản tồn tại
    const adminSnapshot = await db.ref(`admins/${username}`).once('value');
    if (!adminSnapshot.exists()) {
      return res.status(404).json({
        success: false,
        message: 'Tài khoản không tồn tại!'
      });
    }

    // Xóa tài khoản
    await db.ref(`admins/${username}`).remove();

    res.json({
      success: true,
      message: `Đã xóa tài khoản admin '${username}' thành công!`
    });

  } catch (error) {
    console.error('Error deleting admin account:', error);
    res.status(500).json({
      success: false,
      message: 'Lỗi server: ' + error.message
    });
  }
});

// Lấy danh sách tất cả admin (chỉ super_admin)
router.get('/admins', requireAuth, async (req, res) => {
  try {
    // Kiểm tra quyền super_admin
    if (!req.session.admin || req.session.admin.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Chỉ Super Admin mới có quyền xem danh sách admin!'
      });
    }

    // Lấy danh sách admin từ Firebase
    const adminsSnapshot = await db.ref('admins').once('value');
    const adminsData = adminsSnapshot.val() || {};
    
    // Lấy danh sách buildings để hiển thị tên thay vì ID
    const buildingsSnapshot = await db.ref('buildings').once('value');
    const buildingsData = buildingsSnapshot.val() || {};
    
    // Chuyển đổi thành array và bổ sung thông tin
    const admins = Object.entries(adminsData).map(([username, adminInfo]) => {
      let buildingNames = [];
      
      if (adminInfo.role === 'admin' && adminInfo.building_ids) {
        const buildingIds = Array.isArray(adminInfo.building_ids) 
          ? adminInfo.building_ids 
          : [adminInfo.building_ids];
          
        buildingNames = buildingIds.map(id => {
          const building = buildingsData[id];
          return building ? building.name : id;
        });
      } else if (adminInfo.role === 'super_admin') {
        buildingNames = ['Tất cả tòa nhà'];
      }
      
      return {
        username,
        role: adminInfo.role,
        building_ids: adminInfo.building_ids,
        buildingNames: buildingNames.join(', ')
      };
    });

    res.json(admins);

  } catch (error) {
    console.error('Error fetching admins:', error);
    res.status(500).json({
      success: false,
      message: 'Lỗi server: ' + error.message
    });
  }
});

router.put('/admins/:username', requireAuth, async (req, res) => {
  try {
    if (!req.session.admin || req.session.admin.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Chỉ Super Admin mới có quyền sửa tài khoản!' });
    }

    const { username: targetUsername } = req.params;
    const { password, role, building_ids } = req.body;

    if (targetUsername === req.session.admin.username) {
      return res.status(400).json({ success: false, message: 'Không thể tự sửa thông tin tài khoản của mình.' });
    }

    const adminRef = db.ref(`admins/${targetUsername}`);
    const adminSnapshot = await adminRef.once('value');
    if (!adminSnapshot.exists()) {
      return res.status(404).json({ success: false, message: 'Tài khoản không tồn tại!' });
    }

    const updates = {};
    if (password) {
      if (password.length < 6) {
        return res.status(400).json({ success: false, message: 'Mật khẩu phải có ít nhất 6 ký tự!' });
      }
      // Hash password mới trước khi lưu
      const hashedPassword = await hashPassword(password);
      updates.password = hashedPassword;
    }

    if (role) {
      if (!['admin', 'super_admin'].includes(role)) {
        return res.status(400).json({ success: false, message: 'Vai trò không hợp lệ!' });
      }
      updates.role = role;

      if (role === 'admin') {
        if (!building_ids || building_ids.length === 0) {
          return res.status(400).json({ success: false, message: 'Admin thường phải được phân công ít nhất một tòa nhà.' });
        }
        updates.building_ids = Array.isArray(building_ids) ? building_ids[0] : building_ids;
      } else { // super_admin
        const buildingsSnapshot = await db.ref('buildings').once('value');
        updates.building_ids = Object.keys(buildingsSnapshot.val() || {});
      }
    } else if (building_ids) {
      // If only buildings are sent, ensure user is 'admin'
      const currentRole = adminSnapshot.val().role;
      if (currentRole === 'admin') {
        updates.building_ids = Array.isArray(building_ids) ? building_ids[0] : building_ids;
      }
    }
    
    if (Object.keys(updates).length > 0) {
      await adminRef.update(updates);
    }
    
    res.json({ success: true, message: `Cập nhật tài khoản '${targetUsername}' thành công!` });

  } catch (error) {
    console.error('Error updating admin account:', error);
    res.status(500).json({ success: false, message: 'Lỗi server khi cập nhật tài khoản: ' + error.message });
  }
});

// Get device timeout setting from Firebase
router.get('/device-timeout', requireAuth, async (req, res) => {
  try {
    // Get building ID from session
    let buildingId = 'building_id_1'; // default
    
    if (req.session.admin) {
      if (req.session.admin.role === 'admin') {
        buildingId = req.session.admin.building_ids || 'building_id_1';
      } else if (req.session.admin.role === 'super_admin' && req.session.selectedBuildingId) {
        buildingId = req.session.selectedBuildingId;
      }
    }

    // Get timeout setting from Firebase
    const timeoutSnapshot = await db.ref(`buildings/${buildingId}/deviceTimeout`).once('value');
    const deviceTimeout = timeoutSnapshot.val() || 14400; // default 14400 seconds (4 hours)

    res.json({
      success: true,
      deviceTimeout: deviceTimeout,
      buildingId: buildingId
    });

  } catch (error) {
    console.error('Lỗi khi lấy device timeout:', error);
    res.status(500).json({
      success: false,
      error: 'Không thể lấy cấu hình timeout: ' + error.message
    });
  }
});

// Update device timeout setting
router.put('/device-timeout', requireAuth, async (req, res) => {
  try {
    const { deviceTimeout } = req.body;

    // Validation
    if (!deviceTimeout || isNaN(deviceTimeout) || deviceTimeout < 30 || deviceTimeout > 86400) {
      return res.status(400).json({
        success: false,
        error: 'Thời gian timeout phải từ 30 đến 86400 giây (24 tiếng)'
      });
    }

    // Get building ID from session
    let buildingId = 'building_id_1'; // default
    
    if (req.session.admin) {
      if (req.session.admin.role === 'admin') {
        buildingId = req.session.admin.building_ids || 'building_id_1';
      } else if (req.session.admin.role === 'super_admin' && req.session.selectedBuildingId) {
        buildingId = req.session.selectedBuildingId;
      }
    }

    // Update timeout setting in Firebase
    await db.ref(`buildings/${buildingId}/deviceTimeout`).set(parseInt(deviceTimeout));

    console.log(`✅ Cập nhật device timeout cho building ${buildingId}: ${deviceTimeout}s`);

    res.json({
      success: true,
      message: 'Cập nhật thời gian timeout thành công',
      deviceTimeout: parseInt(deviceTimeout),
      buildingId: buildingId
    });

  } catch (error) {
    console.error('Lỗi khi cập nhật device timeout:', error);
    res.status(500).json({
      success: false,
      error: 'Không thể cập nhật timeout: ' + error.message
    });
  }
});

// Device status proxy endpoint (để tránh CORS)
router.get('/device-status', requireAuth, async (req, res) => {
  try {
    const axios = require('axios');
    const DEVICE_STATUS_API = 'https://api.shuzuko.id.vn/api/devices?limit=1000&applicationId=b9949d55-b7e4-49ad-91db-0edd67ade465';
    
    // Lấy API token từ environment variable
    const apiToken = process.env.NODE_QUEUE_API_TOKEN;
    if (!apiToken) {
      return res.status(500).json({ 
        success: false, 
        error: 'Thiếu NODE_QUEUE_API_TOKEN trong .env' 
      });
    }
    
    const response = await axios.get(DEVICE_STATUS_API, {
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiToken}`
      },
      timeout: 10000 // 10 seconds timeout
    });

    const data = response.data;
    
    res.json({
      success: true,
      result: data.result || [],
      totalCount: data.totalCount || 0
    });

  } catch (error) {
    console.error('Lỗi khi gọi API trạng thái thiết bị:', error);
    
    // Xử lý lỗi chi tiết hơn
    let errorMessage = 'Không thể lấy trạng thái thiết bị';
    if (error.code === 'ECONNABORTED') {
      errorMessage = 'Timeout khi gọi API thiết bị';
    } else if (error.response) {
      errorMessage = `API trả về lỗi ${error.response.status}: ${error.response.statusText}`;
      console.error('API response data:', error.response.data);
    } else if (error.request) {
      errorMessage = 'Không thể kết nối tới API thiết bị';
    }
    
    res.status(500).json({
      success: false,
      error: errorMessage
    });
  }
});

// Gateway status proxy endpoint
router.get('/gateway-status', requireAuth, async (req, res) => {
  try {
    const axios = require('axios');
    
    // Get building ID from session to fetch gateway ID
    let buildingId = 'building_id_1'; // default
    
    if (req.session.admin) {
      if (req.session.admin.role === 'admin') {
        buildingId = req.session.admin.building_ids || 'building_id_1';
      } else if (req.session.admin.role === 'super_admin' && req.session.selectedBuildingId) {
        buildingId = req.session.selectedBuildingId;
      }
    }

    console.log(`🔍 Gateway API Debug - Building ID: ${buildingId}`);

    // Get gateway ID from Firebase
    const gatewaySnapshot = await db.ref(`buildings/${buildingId}/gateway_id`).once('value');
    const gatewayId = gatewaySnapshot.val();
    
    console.log(`🔍 Gateway API Debug - Gateway ID from Firebase: ${gatewayId}`);
    
    if (!gatewayId) {
      console.log(`❌ No Gateway ID found for building: ${buildingId}`);
      return res.status(400).json({
        success: false,
        error: `Không có Gateway ID được cấu hình cho building ${buildingId}`
      });
    }

    // Call gateway status API
    const GATEWAY_STATUS_API = `https://api.shuzuko.id.vn/api/gateways/${gatewayId}`;
    
    console.log(`🔍 Gateway API Debug - Calling URL: ${GATEWAY_STATUS_API}`);
    
    // Lấy API token từ environment variable
    const apiToken = process.env.NODE_QUEUE_API_TOKEN;
    if (!apiToken) {
      console.log(`❌ Missing NODE_QUEUE_API_TOKEN in environment`);
      return res.status(500).json({ 
        success: false, 
        error: 'Thiếu NODE_QUEUE_API_TOKEN trong .env' 
      });
    }
    
    console.log(`🔍 Gateway API Debug - API Token exists: ${apiToken ? 'Yes' : 'No'}`);
    
    const response = await axios.get(GATEWAY_STATUS_API, {
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiToken}`
      },
      timeout: 10000 // 10 seconds timeout
    });

    console.log(`🔍 Gateway API Debug - External API Response Status: ${response.status}`);
    
    const data = response.data;
    
    console.log(`🔍 Gateway API Debug - External API Response Data:`, data);
    
    res.json({
      success: true,
      gateway: data || null,
      gatewayId: gatewayId
    });

  } catch (error) {
    console.error('❌ Gateway API Error Full:', error);
    
    // Xử lý lỗi chi tiết hơn
    let errorMessage = 'Không thể lấy trạng thái gateway';
    let statusCode = 500;
    
    if (error.code === 'ECONNABORTED') {
      errorMessage = 'Timeout khi gọi API gateway';
      console.log('🕒 Gateway API Timeout');
    } else if (error.response) {
      statusCode = error.response.status;
      errorMessage = `External API trả về lỗi ${error.response.status}: ${error.response.statusText}`;
      console.error('🔍 Gateway API Response Error Status:', error.response.status);
      console.error('🔍 Gateway API Response Error Data:', error.response.data);
      console.error('🔍 Gateway API Response Error Headers:', error.response.headers);
    } else if (error.request) {
      errorMessage = 'Không thể kết nối tới API gateway';
      console.error('🔍 Gateway API Request Error:', error.request);
    } else {
      console.error('🔍 Gateway API Other Error:', error.message);
    }
    
    res.status(statusCode).json({
      success: false,
      error: errorMessage,
      debug: {
        errorType: error.code || 'unknown',
        statusCode: error.response?.status || null,
        gatewayId: req.gatewayId || 'not set'
      }
    });
  }
});

// Debug endpoint to check current gateway ID
router.get('/debug/gateway-info', requireAuth, async (req, res) => {
  try {
    // Get building ID from session
    let buildingId = 'building_id_1'; // default
    
    if (req.session.admin) {
      if (req.session.admin.role === 'admin') {
        buildingId = req.session.admin.building_ids || 'building_id_1';
      } else if (req.session.admin.role === 'super_admin' && req.session.selectedBuildingId) {
        buildingId = req.session.selectedBuildingId;
      }
    }

    // Get gateway ID from Firebase
    const gatewaySnapshot = await db.ref(`buildings/${buildingId}/gateway_id`).once('value');
    const gatewayId = gatewaySnapshot.val();
    
    res.json({
      success: true,
      buildingId: buildingId,
      gatewayId: gatewayId,
      hasGatewayId: !!gatewayId,
      sessionInfo: {
        adminRole: req.session.admin?.role || 'none',
        buildingIds: req.session.admin?.building_ids || 'none',
        selectedBuildingId: req.session.selectedBuildingId || 'none'
      }
    });

  } catch (error) {
    console.error('Debug gateway info error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;