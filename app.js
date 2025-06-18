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
const { addNode, deleteNode, updateNode } = require("./controllers/nodeController");
const { getDashboard } = require("./controllers/dashboardController");
const { getStatistic } = require("./controllers/statisticsController");
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
      return { electric: 0 };
    case 'water':
      return { water: 0 };
    case 'custom':
    default:
      return {};
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

// Page routes
app.get("/dashboard", requireAuth, getDashboard);
app.get("/statistic", requireAuth, getStatistic);
app.get("/payments", requireAuth, getPayments);

// Payment API routes
app.post("/api/create-test-payment", requireAuth, createTestPayment);
app.get("/api/unpaid-previous-months", requireAuth, getUnpaidPreviousMonths);

// Node management routes
app.post("/add-node", requireAuth, addNode);
app.post("/delete-node", requireAuth, deleteNode);
app.post("/update-node", requireAuth, updateNode);

// ==================== MISSING ROOM MANAGEMENT ROUTES ====================

// Add room
app.post('/add-room', requireAuth, async (req, res) => {
  try {
    const { roomNumber } = req.body;

    if (!roomNumber || !roomNumber.trim()) {
      return res.redirect('/dashboard?error=Vui lòng nhập số phòng');
    }

    const trimmedRoomNumber = roomNumber.trim();

    // Validate floor range (any floor 1-9 is valid)
    const firstDigit = trimmedRoomNumber.charAt(0);
    const calculatedFloor = parseInt(firstDigit);
    const roomNum = parseInt(trimmedRoomNumber);
    
    // Check if room number is valid for its floor
    const expectedMin = calculatedFloor * 100 + 1;  // 101, 201, 301, etc.
    const expectedMax = calculatedFloor * 100 + 99; // 199, 299, 399, etc.
    
    if (roomNum < expectedMin || roomNum > expectedMax) {
      return res.redirect(`/dashboard?error=Phòng tầng ${calculatedFloor} phải từ ${expectedMin}-${expectedMax}.`);
    }

    // Check if room already exists
    const roomSnapshot = await db.ref(`rooms/${trimmedRoomNumber}`).once('value');
    if (roomSnapshot.exists()) {
      return res.redirect('/dashboard?error=Phòng đã tồn tại');
    }

    // Create new room with empty phone
    const newRoomData = {
      phone: ""
    };

    await db.ref(`rooms/${trimmedRoomNumber}`).set(newRoomData);

    res.redirect('/dashboard?success=Thêm phòng thành công');
  } catch (error) {
    console.error('Lỗi khi thêm phòng:', error);
    res.redirect('/dashboard?error=Lỗi khi thêm phòng: ' + error.message);
  }
});

// Delete room
app.post('/delete-room', requireAuth, async (req, res) => {
  try {
    const { roomId } = req.body;

    await db.ref(`rooms/${roomId}`).remove();
    res.redirect('/dashboard?success=Xóa phòng thành công');
  } catch (error) {
    console.error('Lỗi khi xóa phòng:', error);
    res.redirect('/dashboard?error=Lỗi khi xóa phòng: ' + error.message);
  }
});

