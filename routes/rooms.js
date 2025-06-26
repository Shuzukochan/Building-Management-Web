const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middleware/auth");
const { getAvailableRooms, getRoomById, addRoom, assignTenant, updateRoom, deleteRoom, getPhoneNumbers, getRoomTenants, deleteTenant, editTenant, getRoomData } = require("../controllers/roomController");

// Room API routes
router.get("/available-rooms", requireAuth, getAvailableRooms);
router.get("/room/:roomId", requireAuth, getRoomById);
router.get("/room/:roomId/tenants", requireAuth, getRoomTenants);
router.get("/phone-numbers", requireAuth, getPhoneNumbers);

// Room management routes
router.post("/add-room", requireAuth, addRoom);
router.post("/update-room", requireAuth, updateRoom);
router.post("/delete-room", requireAuth, deleteRoom);

// Tenant management
router.post("/assign-tenant", requireAuth, assignTenant);
router.post("/room/:roomId/delete-tenant", requireAuth, deleteTenant);
router.post("/room/:roomId/edit-tenant", requireAuth, editTenant);
router.get("/room/:roomId/data", requireAuth, getRoomData);

module.exports = router;