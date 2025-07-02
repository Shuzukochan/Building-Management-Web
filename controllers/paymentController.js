const { db } = require("../config/database");
const { formatPhoneNumber } = require("../services/phoneService");

// Helper function to calculate monthly usage for specific data type (from index.js)
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

// Get payments page
const getPayments = async (req, res) => {
  try {
    // Xác định building_id để lấy dữ liệu
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
    
    // Lấy cả rooms data và phone mapping
    const [roomsSnapshot, phoneToRoomSnapshot] = await Promise.all([
      db.ref(`buildings/${targetBuildingId}/rooms`).once("value"),
      db.ref('phone_to_room').once("value")
    ]);
    
    const roomsData = roomsSnapshot.val() || {};
    const phoneToRoomData = phoneToRoomSnapshot.val() || {};
    
    // Lấy tháng từ query param hoặc tháng hiện tại
    let currentMonth, currentYear, currentMonthKey;
    
    if (req.query.month) {
      // Format: YYYY-MM
      const [year, month] = req.query.month.split("-");
      currentYear = parseInt(year);
      currentMonth = parseInt(month);
      currentMonthKey = req.query.month;
    } else {
      const currentDate = new Date();
      currentYear = currentDate.getFullYear();
      currentMonth = currentDate.getMonth() + 1;
      currentMonthKey = `${currentYear}-${currentMonth.toString().padStart(2, "0")}`;
    }
    
    console.log(`Loading payments for: ${currentMonthKey}`);
    
    // Xử lý dữ liệu phòng và trạng thái thanh toán (giống index.js)
    const rooms = [];
    
    for (const [roomId, roomInfo] of Object.entries(roomsData)) {
      const floor = roomId.charAt(0);
      
      // Get tenants từ global mapping
      const roomTenants = Object.entries(phoneToRoomData)
        .filter(([phone, data]) => data.buildingId === targetBuildingId && data.roomId === roomId)
        .map(([phone, data]) => ({
          phone: phone,
          name: data.name,
          isRepresentative: data.isRepresentative
        }))
        .sort((a, b) => a.isRepresentative === b.isRepresentative ? 0 : a.isRepresentative ? -1 : 1); // Representative first

      // Find representative tenant
      const representative = roomTenants.find(t => t.isRepresentative) || roomTenants[0] || null;
      
      // Tính toán usage từ history (sử dụng logic từ index.js)
      let electricUsage = 0;
      let waterUsage = 0;
      
      if (roomInfo.history) {
        electricUsage = calculateMonthlyUsageByType(roomInfo.history, currentMonth, currentYear, roomId, 'electric');
        waterUsage = calculateMonthlyUsageByType(roomInfo.history, currentMonth, currentYear, roomId, 'water');
      }
      
      // Tính toán chi phí (giống index.js)
      const electricRate = 3300; // VND per kWh
      const waterRate = 15000; // VND per m³
      
      const electricCost = electricUsage * electricRate;
      const waterCost = waterUsage * waterRate;
      const totalCost = electricCost + waterCost; // Chỉ tính điện + nước
      
      // Kiểm tra trạng thái thanh toán từ Firebase (giống index.js)
      let isPaid = false;
      let paymentDate = null;
      let paymentTimestamp = null;
      let paymentMethod = null;
      
      if (totalCost === 0) {
        // Không phát sinh chi phí - không cần thanh toán
        isPaid = false; // Không set isPaid = true
        paymentDate = null; // Không có ngày thanh toán
        paymentTimestamp = null;
        paymentMethod = null; // Không có phương thức thanh toán
      } else {
        // Kiểm tra cả 'payments' (số nhiều) và 'payment' (số ít) để tương thích
        const paymentsData = roomInfo.payments || roomInfo.payment;
        
        if (paymentsData && paymentsData[currentMonthKey]) {
          const paymentInfo = paymentsData[currentMonthKey];
          isPaid = paymentInfo.status === 'PAID';
          
          // Đọc paymentMethod - ưu tiên paymentMethod trước
          if (paymentInfo.paymentMethod) {
            paymentMethod = paymentInfo.paymentMethod;
          } else if (paymentInfo.method) {
            paymentMethod = paymentInfo.method;
          } else {
            paymentMethod = 'transfer'; // Default fallback
          }
          
          if (isPaid && paymentInfo.timestamp) {
            // Chuyển timestamp thành Date object
            paymentTimestamp = paymentInfo.timestamp;
            if (typeof paymentTimestamp === 'string') {
              paymentDate = new Date(paymentTimestamp);
            } else {
              // Nếu là Firebase timestamp format
              paymentDate = new Date(paymentTimestamp);
            }
          }
        }
      }
      
      // Tính due date (hạn thanh toán vào ngày 10 của tháng SAU)
      const dueDate = new Date(currentYear, currentMonth, 10); // Ngày 10 của tháng SAU
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      dueDate.setHours(0, 0, 0, 0);
      
      const isDueToday = today.getTime() === dueDate.getTime();
      const isOverdue = today > dueDate;
      const daysToDue = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));
      
      // Tạo đối tượng phòng với đầy đủ thông tin (giống index.js)
      const room = {
        id: roomId,
        roomNumber: roomId,
        floor: parseInt(floor),
        phoneNumber: representative ? formatPhoneNumber(representative.phone) : "",
        electricUsage: Math.round(electricUsage * 100) / 100,
        waterUsage: Math.round(waterUsage * 100) / 100,
        electricCost: electricCost,
        waterCost: waterCost,
        totalCost: totalCost,
        isPaid: isPaid,
        paymentDate: paymentDate,
        paymentTimestamp: paymentTimestamp,
        paymentMethod: paymentMethod,
        // Due date logic
        dueDate: dueDate,
        isDueToday: isDueToday,
        isOverdue: isOverdue,
        daysToDue: daysToDue,
        // Status để hiển thị UI
        status: totalCost === 0 ? 'no-cost' : (isPaid ? 'paid' : 'unpaid'),
        // Multi-tenant info
        tenants: roomTenants,
        tenantCount: roomTenants.length,
        representativeTenant: representative,
        // Backward compatibility
        tenant: representative ? { name: representative.name, phone: representative.phone } : null
      };
      
      rooms.push(room);
    }
    
    // Sắp xếp phòng theo số phòng (giống index.js)
    rooms.sort((a, b) => a.roomNumber.localeCompare(b.roomNumber));
    
    // Tính toán thống kê tổng hợp (giống index.js)
    const totalRevenue = rooms.filter(r => r.isPaid).reduce((sum, r) => sum + r.totalCost, 0);
    const unpaidRevenue = rooms.filter(r => !r.isPaid && r.totalCost > 0).reduce((sum, r) => sum + r.totalCost, 0);
    const totalElectricUsage = rooms.reduce((sum, r) => sum + r.electricUsage, 0);
    const totalWaterUsage = rooms.reduce((sum, r) => sum + r.waterUsage, 0);
    
    // Thống kê theo phương thức thanh toán (giống index.js)
    const cashRevenue = rooms.filter(r => r.isPaid && r.paymentMethod === 'cash').reduce((sum, r) => sum + r.totalCost, 0);
    const transferRevenue = rooms.filter(r => r.isPaid && r.paymentMethod === 'transfer').reduce((sum, r) => sum + r.totalCost, 0);
    
    // Đếm số phòng theo trạng thái (giống index.js)
    const paidCount = rooms.filter(r => r.isPaid).length;
    const unpaidCount = rooms.filter(r => !r.isPaid && r.totalCost > 0).length;
    const noCostCount = rooms.filter(r => r.totalCost === 0).length;
    
    // Stats cho cards
    const totalRooms = rooms.filter(r => r.phoneNumber && r.phoneNumber.trim() !== '').length; // Phòng có người thuê
    const paidRooms = paidCount;
    const overdueRooms = rooms.filter(r => !r.isPaid && r.totalCost > 0 && r.isOverdue).length;
    const paymentRate = totalRooms > 0 ? Math.round((paidRooms / totalRooms) * 100) : 0;
    
    console.log(`💰 Payment summary for ${currentMonthKey}:`);
    console.log(`   Paid: ${paidCount} rooms - ${totalRevenue.toLocaleString('vi-VN')}đ`);
    console.log(`   Unpaid: ${unpaidCount} rooms - ${unpaidRevenue.toLocaleString('vi-VN')}đ`);
    console.log(`   No cost: ${noCostCount} rooms`);
    
    console.log(`💰 Revenue breakdown: Cash = ${cashRevenue}, Transfer = ${transferRevenue}, Total = ${totalRevenue}`);
    
    // Load buildings từ Firebase
    let buildings = {};
    try {
      const buildingsSnapshot = await db.ref('buildings').once('value');
      const buildingsData = buildingsSnapshot.val() || {};
      buildings = Object.fromEntries(
        Object.entries(buildingsData).map(([id, data]) => [id, { name: data.name || id }])
      );
    } catch (buildingError) {
      console.error('Error loading buildings in payments:', buildingError);
      // Fallback to default buildings
      buildings = {
        building_id_1: { name: "Tòa nhà A" },
        building_id_2: { name: "Tòa nhà B" }
      };
    }
    
    res.render("payments", {
      rooms: rooms,
      currentMonth: currentMonth,
      currentYear: currentYear,
      currentMonthKey: currentMonthKey,
      stats: {
        totalRevenue: totalRevenue,
        unpaidRevenue: unpaidRevenue,
        totalElectricUsage: Math.round(totalElectricUsage * 100) / 100,
        totalWaterUsage: Math.round(totalWaterUsage * 100) / 100,
        paidCount: paidCount,
        unpaidCount: unpaidCount,
        noCostCount: noCostCount,
        cashRevenue: cashRevenue,
        transferRevenue: transferRevenue,
        // Stats cho cards
        totalRooms: totalRooms,
        paidRooms: paidRooms,
        overdueRooms: overdueRooms,
        paymentRate: paymentRate
      },
      currentPage: 'payments',
      success: req.query.success || null,
      error: req.query.error || null,
      admin: req.session.admin,
      buildings,
      selectedBuildingId: req.session.selectedBuildingId,
      currentBuildingId: targetBuildingId
    });
    
  } catch (error) {
    console.error("Lỗi khi tải trang payments:", error);
    // Load buildings cho error case
    let buildings = {};
    try {
      const buildingsSnapshot = await db.ref('buildings').once('value');
      const buildingsData = buildingsSnapshot.val() || {};
      buildings = Object.fromEntries(
        Object.entries(buildingsData).map(([id, data]) => [id, { name: data.name || id }])
      );
    } catch (buildingError) {
      console.error('Error loading buildings in payments error case:', buildingError);
      buildings = {
        building_id_1: { name: "Tòa nhà A" },
        building_id_2: { name: "Tòa nhà B" }
      };
    }
    res.render("payments", {
      rooms: [],
      currentMonth: new Date().getMonth() + 1,
      currentYear: new Date().getFullYear(),
      currentMonthKey: `${new Date().getFullYear()}-${(new Date().getMonth() + 1).toString().padStart(2, '0')}`,
      stats: {
        totalRevenue: 0,
        unpaidRevenue: 0,
        totalElectricUsage: 0,
        totalWaterUsage: 0,
        paidCount: 0,
        unpaidCount: 0,
        noCostCount: 0,
        cashRevenue: 0,
        transferRevenue: 0,
        // Stats cho cards  
        totalRooms: 0,
        paidRooms: 0,
        overdueRooms: 0,
        paymentRate: 0
      },
      currentPage: 'payments',
      success: null,
      error: "Lỗi khi tải dữ liệu thanh toán",
      admin: req.session.admin,
      buildings,
      selectedBuildingId: req.session.selectedBuildingId,
      currentBuildingId: 'building_id_1'
    });
  }
};