// Assign phone to room
app.post('/assign-phone-to-room', requireAuth, async (req, res) => {
  try {
    let { roomId, phoneNumber } = req.body;

    if (!roomId || !phoneNumber) {
      return res.redirect('/dashboard?error=Thiếu thông tin phòng hoặc số điện thoại');
    }

    // Normalize phone number: convert 0 prefix to +84 for storage
    phoneNumber = phoneNumber.trim();
    if (phoneNumber.startsWith('0') && phoneNumber.length >= 10) {
      phoneNumber = '+84' + phoneNumber.substring(1);
    }

    // Check room exists
    const roomSnapshot = await db.ref(`rooms/${roomId}`).once('value');
    if (!roomSnapshot.exists()) {
      return res.redirect('/dashboard?error=Phòng không tồn tại');
    }

    // Check phone is not already assigned
    const roomsSnapshot = await db.ref('rooms').once('value');
    const allRooms = roomsSnapshot.val() || {};
    
    const phoneAlreadyAssigned = Object.values(allRooms).some(room => 
      room.phone && room.phone.trim() === phoneNumber
    );
    
    if (phoneAlreadyAssigned) {
      return res.redirect('/dashboard?error=Số điện thoại đã được gán cho phòng khác');
    }

    // Get current room data to determine new status
    const currentRoom = roomSnapshot.val();
    let newStatus;
    
    // Has phone: if maintenance keep it, otherwise set occupied
    newStatus = currentRoom.status === 'maintenance' ? 'maintenance' : 'occupied';

    // Update room with phone number and status
    await db.ref(`rooms/${roomId}`).update({
      phone: phoneNumber,
      status: newStatus
    });

    res.redirect('/dashboard?success=Thêm số điện thoại cho phòng thành công');
  } catch (error) {
    console.error('Lỗi khi gán SĐT:', error);
    res.redirect('/dashboard?error=Lỗi khi gán SĐT: ' + error.message);
  }
});

// Update room phone
app.post('/update-room-phone', requireAuth, async (req, res) => {
  try {
    let { roomId, phoneNumber } = req.body;

    if (!roomId) {
      return res.redirect('/dashboard?error=Thiếu thông tin phòng');
    }

    // Normalize phone number: convert 0 prefix to +84 for storage
    if (phoneNumber && phoneNumber.trim()) {
      phoneNumber = phoneNumber.trim();
      if (phoneNumber.startsWith('0') && phoneNumber.length >= 10) {
        phoneNumber = '+84' + phoneNumber.substring(1);
      }
    }

    // Check room exists
    const roomSnapshot = await db.ref(`rooms/${roomId}`).once('value');
    if (!roomSnapshot.exists()) {
      return res.redirect('/dashboard?error=Phòng không tồn tại');
    }

    // If phone number provided, check it's not already assigned to another room
    if (phoneNumber && phoneNumber.trim()) {
      const roomsSnapshot = await db.ref('rooms').once('value');
      const allRooms = roomsSnapshot.val() || {};
      
      const phoneAlreadyAssigned = Object.entries(allRooms).some(([id, room]) => 
        id !== roomId && (room.phone || room.phoneNumber) && (room.phone || room.phoneNumber).trim() === phoneNumber
      );
      
      if (phoneAlreadyAssigned) {
        return res.redirect('/dashboard?error=Số điện thoại đã được gán cho phòng khác');
      }
    }

    // Get current room data to determine status
    const currentRoom = roomSnapshot.val();
    let newStatus;
    
    if (phoneNumber && phoneNumber.trim()) {
      // Has phone: if maintenance keep it, otherwise set occupied
      newStatus = currentRoom.status === 'maintenance' ? 'maintenance' : 'occupied';
    } else {
      // No phone: if maintenance keep it, otherwise set vacant
      newStatus = currentRoom.status === 'maintenance' ? 'maintenance' : 'vacant';
    }

    // Update room phone and status - use 'phone' field to match database structure
    await db.ref(`rooms/${roomId}`).update({
      phone: phoneNumber || '',
      status: newStatus
    });

    res.redirect('/dashboard?success=Cập nhật số điện thoại phòng thành công');
  } catch (error) {
    console.error('Lỗi khi cập nhật số điện thoại phòng:', error);
    res.redirect('/dashboard?error=Lỗi khi cập nhật số điện thoại phòng: ' + error.message);
  }
});

// Remove phone from room
app.post('/remove-phone-from-room', requireAuth, async (req, res) => {
  try {
    const { roomId } = req.body;

    if (!roomId) {
      return res.redirect('/dashboard?error=Thiếu thông tin phòng');
    }

    // Check room exists
    const roomSnapshot = await db.ref(`rooms/${roomId}`).once('value');
    if (!roomSnapshot.exists()) {
      return res.redirect('/dashboard?error=Phòng không tồn tại');
    }

    // Get current room data to determine new status
    const currentRoom = roomSnapshot.val();
    let newStatus;
    
    // No phone: if maintenance keep it, otherwise set vacant
    newStatus = currentRoom.status === 'maintenance' ? 'maintenance' : 'vacant';

    // Remove phone from room and update status - use 'phone' field to match database structure
    await db.ref(`rooms/${roomId}`).update({
      phone: '',
      status: newStatus
    });

    res.redirect('/dashboard?success=Xóa số điện thoại khỏi phòng thành công');
  } catch (error) {
    console.error('Lỗi khi xóa số điện thoại khỏi phòng:', error);
    res.redirect('/dashboard?error=Lỗi khi xóa số điện thoại khỏi phòng: ' + error.message);
  }
});

