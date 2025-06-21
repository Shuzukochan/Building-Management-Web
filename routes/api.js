const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middleware/auth");
const { db } = require("../config/database");
const { sendNotification, sendRoomTopicNotification, sendTopicNotification, getUserTokens } = require("../controllers/notificationController");
const { getRoomStatistics, getMonthlyStatistics } = require("../controllers/statisticsController");
const { markPayment, createTestPayment, getUnpaidPreviousMonths } = require("../controllers/paymentController");
const { calculateMonthlyUsageByType } = require("../services/statisticsService");

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
router.post("/send-notification", requireAuth, sendRoomTopicNotification);
router.post("/send-topic-notification", requireAuth, sendTopicNotification);
router.get("/user-tokens", requireAuth, getUserTokens);

module.exports = router;