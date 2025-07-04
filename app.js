const express = require("express");
const session = require("express-session");
const bodyParser = require("body-parser");
const path = require("path");
require("dotenv").config();

const app = express();
const PORT = 3000;

// Import Firebase from existing config
const { db, messaging, admin } = require("./config/database");

// Import routes
const authRoutes = require("./routes/auth");
const apiRoutes = require("./routes/api");
const roomRoutes = require("./routes/rooms");

// Import controllers
const { getPayments, markPayment, createTestPayment, getUnpaidPreviousMonths } = require("./controllers/paymentController");
const { addNode, deleteNode, editNode } = require("./controllers/nodeController");
const { getDashboard } = require("./controllers/dashboardController");
const { getStatistic } = require("./controllers/statisticsController");
const { getSettings, updateCalibration, updatePricing, getRoomCalibrationData } = require("./controllers/settingsController");
const { requireAuth } = require("./middleware/auth");

// Helper functions from index.js
function formatPhoneNumber(phone) {
  if (!phone) return '';
  if (phone.startsWith('+84')) {
    return '0' + phone.substring(3);
  }
  if (phone.startsWith('84') && phone.length >= 10) {
    return '0' + phone.substring(2);
  }
  return phone;
}

function getDefaultLastData(nodeType) {
  switch (nodeType) {
    case 'electricity':
      return { electric: 0, batt: 0, current: 0 };
    case 'water':
      return { water: 0, batt: 0 };
    case 'custom':
    default:
      return { value: 0, batt: 0 };
  }
}

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(session({
  secret: process.env.SESSION_SECRET || "temporary-secret-key-change-in-production",
  resave: false,
  saveUninitialized: true
}));

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use("/public", express.static(path.join(__dirname, "public")));

// Use routes
app.use("/", authRoutes);
app.use("/api", apiRoutes);
app.use("/api", roomRoutes);  // Room API routes

// Building selection route
app.post('/select-building', (req, res) => {
  req.session.selectedBuildingId = req.body.buildingId;
  res.json({ success: true });
});

// Page routes
app.get("/dashboard", requireAuth, getDashboard);
app.get("/statistic", requireAuth, getStatistic);
app.get("/payments", requireAuth, getPayments);
app.get("/settings", requireAuth, getSettings);
app.get("/admin", requireAuth, async (req, res) => {
  // Admin management page - chỉ super_admin mới truy cập được
  if (!req.session.admin || req.session.admin.role !== 'super_admin') {
    return res.redirect('/dashboard?error=Chỉ Super Admin mới có quyền truy cập trang quản lý admin!');
  }

  // Load buildings từ Firebase
  let buildings = {};
  try {
    const buildingsSnapshot = await db.ref('buildings').once('value');
    const buildingsData = buildingsSnapshot.val() || {};
    buildings = Object.fromEntries(
      Object.entries(buildingsData).map(([id, data]) => [id, { name: data.name || id }])
    );
  } catch (buildingError) {
    console.error('Error loading buildings in admin page:', buildingError);
    buildings = {
      building_id_1: { name: "Tòa nhà A" },
      building_id_2: { name: "Tòa nhà B" }
    };
  }

  res.render("admin", { 
    currentPage: 'admin',
    admin: req.session.admin,
    buildings,
    selectedBuildingId: req.session.selectedBuildingId
  });
});
app.get("/about", requireAuth, async (req, res) => {
  // About page - ai cũng thấy như nhau, chỉ cần admin data cho sidebar
  // Load buildings từ Firebase
  let buildings = {};
  try {
    const buildingsSnapshot = await db.ref('buildings').once('value');
    const buildingsData = buildingsSnapshot.val() || {};
    buildings = Object.fromEntries(
      Object.entries(buildingsData).map(([id, data]) => [id, { name: data.name || id }])
    );
  } catch (buildingError) {
    console.error('Error loading buildings in about page:', buildingError);
    // Fallback to default buildings
    buildings = {
    building_id_1: { name: "Tòa nhà A" },
    building_id_2: { name: "Tòa nhà B" }
  };
  }
  
  res.render("about", { 
    currentPage: 'about',
    admin: req.session.admin,
    buildings,
    selectedBuildingId: req.session.selectedBuildingId
  });
});

// Public routes (no authentication required)
app.get("/privacy", (req, res) => {
  res.render("privacy");
});

// Payment API routes
app.post("/api/create-test-payment", requireAuth, createTestPayment);
app.get("/api/unpaid-previous-months", requireAuth, getUnpaidPreviousMonths);

// Settings API routes
app.post("/api/update-calibration", requireAuth, updateCalibration);
app.post("/api/update-pricing", requireAuth, updatePricing);
app.get("/api/room-calibration/:roomId", requireAuth, getRoomCalibrationData);

