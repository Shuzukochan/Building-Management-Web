const { db } = require("../config/database");
const { formatPhoneNumber } = require("../services/phoneService");

// Helper function to calculate monthly usage for specific data type
function calculateMonthlyUsageByType(historyData, month, year, roomId, dataType) {
  try {
    const monthStr = month.toString().padStart(2, '0');
    const yearStr = year.toString();
    
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
    const daysInCurrentMonth = new Date(year, month, 0).getDate();
    
    for (let day = daysInCurrentMonth; day >= 1; day--) {
      const dayStr = day.toString().padStart(2, '0');
      const dateStr = `${yearStr}-${monthStr}-${dayStr}`;
      if (historyData[dateStr] && historyData[dateStr][dataType] !== undefined) {
        currentMonthLatestValue = historyData[dateStr][dataType] || 0;
        break; // Found the latest date with data
      }
    }
    
    if (currentMonthLatestValue === null) {
      return 0; // No data for current month
    }
    
    // Find latest date (highest date) in previous month
    let prevMonthLatestValue = null;
    const daysInPrevMonth = new Date(prevYear, prevMonth, 0).getDate();
    
    for (let day = daysInPrevMonth; day >= 1; day--) {
      const dayStr = day.toString().padStart(2, '0');
      const dateStr = `${prevYearStr}-${prevMonthStr}-${dayStr}`;
      if (historyData[dateStr] && historyData[dateStr][dataType] !== undefined) {
        prevMonthLatestValue = historyData[dateStr][dataType] || 0;
        break; // Found the latest date with data
      }
    }
    
    let usage = 0;
    
    if (prevMonthLatestValue !== null) {
      // Case 1: Have previous month data - use latest current month - latest previous month
      usage = Math.max(0, currentMonthLatestValue - prevMonthLatestValue);
    } else {
      // Case 2: No previous month data - use latest current month - earliest current month
      let currentMonthEarliestValue = null;
      
      for (let day = 1; day <= daysInCurrentMonth; day++) {
        const dayStr = day.toString().padStart(2, '0');
        const dateStr = `${yearStr}-${monthStr}-${dayStr}`;
        if (historyData[dateStr] && historyData[dateStr][dataType] !== undefined) {
          currentMonthEarliestValue = historyData[dateStr][dataType] || 0;
          break; // Found the earliest date with data
        }
      }
      
      if (currentMonthEarliestValue !== null) {
        usage = Math.max(0, currentMonthLatestValue - currentMonthEarliestValue);
      }
    }
    
    return usage;
    
  } catch (error) {
    console.error(`Error calculating ${dataType} usage for room ${roomId}:`, error);
    return 0;
  }
}

