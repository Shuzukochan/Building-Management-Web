const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middleware/auth");
const { db } = require("../config/database");
const { sendNotification, sendRoomTopicNotification, sendTopicNotification, getUserTokens } = require("../controllers/notificationController");
const { getRoomStatistics, getMonthlyStatistics } = require("../controllers/statisticsController");
const { markPayment, createTestPayment, getUnpaidPreviousMonths } = require("../controllers/paymentController");
const { calculateMonthlyUsageByType } = require("../services/statisticsService");

// API Feedback routes (matching index.js logic)
router.get("/feedback", async (req, res) => {
  try {
    const feedbackRef = db.ref('service_feedbacks');
    const snapshot = await feedbackRef.once('value');
    const feedbackData = snapshot.val() || {};
    
    // Chuyển đổi thành array và sắp xếp theo timestamp (mới nhất trước)
    const feedbackArray = Object.entries(feedbackData).map(([timestampKey, data]) => ({
      id: timestampKey,
      timestamp: timestampKey, // Use Firebase key as display timestamp (YYYY-MM-DD-HH-MM-SS)
      content: data.feedback || data.content || '',
      phone: data.phone || null,
      roomNumber: data.roomNumber || null, // Keep for compatibility
      // Determine if anonymous based on phone field
      isAnonymous: !data.phone || data.phone === 'anonymous'
    })).sort((a, b) => {
      // Sort by timestamp key (newest first)
      return b.timestamp.localeCompare(a.timestamp);
    });
    
    // Chỉ lấy 20 feedback gần nhất
    const recentFeedback = feedbackArray.slice(0, 20);
    
    res.json({
      success: true,
      data: recentFeedback
    });
  } catch (error) {
    console.error('Error loading feedback:', error);
    res.status(500).json({
      success: false,
      error: 'Lỗi khi tải góp ý'
    });
  }
});

router.post("/feedback", async (req, res) => {
  try {
    const { content, phone, roomNumber } = req.body;
    
    if (!content || content.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'Nội dung góp ý không được để trống'
      });
    }
    
    const now = new Date();
    const timestamp = now.getFullYear() + '-' +
      (now.getMonth() + 1).toString().padStart(2, '0') + '-' +
      now.getDate().toString().padStart(2, '0') + '-' +
      now.getHours().toString().padStart(2, '0') + '-' +
      now.getMinutes().toString().padStart(2, '0') + '-' +
      now.getSeconds().toString().padStart(2, '0');
    
    const feedbackData = {
      feedback: content.trim(),
      phone: phone && phone.trim() ? phone.trim() : 'anonymous',
      roomNumber: roomNumber && roomNumber.trim() ? roomNumber.trim() : 'anonymous'
    };
    
    await db.ref(`service_feedbacks/${timestamp}`).set(feedbackData);
    
    res.json({
      success: true,
      message: 'Gửi góp ý thành công'
    });
  } catch (error) {
    console.error('Error adding feedback:', error);
    res.status(500).json({
      success: false,
      error: 'Lỗi khi gửi góp ý'
    });
  }
});

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
router.post("/send-notification", requireAuth, sendRoomTopicNotification);
router.post("/send-topic-notification", requireAuth, sendTopicNotification);
router.get("/user-tokens", requireAuth, getUserTokens);

module.exports = router;