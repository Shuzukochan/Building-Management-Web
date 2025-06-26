const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middleware/auth");
const { getDashboard } = require("../controllers/dashboardController");
const authController = require("../controllers/authController");

router.get("/", authController.renderLogin);
router.post("/login", authController.login);

router.post('/select-building', (req, res) => {
  req.session.selectedBuildingId = req.body.buildingId;
  res.json({ success: true });
});

router.get("/dashboard", requireAuth, getDashboard);

module.exports = router;
