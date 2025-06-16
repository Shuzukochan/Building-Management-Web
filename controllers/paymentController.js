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
    const roomsSnapshot = await db.ref("rooms").once("value");
    const roomsData = roomsSnapshot.val() || {};
    
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
          
          // Đọc paymentMethod - ưu tiên method trước
          if (paymentInfo.method) {
            paymentMethod = paymentInfo.method;
          } else if (paymentInfo.paymentMethod) {
            paymentMethod = paymentInfo.paymentMethod;
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
      
      const room = {
        id: roomId,
        roomNumber: roomId,
        phoneNumber: formatPhoneNumber(roomInfo.phone || ''),
        floor: parseInt(floor),
        status: (roomInfo.phone && roomInfo.phone.trim()) ? 'occupied' : 'vacant',
        currentMonth: currentMonthKey,
        payment: {
          isPaid: isPaid,
          paymentDate: paymentDate,
          paymentTimestamp: paymentTimestamp,
          paymentMethod: paymentMethod,
          electricUsage: electricUsage,
          electricCost: electricCost,
          waterUsage: waterUsage,
          waterCost: waterCost,
          totalCost: totalCost,
          dueDate: new Date(currentYear, currentMonth, 5) // Hạn thanh toán ngày 5 tháng sau
        }
      };
      
      rooms.push(room);
    }
    
    // Sắp xếp theo số phòng
    rooms.sort((a, b) => a.roomNumber.localeCompare(b.roomNumber));
    
    // Tính thống kê (giống index.js)
    const occupiedRooms = rooms.filter(r => r.status === 'occupied');
    
    // Chỉ tính các phòng có chi phí > 0 vào thống kê thanh toán
    const roomsNeedPayment = occupiedRooms.filter(r => r.payment.totalCost > 0);
    const paidRooms = roomsNeedPayment.filter(r => r.payment.isPaid);
    const unpaidRooms = roomsNeedPayment.filter(r => !r.payment.isPaid);
    
    // Tính overdueRooms - phòng quá hạn thanh toán (chỉ tính phòng có chi phí > 0)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const overdueRooms = roomsNeedPayment.filter(r => {
      if (r.payment.isPaid) return false;
      const dueDate = new Date(r.payment.dueDate);
      dueDate.setHours(0, 0, 0, 0);
      return today > dueDate;
    });
    
    const totalRevenue = paidRooms.reduce((sum, room) => sum + room.payment.totalCost, 0);
    const pendingRevenue = unpaidRooms.reduce((sum, room) => sum + room.payment.totalCost, 0);
    
    res.render("payments", {
      rooms,
      currentMonth,
      currentYear,
      currentMonthKey,
      currentPage: 'payments',
      stats: {
        totalRooms: occupiedRooms.length,
        paidRooms: paidRooms.length,
        unpaidRooms: unpaidRooms.length,
        overdueRooms: overdueRooms.length,
        totalRevenue: totalRevenue,
        pendingRevenue: pendingRevenue,
        paymentRate: occupiedRooms.length > 0 ? Math.round((paidRooms.length / occupiedRooms.length) * 100) : 0
      },
      success: req.query.success || null,
      error: req.query.error || null
    });
    
  } catch (error) {
    console.error("Error loading payments:", error);
    res.render("payments", {
      rooms: [],
      currentMonth: new Date().getMonth() + 1,
      currentYear: new Date().getFullYear(),
      currentMonthKey: `${new Date().getFullYear()}-${(new Date().getMonth() + 1).toString().padStart(2, "0")}`,
      currentPage: 'payments',
      stats: {
        totalRooms: 0,
        paidRooms: 0,
        unpaidRooms: 0,
        overdueRooms: 0,
        totalRevenue: 0,
        pendingRevenue: 0,
        paymentRate: 0
      },
      success: null,
      error: "Lỗi khi tải dữ liệu thanh toán"
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
    
    // Kiểm tra phòng tồn tại
    const roomSnapshot = await db.ref(`rooms/${roomId}`).once('value');
    if (!roomSnapshot.exists()) {
      return res.status(404).json({ 
        success: false, 
        error: "Phòng không tồn tại" 
      });
    }
    
    // Kiểm tra xem đã thanh toán chưa
    const paymentsSnapshot = await db.ref(`rooms/${roomId}/payments/${month}`).once('value');
    const paymentSnapshot = await db.ref(`rooms/${roomId}/payment/${month}`).once('value');
    
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
      timestamp: new Date().toISOString(),
      method: paymentMethod, // Trường chính
      paymentMethod: paymentMethod, // Trường backup để đảm bảo
      electricUsage: electricUsage,
      waterUsage: waterUsage,
      electricCost: electricUsage * 3300,
      waterCost: waterUsage * 15000,
      paidAt: Date.now(),
      paidBy: 'admin', // Người đánh dấu thanh toán
      note: `Thanh toán ${paymentMethod === 'cash' ? 'tiền mặt' : 'chuyển khoản'} tháng ${currentMonth}/${currentYear}`
    };
    
    console.log(`📝 Payment data to save:`, paymentData);
    
    // Lưu vào Firebase theo cấu trúc rooms/{roomId}/payments/{month} (số nhiều)
    await db.ref(`rooms/${roomId}/payments/${month}`).set(paymentData);
    
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
    
    // Tạo test payment data
    const testPayment = {
      amount: Math.floor(Math.random() * 500000) + 100000, // 100k - 600k VND
      status: "paid",
      paidAt: Date.now(),
      month: month,
      note: "Test payment"
    };
    
    await db.ref(`rooms/${roomId}/payments/${month}`).set(testPayment);
    
    res.json({ success: true, message: "Test payment created", payment: testPayment });
  } catch (error) {
    console.error("Error creating test payment:", error);
    res.status(500).json({ error: "Failed to create test payment" });
  }
};

// Get unpaid previous months (matching index.js logic)
const getUnpaidPreviousMonths = async (req, res) => {
  try {
    const roomsSnapshot = await db.ref('rooms').once('value');
    const roomsData = roomsSnapshot.val() || {};
    
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
        // Chỉ kiểm tra phòng có người thuê
        if (roomInfo.phone && roomInfo.phone.trim()) {
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
    
    console.log(`📊 Final result: ${unpaidMonths.length} months with unpaid rooms:`, unpaidMonths);
    
    res.json({
      success: true,
      unpaidMonths: unpaidMonths
    });
    
  } catch (error) {
    console.error('Lỗi khi kiểm tra tháng chưa thanh toán:', error);
    res.status(500).json({
      success: false,
      error: 'Lỗi server khi kiểm tra tháng chưa thanh toán'
    });
  }
};

module.exports = {
  getPayments,
  markPayment,
  createTestPayment,
  getUnpaidPreviousMonths
};