// Mark payment (matching index.js logic)
const markPayment = async (req, res) => {
  try {
    const { roomId, month, paymentMethod, amount } = req.body;
    
    if (!roomId || !month) {
      return res.status(400).json({ 
        success: false, 
        error: "Thiếu thông tin cần thiết" 
      });
    }
    
    console.log(`💰 Marking payment for room ${roomId} for month ${month} via ${paymentMethod}`);
    
    // Validation paymentMethod
    if (!paymentMethod || (paymentMethod !== 'cash' && paymentMethod !== 'transfer')) {
      return res.status(400).json({ 
        success: false, 
        error: "Phương thức thanh toán không hợp lệ" 
      });
    }
    
    // Xác định building_id để lấy dữ liệu
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
    
    // Kiểm tra phòng tồn tại
    const roomSnapshot = await db.ref(`buildings/${targetBuildingId}/rooms/${roomId}`).once('value');
    if (!roomSnapshot.exists()) {
      return res.status(404).json({ 
        success: false, 
        error: "Phòng không tồn tại" 
      });
    }
    
    // Kiểm tra xem đã thanh toán chưa
    const paymentsSnapshot = await db.ref(`buildings/${targetBuildingId}/rooms/${roomId}/payments/${month}`).once('value');
    const paymentSnapshot = await db.ref(`buildings/${targetBuildingId}/rooms/${roomId}/payment/${month}`).once('value');
    
    const existingPayment = paymentsSnapshot.val() || paymentSnapshot.val();
    
    if (existingPayment && existingPayment.status === 'PAID') {
      return res.status(400).json({ 
        success: false, 
        error: "Phòng này đã thanh toán rồi" 
      });
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
      method: paymentMethod, // Trường chính
      paymentMethod: paymentMethod, // Trường backup để đảm bảo
      electricUsage: electricUsage,
      waterUsage: waterUsage,
      electricCost: electricUsage * 3300,
      waterCost: waterUsage * 15000,
      paidBy: 'admin', // Người đánh dấu thanh toán
      timestamp: new Date().toISOString(), // Thêm ngày thanh toán
      note: `Thanh toán ${paymentMethod === 'cash' ? 'tiền mặt' : 'chuyển khoản'} tháng ${currentMonth}/${currentYear}`
    };
    
    console.log(`📝 Payment data to save:`, paymentData);
    
    // Lưu vào Firebase theo cấu trúc buildings/{buildingId}/rooms/{roomId}/payments/{month}
    await db.ref(`buildings/${targetBuildingId}/rooms/${roomId}/payments/${month}`).set(paymentData);
    
    console.log(`✅ Payment marked successfully for room ${roomId}, month ${month}:`, paymentData);
    
    res.json({ 
      success: true, 
      message: `Đã đánh dấu thanh toán thành công cho phòng ${roomId} - ${finalAmount.toLocaleString('vi-VN')}đ`,
      data: paymentData
    });
  } catch (error) {
    console.error("Error marking payment:", error);
    res.status(500).json({ 
      success: false, 
      error: "Lỗi khi đánh dấu thanh toán: " + error.message 
    });
  }
};

