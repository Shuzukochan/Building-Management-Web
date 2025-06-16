const { db, messaging } = require("../config/database");
const { formatPhoneNumber } = require("../services/phoneService");

// Send notification to specific room (updated to use topics - compatible with existing frontend)
const sendNotification = async (req, res) => {
  try {
    let { roomId, title, message, phoneNumber } = req.body;
    
    // Validation
    if (!roomId || !title || !message) {
      return res.status(400).json({
        success: false,
        error: "Thiếu thông tin cần thiết (roomId, title, message)"
      });
    }

    // Kiểm tra phòng tồn tại và lấy thông tin
      const roomSnapshot = await db.ref(`rooms/${roomId}`).once("value");
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

// Send notification to specific room using topic (NEW METHOD)
const sendRoomTopicNotification = async (req, res) => {
  try {
    const { roomId, title, message } = req.body;
    
    // Validation
    if (!roomId || !title || !message) {
      return res.status(400).json({
        success: false,
        error: "Thiếu thông tin cần thiết (roomId, title, message)"
      });
    }

    // Kiểm tra phòng tồn tại
    const roomSnapshot = await db.ref(`rooms/${roomId}`).once("value");
    const roomData = roomSnapshot.val();
    
    if (!roomData) {
      return res.status(404).json({
        success: false,
        error: `Phòng ${roomId} không tồn tại`
      });
    }

    // Topic theo format: room_101, room_102, etc.
    const topic = `room_${roomId}`;

    const messagePayload = {
      notification: {
        title: title,
        body: message
      },
      data: {
        roomId: roomId,
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
        topic,
        phoneNumber: formatPhoneNumber(roomData.phone || "")
      }
    });

  } catch (error) {
    console.error("Error sending room topic notification:", error);
    res.status(500).json({
      success: false,
      error: "Lỗi khi gửi thông báo: " + error.message
    });
  }
};

// Send topic notification
const sendTopicNotification = async (req, res) => {
  try {
    const { topic, title, message } = req.body;
    
    if (!topic || !title || !message) {
      return res.status(400).json({
        success: false,
        error: "Thiếu thông tin cần thiết (topic, title, message)"
      });
    }

    const messagePayload = {
      notification: {
        title: title,
        body: message
      },
      topic: topic
    };

    const result = await messaging.send(messagePayload);
    
    res.json({
      success: true,
      message: `Đã gửi thông báo topic "${topic}" thành công`,
      messageId: result
    });

  } catch (error) {
    console.error("Error sending topic notification:", error);
    res.status(500).json({
      success: false,
      error: "Lỗi khi gửi thông báo topic"
    });
  }
};

// Get user tokens
const getUserTokens = async (req, res) => {
  try {
    const tokensSnapshot = await db.ref("fcm_tokens").once("value");
    const tokensData = tokensSnapshot.val() || {};
    
    const tokens = Object.entries(tokensData).map(([key, data]) => ({
      id: key,
      ...data,
      phoneNumber: formatPhoneNumber(data.phoneNumber || "")
    }));
    
    res.json(tokens);
  } catch (error) {
    console.error("Error fetching user tokens:", error);
    res.status(500).json({ error: "Failed to fetch user tokens" });
  }
};

module.exports = {
  sendNotification,
  sendRoomTopicNotification,
  sendTopicNotification,
  getUserTokens
};