// Add tenant to room (NEW)
app.post('/add-tenant', requireAuth, async (req, res) => {
  try {
    const { roomId, tenantName, phoneNumber } = req.body;

    if (!roomId || !tenantName || !phoneNumber) {
      return res.redirect('/dashboard?error=Vui lòng nhập đầy đủ thông tin người thuê');
    }

    // Validate input
    const trimmedName = tenantName.trim();
    let trimmedPhone = phoneNumber.trim();

    if (!trimmedName || !trimmedPhone) {
      return res.redirect('/dashboard?error=Tên và số điện thoại không được để trống');
    }

    // Normalize phone number: convert 0 prefix to +84 for storage
    if (trimmedPhone.startsWith('0') && trimmedPhone.length >= 10) {
      trimmedPhone = '+84' + trimmedPhone.substring(1);
    }

    // Check room exists and is vacant
    const roomSnapshot = await db.ref(`rooms/${roomId}`).once('value');
    if (!roomSnapshot.exists()) {
      return res.redirect('/dashboard?error=Phòng không tồn tại');
    }

    const currentRoom = roomSnapshot.val();
    if (currentRoom.phone && currentRoom.phone.trim()) {
      return res.redirect('/dashboard?error=Phòng đã có người thuê');
    }

    // Check phone is not already assigned to another room
    const roomsSnapshot = await db.ref('rooms').once('value');
    const allRooms = roomsSnapshot.val() || {};
    
    const phoneAlreadyAssigned = Object.entries(allRooms).some(([id, room]) => 
      id !== roomId && room.phone && room.phone.trim() === trimmedPhone
    );
    
    if (phoneAlreadyAssigned) {
      return res.redirect('/dashboard?error=Số điện thoại đã được sử dụng cho phòng khác');
    }

    // Create tenant data structure (simplified)
    const tenantData = {
      name: trimmedName,
      phone: trimmedPhone
    };

    // Determine new status
    let newStatus = currentRoom.status === 'maintenance' ? 'maintenance' : 'occupied';

    // Check if room already has tenants array, if not create it
    const currentTenants = currentRoom.tenants || [];
    const updatedTenants = [...currentTenants, tenantData];

    // Update room with tenant info
    await db.ref(`rooms/${roomId}`).update({
      phone: trimmedPhone,  // Keep for backward compatibility (representative phone)
      tenants: updatedTenants,  // New multi-tenant structure
      status: newStatus
    });

    res.redirect('/dashboard?success=Thêm người thuê thành công');
  } catch (error) {
    console.error('Lỗi khi thêm người thuê:', error);
    res.redirect('/dashboard?error=Lỗi khi thêm người thuê: ' + error.message);
  }
});

