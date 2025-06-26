const { db, messaging } = require("../config/database");
const { formatPhoneNumber } = require("../services/phoneService");

// Helper function để xác định building_id
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

// Send notification to specific room (updated to use topics - compatible with existing frontend)
const sendNotification = async (req, res) => {
  try {
    let { roomId, title, message, phoneNumber } = req.body;
    const targetBuildingId = getTargetBuildingId(req);
    
    // Validation
    if (!roomId || !title || !message) {
      return res.status(400).json({
        success: false,
        error: "Thiếu thông tin cần thiết (roomId, title, message)"
      });
    }

    // Kiểm tra phòng tồn tại và lấy thông tin
    const roomSnapshot = await db.ref(`buildings/${targetBuildingId}/rooms/${roomId}`).once("value");
    const roomData = roomSnapshot.val();
    
    if (!roomData) {
      return res.status(404).json({
        success: false,
        error: `Phòng ${roomId} không tồn tại`
      });
    }
    
    // Lấy phoneNumber từ room data nếu không có
    if (!phoneNumber) {
      phoneNumber = formatPhoneNumber(roomData.phone || "");
    }
    const formattedPhone = formatPhoneNumber(phoneNumber);
    
    // Topic theo format: room_101, room_102, etc.
    const topic = `room_${roomId}`;

    const messagePayload = {
      notification: {
        title: title,
        body: message
      },
      data: {
        roomId: roomId,
        phoneNumber: formattedPhone,
        timestamp: Date.now().toString(),
        type: "room_notification"
      },
      topic: topic
    };

    const result = await messaging.send(messagePayload);

    res.json({
      success: true,
      message: `Đã gửi thông báo đến phòng ${roomId} thành công`,
      messageId: result,
      details: {
        roomId,
        phoneNumber: formattedPhone,
        topic: topic,
        tokensFound: 1, // Compatibility với frontend
        successCount: 1,
        failureCount: 0
      }
    });

  } catch (error) {
    console.error("Error sending notification:", error);
    res.status(500).json({
      success: false,
      error: "Lỗi khi gửi thông báo: " + error.message
    });
  }
};

// Send broadcast notification (to all rooms in building)
const sendTopicNotification = async (req, res) => {
  try {
    const { title, message } = req.body;
    const targetBuildingId = getTargetBuildingId(req);
    
    if (!title || !message) {
      return res.status(400).json({
        success: false,
        error: "Thiếu thông tin cần thiết (title, message)"
      });
    }

    // Lấy danh sách phòng để biết số lượng gửi
    const roomSnapshot = await db.ref(`buildings/${targetBuildingId}/rooms`).once("value");
    const roomData = roomSnapshot.val() || {};
    const roomCount = Object.keys(roomData).length;

    // Gửi broadcast notification đến tất cả phòng trong tòa nhà
    const topic = `building_${targetBuildingId}`;

    const messagePayload = {
      notification: {
        title: title,
        body: message
      },
      data: {
        type: "broadcast_notification",
        buildingId: targetBuildingId,
        timestamp: Date.now().toString()
      },
      topic: topic
    };

    const result = await messaging.send(messagePayload);

    res.json({
      success: true,
      message: `Đã gửi thông báo broadcast đến ${roomCount} phòng`,
      messageId: result,
      details: {
        topic: topic,
        buildingId: targetBuildingId,
        roomCount: roomCount
      }
    });

  } catch (error) {
    console.error("Error sending broadcast notification:", error);
    res.status(500).json({
      success: false,
      error: "Lỗi khi gửi thông báo broadcast: " + error.message
    });
  }
};

// Get user tokens (for compatibility)
const getUserTokens = async (req, res) => {
  try {
    const targetBuildingId = getTargetBuildingId(req);
    const roomSnapshot = await db.ref(`buildings/${targetBuildingId}/rooms`).once("value");
    const roomData = roomSnapshot.val() || {};
    
    // Tạo danh sách token giả lập (compatibility)
    const tokens = Object.entries(roomData)
      .filter(([roomId, roomInfo]) => roomInfo.phone && roomInfo.phone.trim())
      .map(([roomId, roomInfo]) => ({
        token: `token_${roomId}`,
        phone: formatPhoneNumber(roomInfo.phone),
        roomId: roomId
      }));

    res.json({
      success: true,
      tokens: tokens,
      count: tokens.length
    });

  } catch (error) {
    console.error("Error getting user tokens:", error);
    res.status(500).json({
      success: false,
      error: "Lỗi khi lấy danh sách token: " + error.message
    });
  }
};

module.exports = {
  sendNotification,
  sendTopicNotification,
  getUserTokens
};