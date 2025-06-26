const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middleware/auth");
const { db } = require("../config/database");
const { sendNotification, sendTopicNotification, getUserTokens } = require("../controllers/notificationController");
const { getRoomStatistics, getMonthlyStatistics } = require("../controllers/statisticsController");
const { markPayment, createTestPayment, getUnpaidPreviousMonths } = require("../controllers/paymentController");
const { calculateMonthlyUsageByType } = require("../services/statisticsService");
const { updateGateway, getGateway, deleteGateway } = require("../controllers/gatewayController");

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

// Gateway routes
router.post("/update-gateway", requireAuth, updateGateway);
router.get("/gateway", requireAuth, getGateway);
router.post("/delete-gateway", requireAuth, deleteGateway);

router.post('/create-sample-admin', async (req, res) => {
  try {
    const sample = {
      username: 'admin',
      password: 'admin123',
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

module.exports = router;