// Add tenant to room (API)
app.post('/api/room/:roomId/add-tenant', requireAuth, async (req, res) => {
  try {
    const { roomId } = req.params;
    const { tenantName, phoneNumber } = req.body;

    if (!roomId || !tenantName || !phoneNumber) {
      return res.json({ success: false, message: 'Vui lòng nhập đầy đủ thông tin người thuê' });
    }

    // Validate input
    const trimmedName = tenantName.trim();
    let trimmedPhone = phoneNumber.trim();

    if (!trimmedName || !trimmedPhone) {
      return res.json({ success: false, message: 'Tên và số điện thoại không được để trống' });
    }

    // Normalize phone number: convert 0 prefix to +84 for storage
    if (trimmedPhone.startsWith('0') && trimmedPhone.length >= 10) {
      trimmedPhone = '+84' + trimmedPhone.substring(1);
    }

    // Check room exists
    const roomSnapshot = await db.ref(`rooms/${roomId}`).once('value');
    if (!roomSnapshot.exists()) {
      return res.json({ success: false, message: 'Phòng không tồn tại' });
    }

    const currentRoom = roomSnapshot.val();
    
    // Check if this phone is already in use by any tenant in any room
    const roomsSnapshot = await db.ref('rooms').once('value');
    const allRooms = roomsSnapshot.val() || {};
    
    const phoneAlreadyAssigned = Object.entries(allRooms).some(([id, room]) => {
      if (room.tenants && Array.isArray(room.tenants)) {
        return room.tenants.some(tenant => tenant.phone === trimmedPhone);
      }
      // Also check old phone field for backward compatibility
      return room.phone && room.phone.trim() === trimmedPhone;
    });
    
    if (phoneAlreadyAssigned) {
      return res.json({ success: false, message: 'Số điện thoại đã được sử dụng cho phòng khác' });
    }

    // Create tenant data structure
    const tenantData = {
      name: trimmedName,
      phone: trimmedPhone
    };

    // Get current tenants array
    const currentTenants = currentRoom.tenants || [];
    const updatedTenants = [...currentTenants, tenantData];

    // Update room data
    const updateData = {
      tenants: updatedTenants,
      status: 'occupied'
    };

    // If this is the first tenant, also update the phone field for backward compatibility
    if (currentTenants.length === 0) {
      updateData.phone = trimmedPhone;
    }

    // Update room with new tenant
    await db.ref(`rooms/${roomId}`).update(updateData);

    res.json({ 
      success: true, 
      message: 'Thêm người thuê thành công',
      tenant: tenantData,
      totalTenants: updatedTenants.length
    });
  } catch (error) {
    console.error('Lỗi khi thêm người thuê:', error);
    res.json({ success: false, message: 'Lỗi khi thêm người thuê: ' + error.message });
  }
});

// Edit tenant in room (API)
app.post('/api/room/:roomId/edit-tenant', requireAuth, async (req, res) => {
  try {
    const { roomId } = req.params;
    const { tenantIndex, tenantName, phoneNumber } = req.body;

    if (!roomId || tenantIndex === undefined || !tenantName || !phoneNumber) {
      return res.json({ success: false, message: 'Vui lòng nhập đầy đủ thông tin' });
    }

    // Validate input
    const trimmedName = tenantName.trim();
    let trimmedPhone = phoneNumber.trim();
    const index = parseInt(tenantIndex);

    if (!trimmedName || !trimmedPhone || index < 0) {
      return res.json({ success: false, message: 'Thông tin không hợp lệ' });
    }

    // Normalize phone number
    if (trimmedPhone.startsWith('0') && trimmedPhone.length >= 10) {
      trimmedPhone = '+84' + trimmedPhone.substring(1);
    }

    // Check room exists
    const roomSnapshot = await db.ref(`rooms/${roomId}`).once('value');
    if (!roomSnapshot.exists()) {
      return res.json({ success: false, message: 'Phòng không tồn tại' });
    }

    const currentRoom = roomSnapshot.val();
    const currentTenants = currentRoom.tenants || [];

    if (index >= currentTenants.length) {
      return res.json({ success: false, message: 'Không tìm thấy người thuê' });
    }

    // Check if phone is already used by another tenant (excluding current tenant)
    const roomsSnapshot = await db.ref('rooms').once('value');
    const allRooms = roomsSnapshot.val() || {};
    
    const phoneAlreadyAssigned = Object.entries(allRooms).some(([id, room]) => {
      if (room.tenants && Array.isArray(room.tenants)) {
        return room.tenants.some((tenant, idx) => {
          // Skip current tenant being edited
          if (id === roomId && idx === index) return false;
          return tenant.phone === trimmedPhone;
        });
      }
      // Also check old phone field, but skip if it's the current room's representative being edited
      if (id === roomId && index === 0) return false;
      return room.phone && room.phone.trim() === trimmedPhone;
    });
    
    if (phoneAlreadyAssigned) {
      return res.json({ success: false, message: 'Số điện thoại đã được sử dụng bởi người thuê khác' });
    }

    // Update tenant data
    const updatedTenants = [...currentTenants];
    updatedTenants[index] = {
      name: trimmedName,
      phone: trimmedPhone
    };

    // Update room data
    const updateData = {
      tenants: updatedTenants
    };

    // If editing the representative (index 0), also update the phone field
    if (index === 0) {
      updateData.phone = trimmedPhone;
    }

    await db.ref(`rooms/${roomId}`).update(updateData);

    res.json({ 
      success: true, 
      message: 'Cập nhật thông tin người thuê thành công',
      updatedTenant: updatedTenants[index]
    });
  } catch (error) {
    console.error('Lỗi khi cập nhật người thuê:', error);
    res.json({ success: false, message: 'Lỗi khi cập nhật người thuê: ' + error.message });
  }
});

