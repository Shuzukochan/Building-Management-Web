const { db } = require("../config/database");
const { formatPhoneNumber } = require("../services/phoneService");

const getDashboard = async (req, res) => {
  let rooms = [];
  
  try {
    const roomsSnapshot = await db.ref("rooms").once("value");
    const roomsData = roomsSnapshot.val();
    
    if (roomsData) {
      rooms = Object.entries(roomsData).map(([roomId, roomInfo]) => {
        // Tự động xác định tầng từ số phòng
        const floor = roomId.charAt(0);
        
        const room = {
          id: roomId,
          roomNumber: roomId,  // roomId chính là số phòng
          phoneNumber: formatPhoneNumber(roomInfo.phone || ""),
          floor: parseInt(floor),
          status: (roomInfo.phone && roomInfo.phone.trim()) ? "occupied" : "vacant",
          nodes: {}
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
              type: nodeType,
              lastData: nodeData.lastData || {},
              history: roomInfo.history && roomInfo.history[nodeId] ? roomInfo.history[nodeId] : {}
            };
          });
        }

        return room;
      });
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
    totalRooms,
    occupiedRooms,
    vacantRooms,
    maintenanceRooms,
    currentPage: 'dashboard',
    success: req.query.success || null,
    error: req.query.error || null
  });
};

module.exports = {
  getDashboard
};