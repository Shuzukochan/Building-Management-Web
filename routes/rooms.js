const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middleware/auth");
const { getAvailableRooms, getRoomById, addRoom, assignTenant, updateRoom, deleteRoom, getPhoneNumbers } = require("../controllers/roomController");

// Room API routes
router.get("/available-rooms", requireAuth, getAvailableRooms);
router.get("/room/:roomId", requireAuth, getRoomById);
router.get("/phone-numbers", requireAuth, getPhoneNumbers);

// Room management routes
router.post("/add-room", requireAuth, addRoom);
router.post("/update-room", requireAuth, updateRoom);
router.post("/delete-room", requireAuth, deleteRoom);

// Tenant management
router.post("/assign-tenant", requireAuth, assignTenant);

module.exports = router;