// Delete tenant from room (API)
app.post('/api/room/:roomId/delete-tenant', requireAuth, async (req, res) => {
  try {
    const { roomId } = req.params;
    const { tenantIndex } = req.body;

    if (!roomId || tenantIndex === undefined) {
      return res.json({ success: false, message: 'Thiếu thông tin cần thiết' });
    }

    const index = parseInt(tenantIndex);
    if (index < 0) {
      return res.json({ success: false, message: 'Chỉ số người thuê không hợp lệ' });
    }

    // Check room exists
    const roomSnapshot = await db.ref(`rooms/${roomId}`).once('value');
    if (!roomSnapshot.exists()) {
      return res.json({ success: false, message: 'Phòng không tồn tại' });
    }

    const currentRoom = roomSnapshot.val();
    const currentTenants = currentRoom.tenants || [];

    if (index >= currentTenants.length) {
      return res.json({ success: false, message: 'Không tìm thấy người thuê' });
    }

    // Remove tenant from array
    const updatedTenants = currentTenants.filter((_, i) => i !== index);

    // Update room data
    const updateData = {
      tenants: updatedTenants
    };

    // Update room status and representative phone
    if (updatedTenants.length === 0) {
      // No tenants left - mark as vacant
      updateData.status = 'vacant';
      updateData.phone = '';
    } else {
      // Update representative phone (first tenant becomes representative)
      updateData.phone = updatedTenants[0].phone;
      updateData.status = 'occupied';
    }

    await db.ref(`rooms/${roomId}`).update(updateData);

    const deletedTenantName = currentTenants[index].name;
    const message = updatedTenants.length === 0 
      ? `Đã xóa người thuê "${deletedTenantName}". Phòng hiện đang trống.`
      : `Đã xóa người thuê "${deletedTenantName}". ${index === 0 ? `"${updatedTenants[0].name}" hiện là đại diện mới.` : ''}`;

    res.json({ 
      success: true, 
      message: message,
      remainingTenants: updatedTenants.length
    });
  } catch (error) {
    console.error('Lỗi khi xóa người thuê:', error);
    res.json({ success: false, message: 'Lỗi khi xóa người thuê: ' + error.message });
  }
});

// Get room data for frontend updates (API)
app.get('/api/room/:roomId/data', requireAuth, async (req, res) => {
  try {
    const { roomId } = req.params;
    
    const roomSnapshot = await db.ref(`rooms/${roomId}`).once('value');
    if (!roomSnapshot.exists()) {
      return res.json({ success: false, message: 'Phòng không tồn tại' });
    }
    
    const roomData = roomSnapshot.val();
    const tenants = roomData.tenants || [];
    
    // Format room data similar to dashboard controller
    const room = {
      id: roomId,
      roomNumber: roomData.roomNumber || roomId,
      phoneNumber: formatPhoneNumber(roomData.phone || ''),
      tenantName: tenants.length > 0 ? tenants[0].name : '',
      tenantCount: tenants.length,
      status: roomData.status || 'vacant',
      floor: roomData.floor || 1
    };
    
    res.json({ 
      success: true, 
      room: room
    });
  } catch (error) {
    console.error('Lỗi khi lấy dữ liệu phòng:', error);
    res.json({ success: false, message: 'Lỗi khi lấy dữ liệu phòng' });
  }
});

