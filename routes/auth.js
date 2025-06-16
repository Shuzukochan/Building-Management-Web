const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middleware/auth");
const { getDashboard } = require("../controllers/dashboardController");

// Get admin credentials from environment variables
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin'; // Change this in production!

router.get("/", (req, res) => {
  res.render("login");
});

router.post("/login", (req, res) => {
  const { username, password } = req.body;
  
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    req.session.loggedIn = true;
    res.redirect("/dashboard");
  } else {
    res.redirect("/");
  }
});

router.get("/dashboard", requireAuth, getDashboard);

module.exports = router;