// Node management routes
app.post("/add-node", requireAuth, addNode);
app.post("/delete-node", requireAuth, deleteNode);
app.post("/update-node", requireAuth, editNode);

// Room management routes are handled by roomController via /api routes

// Helper function to calculate monthly usage by type
function calculateMonthlyUsageByType(historyData, month, year, roomId, dataType) {
  try {
    const monthStr = month.toString().padStart(2, '0');
    const yearStr = year.toString();
    
    console.log(`📅 Calculating ${dataType} usage for room ${roomId} for ${monthStr}/${yearStr}`);
    
    // Calculate previous month
    let prevMonth = month - 1;
    let prevYear = year;
    if (prevMonth === 0) {
      prevMonth = 12;
      prevYear = year - 1;
    }
    const prevMonthStr = prevMonth.toString().padStart(2, '0');
    const prevYearStr = prevYear.toString();
    
    // Find latest date (highest date) in current month
    let currentMonthLatestValue = null;
    let currentMonthLatestDate = null;
    const daysInCurrentMonth = new Date(year, month, 0).getDate();
    
    for (let day = daysInCurrentMonth; day >= 1; day--) {
      const dayStr = day.toString().padStart(2, '0');
      const dateStr = `${yearStr}-${monthStr}-${dayStr}`;
      if (historyData[dateStr] && historyData[dateStr][dataType] !== undefined) {
        currentMonthLatestValue = historyData[dateStr][dataType] || 0;
        currentMonthLatestDate = dateStr;
        break; // Found the latest date with data
      }
    }
    
    if (currentMonthLatestValue === null) {
      console.log(`⚠️ No ${dataType} data for room ${roomId} in current month`);
      return 0;
    }
    
    console.log(`📊 Current month latest: ${currentMonthLatestValue} on ${currentMonthLatestDate}`);
    
    // Find latest date (highest date) in previous month
    let prevMonthLatestValue = null;
    let prevMonthLatestDate = null;
    const daysInPrevMonth = new Date(prevYear, prevMonth, 0).getDate();
    
    for (let day = daysInPrevMonth; day >= 1; day--) {
      const dayStr = day.toString().padStart(2, '0');
      const dateStr = `${prevYearStr}-${prevMonthStr}-${dayStr}`;
      if (historyData[dateStr] && historyData[dateStr][dataType] !== undefined) {
        prevMonthLatestValue = historyData[dateStr][dataType] || 0;
        prevMonthLatestDate = dateStr;
        break; // Found the latest date with data
      }
    }
    
    let usage = 0;
    
    if (prevMonthLatestValue !== null) {
      // Case 1: Have previous month data - use latest current month - latest previous month
      usage = Math.max(0, currentMonthLatestValue - prevMonthLatestValue);
      console.log(`🔍 Room ${roomId} ${dataType}: ${currentMonthLatestValue} (${currentMonthLatestDate}) - ${prevMonthLatestValue} (${prevMonthLatestDate}) = ${usage}`);
    } else {
      // Case 2: No previous month data - use latest current month - earliest current month
      let currentMonthEarliestValue = null;
      let currentMonthEarliestDate = null;
      
      for (let day = 1; day <= daysInCurrentMonth; day++) {
        const dayStr = day.toString().padStart(2, '0');
        const dateStr = `${yearStr}-${monthStr}-${dayStr}`;
        if (historyData[dateStr] && historyData[dateStr][dataType] !== undefined) {
          currentMonthEarliestValue = historyData[dateStr][dataType] || 0;
          currentMonthEarliestDate = dateStr;
          break; // Found the earliest date with data
        }
      }
      
      if (currentMonthEarliestValue !== null) {
        usage = Math.max(0, currentMonthLatestValue - currentMonthEarliestValue);
        console.log(`🔍 Room ${roomId} ${dataType}: ${currentMonthLatestValue} (${currentMonthLatestDate}) - ${currentMonthEarliestValue} (${currentMonthEarliestDate}) = ${usage} (fallback to current month earliest)`);
      } else {
        console.log(`⚠️ No valid data for ${dataType} in room ${roomId}`);
        return 0;
      }
    }
    
    console.log(`📈 Room ${roomId} ${dataType} monthly usage: ${usage}`);
    
    return usage;
    
  } catch (error) {
    console.error(`❌ Lỗi khi tính ${dataType} usage cho room ${roomId}:`, error);
    return 0;
  }
}

