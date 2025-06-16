const { db } = require("../config/database");
const { 
  calculateMonthlyUsageByType,
  getLastNDays,
  processHistoryData,
  processMonthlyHistoryData
} = require("../services/statisticsService");

// Get statistic page - migrated from index.js
const getStatistic = async (req, res) => {
  try {
    let { 
      roomId, 
      fromElectric, 
      toElectric, 
      fromWater, 
      toWater, 
      viewTypeElectric = 'day', 
      viewTypeWater = 'day',
      fromMonthElectric,
      fromYearElectric,
      toMonthElectric,
      toYearElectric,
      fromMonthWater,
      fromYearWater,
      toMonthWater,
      toYearWater
    } = req.query;
    
    const roomSnap = await db.ref("rooms").once("value");
    const roomData = roomSnap.val() || {};
    
    // Lấy danh sách phòng
    const roomList = Object.keys(roomData).sort((a, b) => a.localeCompare(b));

    let waterHistory = {};
    let electricHistory = {};

    // Nếu không có filter ngày, lấy 10 ngày gần nhất
    if (!fromElectric || !toElectric) {
      const last10Days = getLastNDays(10);
      fromElectric = last10Days[0];
      toElectric = last10Days[last10Days.length - 1];
    }

    if (!fromWater || !toWater) {
      const last10Days = getLastNDays(10);
      fromWater = last10Days[0];
      toWater = last10Days[last10Days.length - 1];
    }

    // Parse month/year from YYYY-MM format if provided
    if (fromMonthElectric && fromMonthElectric.includes('-')) {
      const [year, month] = fromMonthElectric.split('-');
      fromYearElectric = parseInt(year);
      fromMonthElectric = parseInt(month);
    }
    if (toMonthElectric && toMonthElectric.includes('-')) {
      const [year, month] = toMonthElectric.split('-');
      toYearElectric = parseInt(year);
      toMonthElectric = parseInt(month);
    }
    if (fromMonthWater && fromMonthWater.includes('-')) {
      const [year, month] = fromMonthWater.split('-');
      fromYearWater = parseInt(year);
      fromMonthWater = parseInt(month);
    }
    if (toMonthWater && toMonthWater.includes('-')) {
      const [year, month] = toMonthWater.split('-');
      toYearWater = parseInt(year);
      toMonthWater = parseInt(month);
    }

    // Set default values for month/year if not provided - use last 9 months
    const currentDate = new Date();
    const currentMonth = currentDate.getMonth() + 1;
    const currentYear = currentDate.getFullYear();

    // Calculate 9 months ago for default range
    const startDate = new Date(currentYear, currentMonth - 9, 1); // 9 months ago
    const defaultFromMonth = startDate.getMonth() + 1;
    const defaultFromYear = startDate.getFullYear();

    console.log(`📅 Default month range: ${defaultFromMonth}/${defaultFromYear} to ${currentMonth}/${currentYear}`);

    fromMonthElectric = fromMonthElectric || defaultFromMonth;
    fromYearElectric = fromYearElectric || defaultFromYear;
    toMonthElectric = toMonthElectric || currentMonth;
    toYearElectric = toYearElectric || currentYear;
    fromMonthWater = fromMonthWater || defaultFromMonth;
    fromYearWater = fromYearWater || defaultFromYear;
    toMonthWater = toMonthWater || currentMonth;
    toYearWater = toYearWater || currentYear;

    // Logic xử lý thống kê theo phòng
    if (roomId && roomData[roomId]) {
      // Thống kê cho một phòng cụ thể
      const room = roomData[roomId];

      // Xử lý dữ liệu từ room history (new structure)
      if (room.history) {
        // Xử lý electric data theo view type
        if (viewTypeElectric === 'month') {
          // Process monthly data from fromMonthElectric to toMonthElectric
          electricHistory = processMonthlyHistoryData(room.history, fromMonthElectric, fromYearElectric, toMonthElectric, toYearElectric, 'electric');
        } else {
          electricHistory = processHistoryData(room.history, fromElectric, toElectric, 'electric');
        }
        
        // Xử lý water data theo view type
        if (viewTypeWater === 'month') {
          // Process monthly data from fromMonthWater to toMonthWater
          waterHistory = processMonthlyHistoryData(room.history, fromMonthWater, fromYearWater, toMonthWater, toYearWater, 'water');
        } else {
          waterHistory = processHistoryData(room.history, fromWater, toWater, 'water');
        }
      }
    } else {
      // Thống kê tổng hợp tất cả phòng
      Object.entries(roomData).forEach(([roomKey, room]) => {
        if (room.history) {
          let roomElectricHistory, roomWaterHistory;
          
          // Xử lý electric data theo view type
          if (viewTypeElectric === 'month') {
            roomElectricHistory = processMonthlyHistoryData(room.history, fromMonthElectric, fromYearElectric, toMonthElectric, toYearElectric, 'electric');
          } else {
            roomElectricHistory = processHistoryData(room.history, fromElectric, toElectric, 'electric');
          }
          
          // Xử lý water data theo view type
          if (viewTypeWater === 'month') {
            roomWaterHistory = processMonthlyHistoryData(room.history, fromMonthWater, fromYearWater, toMonthWater, toYearWater, 'water');
          } else {
            roomWaterHistory = processHistoryData(room.history, fromWater, toWater, 'water');
          }
          
          Object.entries(roomElectricHistory).forEach(([date, value]) => {
            electricHistory[date] = (electricHistory[date] || 0) + value;
          });
          
          Object.entries(roomWaterHistory).forEach(([date, value]) => {
            waterHistory[date] = (waterHistory[date] || 0) + value;
          });
        }
      });
    }

    res.render('statistic', {
      waterHistory,
      electricHistory,
      roomList,
      selectedRoom: roomId,
      currentPage: 'statistic',
      fromElectric,
      toElectric,
      fromWater,
      toWater,
      viewTypeElectric,
      viewTypeWater,
      fromMonthElectric,
      fromYearElectric,
      toMonthElectric,
      toYearElectric,
      fromMonthWater,
      fromYearWater,
      toMonthWater,
      toYearWater
    });
  } catch (error) {
    console.error('Lỗi khi tải thống kê:', error);
    res.render('statistic', {
      waterHistory: {},
      electricHistory: {},
      roomList: [],
      selectedRoom: '',
      currentPage: 'statistic',
      error: 'Lỗi khi tải dữ liệu thống kê',
      fromMonthElectric: new Date().getMonth() + 1,
      fromYearElectric: new Date().getFullYear(),
      toMonthElectric: new Date().getMonth() + 1,
      toYearElectric: new Date().getFullYear(),
      fromMonthWater: new Date().getMonth() + 1,
      fromYearWater: new Date().getFullYear(),
      toMonthWater: new Date().getMonth() + 1,
      toYearWater: new Date().getFullYear(),
      viewTypeElectric: 'day',
      viewTypeWater: 'day'
    });
  }
};