const getDashboard = async (req, res) => {
  let rooms = [];
  let feedbacks = [];
  let monthlyStats = {
    electricity: 0,
    water: 0,
    month: new Date().getMonth() + 1,
    year: new Date().getFullYear()
  };
  const buildings = {
    building_id_1: { name: "Tòa nhà A" },
    building_id_2: { name: "Tòa nhà B" }
  };
  
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
  
  // Initialize variables outside try block
  let currentGatewayId = null;

  try {
    
    // Lấy dữ liệu từ building cụ thể và global phone mapping
    const [roomsSnapshot, feedbackSnapshot, phoneToRoomSnapshot, gatewaySnapshot] = await Promise.all([
      db.ref(`buildings/${targetBuildingId}/rooms`).once("value"),
      db.ref(`buildings/${targetBuildingId}/service_feedbacks`).once("value"),
      db.ref('phone_to_room').once("value"),
      db.ref(`buildings/${targetBuildingId}/gateway_id`).once("value")
    ]);
    
    const roomsData = roomsSnapshot.val();
    const feedbackData = feedbackSnapshot.val();
    const phoneToRoomData = phoneToRoomSnapshot.val() || {};
    currentGatewayId = gatewaySnapshot.val() || null;
    
    // Calculate monthly statistics using same logic as API
    if (roomsData) {
      const currentMonth = monthlyStats.month;
      const currentYear = monthlyStats.year;
      
      let totalElectricity = 0;
      let totalWater = 0;
      
      // Process each room for monthly stats
      for (const [roomId, roomData] of Object.entries(roomsData)) {
        if (roomData.history) {
          // Calculate electricity usage for this room
          const electricUsage = calculateMonthlyUsageByType(roomData.history, currentMonth, currentYear, roomId, 'electric');
          totalElectricity += electricUsage;
          
          // Calculate water usage for this room
          const waterUsage = calculateMonthlyUsageByType(roomData.history, currentMonth, currentYear, roomId, 'water');
          totalWater += waterUsage;
        }
      }
      
      monthlyStats.electricity = totalElectricity;
      monthlyStats.water = totalWater;
    }
    
    if (roomsData) {
      rooms = Object.entries(roomsData).map(([roomId, roomInfo]) => {
        // Tự động xác định tầng từ số phòng
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

        // Determine status từ room hoặc auto-detect từ tenants
        let roomStatus = roomInfo.status || 'vacant';
        if (!roomInfo.status) {
          // Auto-detect: có tenants = occupied, không có = vacant
          roomStatus = roomTenants.length > 0 ? "occupied" : "vacant";
        }

        // Find representative tenant
        const representative = roomTenants.find(t => t.isRepresentative) || roomTenants[0] || null;

        const room = {
          id: roomId,
          roomNumber: roomId,
          phoneNumber: representative ? formatPhoneNumber(representative.phone) : "",
          floor: parseInt(floor),
          status: roomStatus,
          nodes: {},
          // Simplified tenant info
          tenants: roomTenants,
          tenantCount: roomTenants.length,
          representativeTenant: representative,
          // Backward compatibility
          tenant: representative ? { name: representative.name, phone: representative.phone } : null,
          tenantName: representative ? representative.name : null
        };

        // Xử lý nodes với cấu trúc mới - history ở room level
        if (roomInfo.nodes) {
          Object.entries(roomInfo.nodes).forEach(([nodeId, nodeData]) => {
            // Auto-detect type từ multiple sources (PRIORITY ORDER)
            let nodeType = "custom";
            let customName = nodeData.customName || null;
            
            // Method 1: Check nodeId patterns (HIGHEST PRIORITY)
            const nodeIdLower = nodeId.toLowerCase();
            if (nodeIdLower.includes("electric") || nodeIdLower.includes("elec") || 
                nodeIdLower.includes("dien") || nodeIdLower.includes("điện")) {
              nodeType = "electricity";
            } else if (nodeIdLower.includes("water") || nodeIdLower.includes("wat") || 
                       nodeIdLower.includes("nuoc") || nodeIdLower.includes("nước")) {
              nodeType = "water";
            }
            // Method 2: Check lastData properties (SECOND PRIORITY)
            else if (nodeData.lastData) {
              if (nodeData.lastData.hasOwnProperty("electric")) {
                nodeType = "electricity";
              } else if (nodeData.lastData.hasOwnProperty("water")) {
                nodeType = "water";
              }
            }
            // Method 3: Check explicit type from nodeData
            else if (nodeData.type) {
              nodeType = nodeData.type;
            }
            // Method 4: For custom nodes with customName
            else if (nodeData.customName) {
              // Keep as custom but with the name
              nodeType = "custom";
            }

            room.nodes[nodeId] = {
              id: nodeId,
              name: customName || nodeId,
              customName: customName || '',  // Chỉ truyền customName thực sự, không fallback về nodeId
              type: nodeType,
              lastData: nodeData.lastData || {},
              history: roomInfo.history && roomInfo.history[nodeId] ? roomInfo.history[nodeId] : {}
            };
          });
        }

        return room;
      });
    }

    // Process feedback data
    if (feedbackData) {
      feedbacks = Object.entries(feedbackData).map(([timestampKey, feedback]) => {
        return {
          id: timestampKey,
          timestamp: timestampKey,
          phone: feedback.phone || null,
          roomNumber: feedback.roomNumber || null,
          content: feedback.feedback || feedback.content || '',
          isAnonymous: !feedback.phone || feedback.phone === 'anonymous'
        };
      });

      // Sort by timestamp (newest first) and limit to 20
      feedbacks.sort((a, b) => {
        // Parse timestamp format: 2025-06-18_20-59-30
        const parseTimestamp = (timestamp) => {
          const parts = timestamp.split('_');
          if (parts.length === 2) {
            const datePart = parts[0]; // 2025-06-18
            const timePart = parts[1].replace(/-/g, ':'); // 20:59:30
            return new Date(datePart + ' ' + timePart);
          }
          return new Date(timestamp.replace('_', ' ').replace(/-/g, '/'));
        };
        
        const timeA = parseTimestamp(a.timestamp);
        const timeB = parseTimestamp(b.timestamp);
        return timeB - timeA; // Newest first
      });
      feedbacks = feedbacks.slice(0, 20);
    }
  } catch (err) {
    console.error("Lỗi khi tải dashboard:", err);
  }
  
  // Tính toán statistics
  const safeRooms = rooms || [];
  const totalRooms = safeRooms.length;
  const occupiedRooms = safeRooms.filter(r => r.status === "occupied").length;
  const vacantRooms = safeRooms.filter(r => r.status === "vacant").length;
  const maintenanceRooms = safeRooms.filter(r => r.status === "maintenance").length;
  
  res.render("dashboard", {
    rooms: rooms,
    feedbacks: feedbacks,
    monthlyStats: monthlyStats,
    totalRooms,
    occupiedRooms,
    vacantRooms,
    maintenanceRooms,
    currentPage: 'dashboard',
    success: req.query.success || null,
    error: req.query.error || null,
    admin: req.session.admin,
    buildings,
    selectedBuildingId: req.session.selectedBuildingId,
    currentBuildingId: targetBuildingId,
    currentGatewayId: currentGatewayId
  });
};

module.exports = {
  getDashboard
};