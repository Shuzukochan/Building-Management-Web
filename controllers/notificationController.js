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
    const timestamp = Date.now();
    const notificationId = `notification_${timestamp}`;
    
    // Tạo định dạng thời gian dễ đọc: "HH:mm DD/MM/YYYY"
    const now = new Date();
    const formattedTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')} ${now.getDate().toString().padStart(2, '0')}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getFullYear()}`;

    const messagePayload = {
      notification: {
        title: title,
        body: message
      },
      data: {
        roomId: roomId,
        phoneNumber: formattedPhone,
        timestamp: timestamp.toString(),
        type: "room_notification",
        notificationId: notificationId
      },
      topic: topic
    };

    // 1. Gửi FCM notification
    const result = await messaging.send(messagePayload);

    // 2. Lưu thông báo vào Firebase Database để app Android có thể xem lại
    const notificationData = {
      title: title,
      message: message,
      timestamp: formattedTime,
      isRead: false,
      sentBy: req.session.admin ? req.session.admin.username : 'system'
    };

    // Lưu vào path: buildings/{buildingId}/rooms/{roomId}/notifications/{notificationId}
    await db.ref(`buildings/${targetBuildingId}/rooms/${roomId}/notifications/${notificationId}`).set(notificationData);

    console.log(`✅ Notification sent and saved: Room ${roomId}, FCM result: ${result}`);

    res.json({
      success: true,
      message: `Đã gửi thông báo đến phòng ${roomId} thành công`,
      messageId: result,
      notificationId: notificationId,
      details: {
        roomId,
        phoneNumber: formattedPhone,
        topic: topic,
        tokensFound: 1, // Compatibility với frontend
        successCount: 1,
        failureCount: 0,
        savedToDatabase: true
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
    const { title, message, target = 'all_residents' } = req.body;
    const targetBuildingId = getTargetBuildingId(req);
    
    if (!title || !message) {
      return res.status(400).json({
        success: false,
        error: "Thiếu thông tin cần thiết (title, message)"
      });
    }

    let topic;
    let targetDescription;

    // Xác định topic dựa trên target
    if (target === 'all_residents') {
      // Gửi tới toàn bộ tòa nhà với building ID hiện tại
      topic = targetBuildingId; // Chỉ dùng building_id_1, building_id_2, etc.
      targetDescription = 'toàn tòa nhà';
    } else if (target.startsWith('floor_')) {
      // Gửi tới tầng cụ thể của tòa nhà hiện tại
      const floorNumber = target.replace('floor_', '');
      topic = `${targetBuildingId}_floor_${floorNumber}`;
      targetDescription = `tầng ${floorNumber}`;
    } else {
      // Fallback - gửi tới toàn tòa nhà
      topic = targetBuildingId; // Chỉ dùng building_id_1, building_id_2, etc.
      targetDescription = 'toàn tòa nhà';
    }

    // Lấy danh sách phòng để biết số lượng gửi và lưu thông báo cho từng phòng
    const roomSnapshot = await db.ref(`buildings/${targetBuildingId}/rooms`).once("value");
    const roomData = roomSnapshot.val() || {};
    const roomCount = Object.keys(roomData).length;

    const timestamp = Date.now();
    const notificationId = `broadcast_${timestamp}`;
    
    // Tạo định dạng thời gian dễ đọc: "HH:mm DD/MM/YYYY"
    const now = new Date();
    const formattedTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')} ${now.getDate().toString().padStart(2, '0')}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getFullYear()}`;

    const messagePayload = {
      notification: {
        title: title,
        body: message
      },
      data: {
        type: "broadcast_notification",
        buildingId: targetBuildingId,
        target: target,
        timestamp: timestamp.toString(),
        notificationId: notificationId
      },
      topic: topic
    };

    // 1. Gửi FCM broadcast notification
    const result = await messaging.send(messagePayload);

    // 2. Lưu thông báo vào từng phòng trong tòa nhà để app Android có thể xem lại
    const notificationData = {
      title: title,
      message: message,
      timestamp: formattedTime,
      target: target,
      targetDescription: targetDescription,
      isRead: false,
      sentBy: req.session.admin ? req.session.admin.username : 'system'
    };

    // Batch update để lưu notification vào tất cả phòng phù hợp
    const updates = {};
    
    Object.keys(roomData).forEach(roomId => {
      // Kiểm tra xem phòng có thuộc target không
      let shouldReceive = false;
      
      if (target === 'all_residents') {
        shouldReceive = true;
      } else if (target.startsWith('floor_')) {
        const floorNumber = target.replace('floor_', '');
        const roomFloor = roomId.charAt(0); // Lấy ký tự đầu tiên làm tầng
        shouldReceive = (roomFloor === floorNumber);
      }
      
      if (shouldReceive) {
        updates[`buildings/${targetBuildingId}/rooms/${roomId}/notifications/${notificationId}`] = notificationData;
      }
    });

    // Thực hiện batch update
    if (Object.keys(updates).length > 0) {
      await db.ref().update(updates);
      console.log(`✅ Broadcast notification sent and saved to ${Object.keys(updates).length} rooms`);
    }

    res.json({
      success: true,
      message: `Đã gửi thông báo broadcast đến ${targetDescription}`,
      messageId: result,
      notificationId: notificationId,
      details: {
        topic: topic,
        buildingId: targetBuildingId,
        target: target,
        roomCount: roomCount,
        savedToRooms: Object.keys(updates).length
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