// Create test payment
const createTestPayment = async (req, res) => {
  try {
    const { roomId, month } = req.body;
    
    if (!roomId || !month) {
      return res.status(400).json({ error: "Missing roomId or month" });
    }
    
    // Xác định building_id để lưu dữ liệu
    let targetBuildingId = 'building_id_1'; // mặc định Tòa nhà A
    
    if (req.session.admin) {
      if (req.session.admin.role === 'admin') {
        targetBuildingId = req.session.admin.building_ids || 'building_id_1';
      } else if (req.session.admin.role === 'super_admin' && req.session.selectedBuildingId) {
        targetBuildingId = req.session.selectedBuildingId;
      }
    }
    
    // Tạo test payment data
    const testPayment = {
      amount: Math.floor(Math.random() * 500000) + 100000, // 100k - 600k VND
      status: "paid",
      month: month,
      note: "Test payment"
    };
    
    await db.ref(`buildings/${targetBuildingId}/rooms/${roomId}/payments/${month}`).set(testPayment);
    
    res.json({ success: true, message: "Test payment created", payment: testPayment });
  } catch (error) {
    console.error("Error creating test payment:", error);
    res.status(500).json({ error: "Failed to create test payment" });
  }
};

// Get unpaid previous months (matching index.js logic)
const getUnpaidPreviousMonths = async (req, res) => {
  try {
    // Xác định building_id để lấy dữ liệu
    let targetBuildingId = 'building_id_1'; // mặc định Tòa nhà A
    
    if (req.session.admin) {
      if (req.session.admin.role === 'admin') {
        targetBuildingId = req.session.admin.building_ids || 'building_id_1';
      } else if (req.session.admin.role === 'super_admin' && req.session.selectedBuildingId) {
        targetBuildingId = req.session.selectedBuildingId;
      }
    }
    
    // Lấy cả rooms data và phone mapping
    const [roomsSnapshot, phoneToRoomSnapshot] = await Promise.all([
      db.ref(`buildings/${targetBuildingId}/rooms`).once('value'),
      db.ref('phone_to_room').once('value')
    ]);
    
    const roomsData = roomsSnapshot.val() || {};
    const phoneToRoomData = phoneToRoomSnapshot.val() || {};
    
    const currentDate = new Date();
    const currentMonth = currentDate.getMonth() + 1;
    const currentYear = currentDate.getFullYear();
    
    console.log(`🔍 Checking unpaid months from current: ${currentMonth}/${currentYear}`);
    
    const unpaidMonths = [];
    
    // Kiểm tra 3 tháng trước (giảm từ 6 xuống 3 để tránh noise)
    for (let i = 1; i <= 3; i++) {
      const checkDate = new Date(currentYear, currentMonth - 1 - i, 1);
      const checkMonth = checkDate.getMonth() + 1;
      const checkYear = checkDate.getFullYear();
      const monthKey = `${checkYear}-${String(checkMonth).padStart(2, '0')}`;
      
      console.log(`📅 Checking month: ${checkMonth}/${checkYear} (${monthKey})`);
      
      let unpaidCount = 0;
      let totalRoomsChecked = 0;
      
      // Đếm số phòng chưa thanh toán trong tháng này
      for (const [roomId, roomInfo] of Object.entries(roomsData)) {
        // Check if room has tenants from global phone mapping
        const roomTenants = Object.entries(phoneToRoomData)
          .filter(([phone, data]) => data.buildingId === targetBuildingId && data.roomId === roomId);
        
        // Chỉ kiểm tra phòng có người thuê
        if (roomTenants.length > 0) {
          totalRoomsChecked++;
          
          // Kiểm tra thanh toán trước khi tính chi phí (tối ưu hóa)
          const paymentsData = roomInfo.payments || roomInfo.payment;
          const hasPayment = paymentsData && 
                            paymentsData[monthKey] && 
                            paymentsData[monthKey].status === 'PAID';
        
          if (hasPayment) {
            console.log(`✅ Room ${roomId} already paid for ${monthKey}`);
            continue; // Đã thanh toán, bỏ qua
          }
          
          // Tính toán chi phí cho tháng này
          let electricUsage = 0;
          let waterUsage = 0;
          
          if (roomInfo.history) {
            electricUsage = calculateMonthlyUsageByType(roomInfo.history, checkMonth, checkYear, roomId, 'electric');
            waterUsage = calculateMonthlyUsageByType(roomInfo.history, checkMonth, checkYear, roomId, 'water');
          }
          
          const electricCost = electricUsage * 3300;
          const waterCost = waterUsage * 15000;
          const totalCost = electricCost + waterCost;
          
          console.log(`🏠 Room ${roomId} - ${monthKey}: Cost=${totalCost}đ, Paid=${hasPayment}`);
          
          // Nếu chi phí > 0 và chưa thanh toán thì đếm vào unpaid
          if (totalCost > 0) {
            unpaidCount++;
            console.log(`❌ Room ${roomId} unpaid for ${monthKey}: ${totalCost}đ`);
          } else {
            console.log(`⚪ Room ${roomId} no cost for ${monthKey}`);
          }
        }
      }
      
      console.log(`📊 Month ${monthKey}: ${unpaidCount}/${totalRoomsChecked} rooms unpaid`);
      
      if (unpaidCount > 0) {
        unpaidMonths.push({
          month: `${checkMonth}/${checkYear}`,
          monthKey: monthKey,
          count: unpaidCount
          });
        }
      }
    
    console.log(`🔍 Found ${unpaidMonths.length} unpaid months`);
    
    res.json({ success: true, unpaidMonths: unpaidMonths });
  } catch (error) {
    console.error("Error getting unpaid previous months:", error);
    res.status(500).json({ error: "Failed to get unpaid previous months" });
  }
};

module.exports = {
  getPayments,
  markPayment,
  createTestPayment,
  getUnpaidPreviousMonths
};