// Mark payment route - Still using old database structure, will be updated by paymentController
app.post('/mark-payment', requireAuth, async (req, res) => {
  try {
    const { roomId, month, paymentMethod, amount } = req.body;
    
    if (!roomId || !month) {
      return res.redirect('/payments?error=Thiếu thông tin cần thiết');
    }
    
    console.log(`💰 Marking payment for room ${roomId} for month ${month} via ${paymentMethod}`);
     
    // Validation paymentMethod
    if (!paymentMethod || (paymentMethod !== 'cash' && paymentMethod !== 'transfer')) {
      return res.redirect('/payments?error=Phương thức thanh toán không hợp lệ');
    }
     
    // Helper function để xác định building_id từ session
    function getTargetBuildingId(req) {
      let targetBuildingId = 'building_id_1'; // mặc định Tòa nhà A
      
      if (req.session.admin) {
        if (req.session.admin.role === 'admin') {
          // Admin thường: lấy building_ids (là string, không phải array)
          targetBuildingId = req.session.admin.building_ids || 'building_id_1';
        } else if (req.session.admin.role === 'super_admin' && req.session.selectedBuildingId) {
          // Super admin: lấy theo dropdown đã chọn
          targetBuildingId = req.session.selectedBuildingId;
        }
      }
      
      return targetBuildingId;
    }
    
    const targetBuildingId = getTargetBuildingId(req);
     
    // Kiểm tra phòng tồn tại
    const roomSnapshot = await db.ref(`buildings/${targetBuildingId}/rooms/${roomId}`).once('value');
    if (!roomSnapshot.exists()) {
      return res.redirect('/payments?error=Phòng không tồn tại');
    }
    
    // Kiểm tra xem đã thanh toán chưa - kiểm tra cả payments và payment
    const paymentsSnapshot = await db.ref(`buildings/${targetBuildingId}/rooms/${roomId}/payments/${month}`).once('value');
    const paymentSnapshot = await db.ref(`buildings/${targetBuildingId}/rooms/${roomId}/payment/${month}`).once('value');
     
    const existingPayment = paymentsSnapshot.val() || paymentSnapshot.val();
     
    if (existingPayment && existingPayment.status === 'PAID') {
      return res.redirect('/payments?error=Phòng này đã thanh toán rồi');
    }
     
    // Lấy thông tin phòng để tính toán chi phí chính xác
    const roomData = roomSnapshot.val();
    const [year, monthNum] = month.split('-');
    const currentYear = parseInt(year);
    const currentMonth = parseInt(monthNum);
    
    // Tính toán chi phí thực tế từ usage
    let electricUsage = 0;
    let waterUsage = 0;
    let calculatedAmount = 0;
    
    if (roomData.history) {
      electricUsage = calculateMonthlyUsageByType(roomData.history, currentMonth, currentYear, roomId, 'electric');
      waterUsage = calculateMonthlyUsageByType(roomData.history, currentMonth, currentYear, roomId, 'water');
      
      const electricRate = 3300; // VND per kWh
      const waterRate = 15000; // VND per m³
      
      const electricCost = electricUsage * electricRate;
      const waterCost = waterUsage * waterRate;
      calculatedAmount = electricCost + waterCost;
    }
    
    // Sử dụng amount từ frontend hoặc calculated amount
    const finalAmount = amount ? parseInt(amount) : calculatedAmount;
    
    // Tạo thông tin thanh toán đầy đủ
    const paymentData = {
      amount: finalAmount,
      roomNumber: roomId,
      status: 'PAID',
      paymentMethod: paymentMethod,
      timestamp: new Date().toISOString() // Thêm timestamp
    };
     
    console.log(`📝 Payment data to save:`, paymentData);
     
    // Lưu vào Firebase theo cấu trúc buildings/{buildingId}/rooms/{roomId}/payments/{month}
    await db.ref(`buildings/${targetBuildingId}/rooms/${roomId}/payments/${month}`).set(paymentData);
     
    console.log(`✅ Payment marked successfully for room ${roomId}, month ${month}:`, paymentData);
     
    // Verify data was saved correctly
    const savedData = await db.ref(`buildings/${targetBuildingId}/rooms/${roomId}/payments/${month}`).once('value');
    console.log(`🔍 Verified saved data:`, savedData.val());
    
    res.redirect(`/payments?month=${month}&success=Thanh toán tiền mặt thành công cho phòng ${roomId} - ${finalAmount.toLocaleString('vi-VN')}đ`);
  } catch (error) {
    console.error('Lỗi khi đánh dấu thanh toán:', error);
    res.redirect('/payments?error=Lỗi khi đánh dấu thanh toán: ' + error.message);
  }
});

// Logout route
app.get("/logout", (req, res) => {
  req.session.destroy();
  res.redirect("/");
});

app.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
  console.log("✅ Authentication routes loaded");
  console.log("✅ API routes loaded (includes notifications)");
  console.log("✅ Room routes loaded");
  console.log("✅ Room management routes loaded");
  console.log("✅ Statistics routes loaded");
  console.log("✅ Payment routes loaded");
  console.log("✅ Node routes loaded");
  console.log("✅ All migrations completed!");
});

module.exports = app;