// Get tenants list for a room (API)
app.get('/api/room/:roomId/tenants', requireAuth, async (req, res) => {
  try {
    const { roomId } = req.params;
    
    const roomSnapshot = await db.ref(`rooms/${roomId}`).once('value');
    if (!roomSnapshot.exists()) {
      return res.json({ success: false, message: 'Phòng không tồn tại' });
    }
    
    const roomData = roomSnapshot.val();
    const tenants = roomData.tenants || [];
    
    res.json({ 
      success: true, 
      tenants: tenants,
      count: tenants.length
    });
  } catch (error) {
    console.error('Lỗi khi lấy danh sách người thuê:', error);
    res.json({ success: false, message: 'Lỗi khi lấy danh sách người thuê' });
  }
});

// Helper function to calculate monthly usage by type
function calculateMonthlyUsageByType(historyData, month, year, roomId, dataType) {
  try {
    const monthStr = month.toString().padStart(2, '0');
    const yearStr = year.toString();
    
    console.log(`📅 Calculating ${dataType} usage for room ${roomId} for ${monthStr}/${yearStr}`);
    
    // Get all dates in current month
    const monthDates = [];
    const daysInMonth = new Date(year, month, 0).getDate();
    
    for (let day = 1; day <= daysInMonth; day++) {
      const dayStr = day.toString().padStart(2, '0');
      const dateStr = `${yearStr}-${monthStr}-${dayStr}`;
      if (historyData[dateStr] && historyData[dateStr][dataType] !== undefined) {
        monthDates.push({
          date: dateStr,
          value: historyData[dateStr][dataType] || 0
        });
      }
    }
    
    console.log(`📊 Found ${monthDates.length} days of ${dataType} data for room ${roomId}`);
    
    if (monthDates.length < 2) {
      console.log(`⚠️ Not enough ${dataType} data for room ${roomId} (need at least 2 days)`);
      return 0;
    }
    
    // Sort by date
    monthDates.sort((a, b) => a.date.localeCompare(b.date));
    
    // Get first and last readings of the month
    const firstValue = monthDates[0].value;
    const lastValue = monthDates[monthDates.length - 1].value;
    
    console.log(`🔍 Room ${roomId} ${dataType}: ${firstValue} -> ${lastValue} (${monthDates[0].date} to ${monthDates[monthDates.length - 1].date})`);
    
    // Calculate usage (ensure non-negative)
    const usage = Math.max(0, lastValue - firstValue);
    
    console.log(`📈 Room ${roomId} ${dataType} monthly usage: ${usage}`);
    
    return usage;
    
  } catch (error) {
    console.error(`❌ Lỗi khi tính ${dataType} usage cho room ${roomId}:`, error);
    return 0;
  }
}

// Mark payment route
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
     
    // Kiểm tra phòng tồn tại
    const roomSnapshot = await db.ref(`rooms/${roomId}`).once('value');
    if (!roomSnapshot.exists()) {
      return res.redirect('/payments?error=Phòng không tồn tại');
    }
    
    // Kiểm tra xem đã thanh toán chưa - kiểm tra cả payments và payment
    const paymentsSnapshot = await db.ref(`rooms/${roomId}/payments/${month}`).once('value');
    const paymentSnapshot = await db.ref(`rooms/${roomId}/payment/${month}`).once('value');
     
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
      timestamp: new Date().toISOString(),
      paymentMethod: paymentMethod, 
    };
     
    console.log(`📝 Payment data to save:`, paymentData);
     
    // Lưu vào Firebase theo cấu trúc rooms/{roomId}/payments/{month} (số nhiều)
    await db.ref(`rooms/${roomId}/payments/${month}`).set(paymentData);
     
    console.log(`✅ Payment marked successfully for room ${roomId}, month ${month}:`, paymentData);
     
    // Verify data was saved correctly
    const savedData = await db.ref(`rooms/${roomId}/payments/${month}`).once('value');
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