// Get monthly statistics for dashboard
const getMonthlyStatistics = async (req, res) => {
  try {
    const currentDate = new Date();
    const currentMonth = currentDate.getMonth() + 1;
    const currentYear = currentDate.getFullYear();
    
    console.log(`📊 Loading monthly statistics for ${currentMonth}/${currentYear}`);
    
    const roomsSnapshot = await db.ref("rooms").once("value");
    const roomsData = roomsSnapshot.val() || {};
    
    let totalElectricUsage = 0;
    let totalWaterUsage = 0;
    let roomsWithData = 0;
    
    // Tính toán usage cho tất cả phòng
    for (const [roomId, roomInfo] of Object.entries(roomsData)) {
      if (roomInfo.history) {
        const electricUsage = calculateMonthlyUsageByType(roomInfo.history, currentMonth, currentYear, roomId, 'electric');
        const waterUsage = calculateMonthlyUsageByType(roomInfo.history, currentMonth, currentYear, roomId, 'water');
        
        totalElectricUsage += electricUsage;
        totalWaterUsage += waterUsage;
        
        if (electricUsage > 0 || waterUsage > 0) {
          roomsWithData++;
        }
      }
    }
    
    console.log(`📊 Total usage - Electric: ${totalElectricUsage} kWh, Water: ${totalWaterUsage} m³`);
    
    res.json({
      electricity: Math.round(totalElectricUsage * 100) / 100, // 2 decimal places
      water: Math.round(totalWaterUsage * 100) / 100,
      month: currentMonth,
      year: currentYear,
      roomsWithData,
      totalRooms: Object.keys(roomsData).length
    });
    
  } catch (error) {
    console.error("Error getting monthly statistics:", error);
    res.status(500).json({
      success: false,
      error: "Lỗi khi tải thống kê tháng: " + error.message
    });
  }
};

// Get room statistics
const getRoomStatistics = async (req, res) => {
  try {
    const { roomId } = req.params;
    const currentDate = new Date();
    const currentMonth = currentDate.getMonth() + 1;
    const currentYear = currentDate.getFullYear();
    
    const roomSnapshot = await db.ref(`rooms/${roomId}`).once("value");
    const roomData = roomSnapshot.val();
    
    if (!roomData) {
      return res.status(404).json({
        success: false,
        error: `Phòng ${roomId} không tồn tại`
      });
    }
    
    let electricUsage = 0;
    let waterUsage = 0;
    
    if (roomData.history) {
      electricUsage = calculateMonthlyUsageByType(roomData.history, currentMonth, currentYear, roomId, 'electric');
      waterUsage = calculateMonthlyUsageByType(roomData.history, currentMonth, currentYear, roomId, 'water');
    }
    
    // Tính toán chi phí
    const electricRate = 3000; // VND per kWh
    const waterRate = 15000; // VND per m³
    
    const electricCost = electricUsage * electricRate;
    const waterCost = waterUsage * waterRate;
    const totalCost = electricCost + waterCost;
    
    res.json({
      success: true,
      data: {
        roomId,
        month: currentMonth,
        year: currentYear,
        usage: {
          electric: Math.round(electricUsage * 100) / 100,
          water: Math.round(waterUsage * 100) / 100
        },
        cost: {
          electric: electricCost,
          water: waterCost,
          total: totalCost
        },
        rates: {
          electric: electricRate,
          water: waterRate
        }
      }
    });
    
  } catch (error) {
    console.error("Error getting room statistics:", error);
    res.status(500).json({
      success: false,
      error: "Lỗi khi tải thống kê phòng: " + error.message
    });
  }
};

module.exports = {
  getStatistic,
  getMonthlyStatistics,
  getRoomStatistics
}; 