const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const admin = require('firebase-admin');
const path = require('path');

require('dotenv').config();

const app = express();
const PORT = 3000;

const serviceAccount = require('./firebase-admin.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.DATABASE_URL
});

const db = admin.database();
const messaging = admin.messaging();

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(session({
  secret: 'secret-key',
  resave: false,
  saveUninitialized: true
}));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Serve static files
app.use('/public', express.static(path.join(__dirname, 'public')));

const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'admin';

// Format số điện thoại từ +84 về 0
function formatPhoneNumber(phone) {
  if (!phone) return '';
  // Chuyển +84 thành 0
  if (phone.startsWith('+84')) {
    return '0' + phone.substring(3);
  }
  // Chuyển 84 thành 0 (trường hợp không có dấu +)
  if (phone.startsWith('84') && phone.length >= 10) {
    return '0' + phone.substring(2);
  }
  return phone;
}

// Middleware kiểm tra đăng nhập
function requireAuth(req, res, next) {
  if (!req.session.loggedIn) {
    // Check if this is an API request
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({
        success: false,
        error: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'
      });
    }
    return res.redirect('/');
  }
  next();
}

// API Routes for Feedback (MUST be before requireAuth middleware)
// GET /api/feedback - Lấy danh sách feedback
app.get('/api/feedback', async (req, res) => {
  try {
    const feedbackRef = db.ref('service_feedbacks');
    const snapshot = await feedbackRef.once('value');
    const feedbackData = snapshot.val() || {};
    
    // Chuyển đổi thành array và sắp xếp theo timestamp (mới nhất trước)
    const feedbackArray = Object.entries(feedbackData).map(([timestampKey, data]) => ({
      id: timestampKey,
      timestamp: timestampKey, // Use Firebase key as display timestamp (YYYY-MM-DD-HH-MM-SS)
      content: data.feedback || data.content || '',
      phone: data.phone || null,
      roomNumber: data.roomNumber || null, // Keep for compatibility
      // Determine if anonymous based on phone field
      isAnonymous: !data.phone || data.phone === 'anonymous'
    })).sort((a, b) => {
      // Sort by timestamp key (newest first)
      return b.timestamp.localeCompare(a.timestamp);
    });
    
    // Chỉ lấy 20 feedback gần nhất
    const recentFeedback = feedbackArray.slice(0, 20);
    
    res.json({
      success: true,
      data: recentFeedback
    });
  } catch (error) {
    console.error('Error loading feedback:', error);
    res.status(500).json({
      success: false,
      error: 'Lỗi khi tải góp ý'
    });
  }
});

// POST /api/feedback - Thêm feedback mới
app.post('/api/feedback', async (req, res) => {
  try {
    const { content, phone, roomNumber } = req.body;
    
    if (!content || content.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'Nội dung góp ý không được để trống'
      });
    }
    
    const now = new Date();
    const timestamp = now.getFullYear() + '-' +
      (now.getMonth() + 1).toString().padStart(2, '0') + '-' +
      now.getDate().toString().padStart(2, '0') + '-' +
      now.getHours().toString().padStart(2, '0') + '-' +
      now.getMinutes().toString().padStart(2, '0') + '-' +
      now.getSeconds().toString().padStart(2, '0');
    
    const feedbackData = {
      feedback: content.trim(),
      phone: phone && phone.trim() ? phone.trim() : 'anonymous',
      roomNumber: roomNumber && roomNumber.trim() ? roomNumber.trim() : 'anonymous'
    };
    
    await db.ref(`service_feedbacks/${timestamp}`).set(feedbackData);
    
    res.json({
      success: true,
      message: 'Gửi góp ý thành công'
    });
  } catch (error) {
    console.error('Error adding feedback:', error);
    res.status(500).json({
      success: false,
      error: 'Lỗi khi gửi góp ý'
    });
  }
});



// GET /api/firebase-config - Lấy cấu hình Firebase để client kết nối realtime
app.get('/api/firebase-config', (req, res) => {
  try {
    const config = {
      databaseURL: process.env.DATABASE_URL,
      apiKey: process.env.FIREBASE_API_KEY || 'demo-api-key',
      appId: process.env.FIREBASE_APP_ID || 'demo-app-id',
      projectId: 'building-management-firebase', // Add project ID
      messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || 'demo-sender-id'
    };
    
    res.json(config); // Return config directly, not wrapped in success object
  } catch (error) {
    console.error('Error getting Firebase config:', error);
    res.status(500).json({
      success: false,
      error: 'Lỗi khi lấy cấu hình Firebase'
    });
  }
});

// ==================== FCM NOTIFICATION API ====================

// POST /api/send-notification - Gửi thông báo FCM
app.post('/api/send-notification', requireAuth, async (req, res) => {
  try {
    const { roomId, title, message, phoneNumber } = req.body;
    
    // Validation
    if (!roomId || !title || !message || !phoneNumber) {
      return res.status(400).json({
        success: false,
        error: 'Thiếu thông tin cần thiết (roomId, title, message, phoneNumber)'
      });
    }

    console.log('🔔 Sending FCM notification request:', { roomId, title, message, phoneNumber });

    // Lấy FCM token từ cấu trúc rooms/{roomId}/FCM/token
    const fcmTokenRef = db.ref(`rooms/${roomId}/FCM/token`);
    const tokenSnapshot = await fcmTokenRef.once('value');
    const fcmToken = tokenSnapshot.val();
    
    if (!fcmToken) {
      console.log('❌ No FCM token found for room:', roomId);
      return res.status(404).json({
        success: false,
        error: `Phòng ${roomId} chưa đăng ký nhận thông báo hoặc chưa cài đặt app`
      });
    }

    console.log('🔍 Found FCM token for room:', roomId);

    // Tạo FCM message payload
    const fcmMessage = {
      token: fcmToken,
      notification: {
        title: title,
        body: message,
      },
      data: {
        roomId: roomId,
        type: 'room_notification',
        timestamp: new Date().toISOString(),
        phoneNumber: phoneNumber
      },
      android: {
        notification: {
          icon: 'ic_notification',
          color: '#3b82f6',
          sound: 'default',
          clickAction: 'FLUTTER_NOTIFICATION_CLICK'
        },
        priority: 'high'
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1
          }
        }
      }
    };

    // Gửi thông báo qua FCM
    const response = await messaging.send(fcmMessage);
    console.log('✅ FCM notification sent successfully:', response);

    // Log thông báo vào database để tracking
    const notificationLog = {
      roomId,
      phoneNumber,
      title,
      message,
      fcmResponse: response,
      timestamp: new Date().toISOString(),
      status: 'sent'
    };
    
    await db.ref(`notification_logs/${Date.now()}`).set(notificationLog);

    res.json({
      success: true,
      message: 'Gửi thông báo thành công',
      messageId: response
    });

  } catch (error) {
    console.error('❌ Error sending FCM notification:', error);
    
    // Log error vào database
    const errorLog = {
      roomId: req.body.roomId,
      phoneNumber: req.body.phoneNumber,
      title: req.body.title,
      message: req.body.message,
      error: error.message,
      timestamp: new Date().toISOString(),
      status: 'failed'
    };
    
    try {
      await db.ref(`notification_logs/${Date.now()}`).set(errorLog);
    } catch (logError) {
      console.error('Error logging notification error:', logError);
    }

    // Return specific error messages
    if (error.code === 'messaging/registration-token-not-registered') {
      return res.status(410).json({
        success: false,
        error: 'Token đã hết hạn. Người dùng cần mở lại app để cập nhật.'
      });
    } else if (error.code === 'messaging/invalid-registration-token') {
      return res.status(400).json({
        success: false,
        error: 'Token không hợp lệ'
      });
    } else {
      return res.status(500).json({
        success: false,
        error: 'Lỗi khi gửi thông báo: ' + error.message
      });
    }
  }
});



// POST /api/test-fcm - Test FCM với token thật (for development)
app.post('/api/test-fcm', requireAuth, async (req, res) => {
  try {
    const { fcmToken, title, message } = req.body;
    
    if (!fcmToken || !title || !message) {
      return res.status(400).json({
        success: false,
        error: 'Thiếu fcmToken, title hoặc message'
      });
    }

    console.log('🧪 Testing FCM with direct token:', fcmToken);

    // Tạo FCM message payload
    const fcmMessage = {
      token: fcmToken,
      notification: {
        title: title,
        body: message,
      },
      data: {
        type: 'test_notification',
        timestamp: new Date().toISOString()
      },
      android: {
        notification: {
          icon: 'ic_notification',
          color: '#3b82f6',
          sound: 'default'
        },
        priority: 'high'
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1
          }
        }
      }
    };

    // Gửi thông báo qua FCM
    const response = await messaging.send(fcmMessage);
    console.log('✅ Test FCM notification sent successfully:', response);

    res.json({
      success: true,
      message: 'Test FCM thành công',
      messageId: response
    });

  } catch (error) {
    console.error('❌ Error testing FCM:', error);
    res.status(500).json({
      success: false,
      error: 'Lỗi khi test FCM: ' + error.message
    });
  }
});

// GET /api/user-tokens - Xem danh sách FCM tokens (for debugging)
app.get('/api/user-tokens', requireAuth, async (req, res) => {
  try {
    const roomsSnapshot = await db.ref('rooms').once('value');
    const roomsData = roomsSnapshot.val() || {};
    
    // Extract FCM tokens from rooms structure
    const sanitizedTokens = {};
    Object.entries(roomsData).forEach(([roomId, roomData]) => {
      if (roomData.FCM && roomData.FCM.token) {
        sanitizedTokens[roomId] = {
          roomId: roomId,
          phoneNumber: roomData.phone || roomData.FCM.phoneNumber || null,
          hasToken: !!roomData.FCM.token,
          tokenLength: roomData.FCM.token ? roomData.FCM.token.length : 0,
          deviceInfo: roomData.FCM.deviceInfo || {},
          lastUpdated: roomData.FCM.lastUpdated || null,
          status: roomData.FCM.status || 'unknown'
        };
      }
    });

    res.json({
      success: true,
      tokens: sanitizedTokens,
      totalTokens: Object.keys(sanitizedTokens).length
    });

  } catch (error) {
    console.error('❌ Error getting user tokens:', error);
    res.status(500).json({
      success: false,
      error: 'Lỗi khi lấy danh sách tokens: ' + error.message
    });
  }
});

// POST /api/test-room-notification - Test gửi thông báo cho room cụ thể
app.post('/api/test-room-notification', requireAuth, async (req, res) => {
  try {
    const { roomId, title, message } = req.body;
    
    if (!roomId || !title || !message) {
      return res.status(400).json({
        success: false,
        error: 'Thiếu roomId, title hoặc message'
      });
    }

    console.log('🧪 Testing room notification for:', roomId);

    // Lấy thông tin phòng để có phoneNumber
    const roomSnapshot = await db.ref(`rooms/${roomId}`).once('value');
    const roomData = roomSnapshot.val();
    
    if (!roomData) {
      return res.status(404).json({
        success: false,
        error: `Phòng ${roomId} không tồn tại`
      });
    }

    // Gọi API send-notification với thông tin phòng
    const notificationData = {
      roomId: roomId,
      phoneNumber: roomData.phone || 'test-phone',
      title: title,
      message: message
    };

    // Gọi internal API
    const response = await fetch(`http://localhost:${PORT}/api/send-notification`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': req.headers.cookie // Forward session cookie
      },
      body: JSON.stringify(notificationData)
    });

    const result = await response.json();

    if (result.success) {
      res.json({
        success: true,
        message: `Test notification sent to room ${roomId}`,
        messageId: result.messageId
      });
    } else {
      res.status(response.status).json(result);
    }

  } catch (error) {
    console.error('❌ Error testing room notification:', error);
    res.status(500).json({
      success: false,
      error: 'Lỗi khi test room notification: ' + error.message
    });
  }
});

// POST /api/send-topic-notification - Gửi thông báo FCM theo topic
app.post('/api/send-topic-notification', requireAuth, async (req, res) => {
  try {
    const { topic, title, message } = req.body;
    
    // Validation
    if (!topic || !title || !message) {
      return res.status(400).json({
        success: false,
        error: 'Thiếu thông tin cần thiết (topic, title, message)'
      });
    }

    console.log('📢 Sending FCM topic notification:', { topic, title, message });

    // Tạo FCM topic message payload
    const fcmMessage = {
      topic: topic,
      notification: {
        title: title,
        body: message,
      },
      data: {
        type: 'topic_notification',
        topic: topic,
        timestamp: new Date().toISOString()
      },
      android: {
        notification: {
          icon: 'ic_notification',
          color: '#3b82f6',
          sound: 'default',
          clickAction: 'FLUTTER_NOTIFICATION_CLICK'
        },
        priority: 'high'
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1
          }
        }
      }
    };

    // Gửi thông báo qua FCM
    const response = await messaging.send(fcmMessage);
    console.log('✅ FCM topic notification sent successfully:', response);

    // Log thông báo vào database để tracking
    const notificationLog = {
      topic,
      title,
      message,
      fcmResponse: response,
      timestamp: new Date().toISOString(),
      status: 'sent',
      type: 'topic_broadcast'
    };
    
    await db.ref(`notification_logs/${Date.now()}`).set(notificationLog);

    res.json({
      success: true,
      message: 'Gửi thông báo topic thành công',
      messageId: response,
      topic: topic
    });

  } catch (error) {
    console.error('❌ Error sending FCM topic notification:', error);
    
    // Log error vào database
    const errorLog = {
      topic: req.body.topic,
      title: req.body.title,
      message: req.body.message,
      error: error.message,
      timestamp: new Date().toISOString(),
      status: 'failed',
      type: 'topic_broadcast'
    };
    
    try {
      await db.ref(`notification_logs/${Date.now()}`).set(errorLog);
    } catch (logError) {
      console.error('Error logging notification error:', logError);
    }

    // Return specific error messages
    if (error.code === 'messaging/invalid-argument') {
      return res.status(400).json({
        success: false,
        error: 'Topic không hợp lệ'
      });
    } else {
      return res.status(500).json({
        success: false,
        error: 'Lỗi khi gửi thông báo topic: ' + error.message
      });
    }
  }
});



// Routes chính
app.get('/', (req, res) => {
  if (req.session.loggedIn) {
    res.redirect('/dashboard');
  } else {
    res.render('login');
  }
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    req.session.loggedIn = true;
    res.redirect('/dashboard');
  } else {
    res.render('login', { error: 'Sai tài khoản hoặc mật khẩu' });
  }
});


app.get('/dashboard', requireAuth, async (req, res) => {
  let rooms = [];
  
  try {
    const roomsSnapshot = await db.ref('rooms').once('value');
    const roomsData = roomsSnapshot.val();
    
    if (roomsData) {
      rooms = Object.entries(roomsData).map(([roomId, roomInfo]) => {
        // Tự động xác định tầng từ số phòng
        const floor = roomId.charAt(0);
        
        const room = {
          id: roomId,
          roomNumber: roomId,  // roomId chính là số phòng
          phoneNumber: formatPhoneNumber(roomInfo.phone || ''),
          floor: parseInt(floor),
          status: (roomInfo.phone && roomInfo.phone.trim()) ? 'occupied' : 'vacant',
          nodes: {}
        };

        // Xử lý nodes với cấu trúc mới - history ở room level
        if (roomInfo.nodes) {
          Object.entries(roomInfo.nodes).forEach(([nodeId, nodeData]) => {
            // Auto-detect type từ multiple sources (PRIORITY ORDER)
            let nodeType = 'custom';
            let customName = nodeData.customName || null;
            
            // Method 1: Check nodeId patterns (HIGHEST PRIORITY)
            const nodeIdLower = nodeId.toLowerCase();
            if (nodeIdLower.includes('electric') || nodeIdLower.includes('elec') || 
                nodeIdLower.includes('dien') || nodeIdLower.includes('điện')) {
              nodeType = 'electricity';
            } else if (nodeIdLower.includes('water') || nodeIdLower.includes('wat') || 
                       nodeIdLower.includes('nuoc') || nodeIdLower.includes('nước')) {
              nodeType = 'water';
            }
            // Method 2: Check lastData properties (SECOND PRIORITY)
            else if (nodeData.lastData) {
              if (nodeData.lastData.hasOwnProperty('electric')) {
                nodeType = 'electricity';
              } else if (nodeData.lastData.hasOwnProperty('water')) {
                nodeType = 'water';
              }
            }
            // Method 3: Check explicit type from nodeData
            else if (nodeData.type) {
              nodeType = nodeData.type;
            }
            // Method 4: For custom nodes with customName
            else if (nodeData.customName) {
              nodeType = 'custom';
              customName = nodeData.customName;
            }
            // Method 5: Fallback - if we have history data, try to guess based on most common data
            else if (roomInfo.history && nodeType === 'custom') {
              // Check recent history entries to see what data types are most common
              const recentDates = Object.keys(roomInfo.history).sort().slice(-10);
              let electricCount = 0;
              let waterCount = 0;
              
              recentDates.forEach(date => {
                if (roomInfo.history[date]) {
                  if (roomInfo.history[date].electric !== undefined) electricCount++;
                  if (roomInfo.history[date].water !== undefined) waterCount++;
                }
              });
              
              // Only auto-assign if we have clear dominance and this is the first/primary node
              const nodeIndex = Object.keys(roomInfo.nodes).indexOf(nodeId);
              if (electricCount > waterCount && electricCount > 5 && nodeIndex === 0) {
                nodeType = 'electricity';
              } else if (waterCount > electricCount && waterCount > 5 && nodeIndex === 1) {
                nodeType = 'water';
              }
              // Otherwise keep as custom to be safe
            }
            
            // Tạo display name cho node
            let displayName = '';
            let icon = '';
            let unit = '';
            let value = 0;
            
            switch (nodeType) {
              case 'electricity':
                displayName = 'Điện';
                icon = 'fas fa-bolt';
                unit = 'kWh';
                // Get latest electric reading from room history
                if (roomInfo.history) {
                  const latestDate = Object.keys(roomInfo.history).sort().pop();
                  value = roomInfo.history[latestDate]?.electric || 0;
                }
                break;
              case 'water':
                displayName = 'Nước';
                icon = 'fas fa-tint';
                unit = 'm³';
                // Get latest water reading from room history
                if (roomInfo.history) {
                  const latestDate = Object.keys(roomInfo.history).sort().pop();
                  value = roomInfo.history[latestDate]?.water || 0;
                }
                break;
              case 'custom':
                displayName = customName || 'Custom';
                icon = 'fas fa-cog';
                unit = '';
                value = 0;
                break;
              default:
                displayName = 'Unknown';
                icon = 'fas fa-question';
                unit = '';
                value = 0;
            }
            
            // Thêm vào room.nodes với key là nodeId để tránh conflict
            room.nodes[nodeId] = {
              nodeId: nodeId,
              type: nodeType,
              customName: customName,
              displayName: displayName,
              icon: icon,
              lastReading: value,
              unit: unit
            };
          });
        }

        return room;
      });
      
      // Sort theo số phòng
      rooms.sort((a, b) => a.roomNumber.localeCompare(b.roomNumber));
    }
  } catch (err) {
    console.error('Lỗi khi tải dashboard:', err);
  }
  
  // Tính toán statistics
  const safeRooms = rooms || [];
  const totalRooms = safeRooms.length;
  const occupiedRooms = safeRooms.filter(r => r.status === 'occupied').length;
  const vacantRooms = safeRooms.filter(r => r.status === 'vacant').length;
  const maintenanceRooms = safeRooms.filter(r => r.status === 'maintenance').length;
  
  res.render('dashboard', { 
    rooms: rooms,
    totalRooms,
    occupiedRooms,
    vacantRooms,
    maintenanceRooms,
    success: req.query.success || null,
    error: req.query.error || null
  });
});


// API lấy danh sách phòng trống
app.get('/api/available-rooms', requireAuth, async (req, res) => {
  try {
    const roomsSnapshot = await db.ref('rooms').once('value');
    const roomsData = roomsSnapshot.val() || {};
    
    const availableRooms = Object.entries(roomsData)
      .filter(([roomId, roomInfo]) => !roomInfo.phone || !roomInfo.phone.trim()) // Phòng trống = không có phone
      .map(([roomId, roomInfo]) => {
        const floor = roomId.charAt(0);
        return {
          id: roomId,
          roomNumber: roomId,
          floor: parseInt(floor),
          status: 'vacant'
        };
      })
      .sort((a, b) => a.roomNumber.localeCompare(b.roomNumber));

    res.json(availableRooms);
  } catch (error) {
    console.error('Lỗi khi lấy danh sách phòng trống:', error);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// Assign tenant vào phòng trống
app.post('/assign-tenant', requireAuth, async (req, res) => {
  try {
    const { roomId, phoneNumber, electricityNode, waterNode } = req.body;

    if (!roomId || !phoneNumber) {
      return res.redirect('/dashboard?error=Thiếu thông tin phòng hoặc số điện thoại');
    }

    // Kiểm tra phòng tồn tại và đang trống
    const roomSnapshot = await db.ref(`rooms/${roomId}`).once('value');
    if (!roomSnapshot.exists()) {
      return res.redirect('/dashboard?error=Phòng không tồn tại');
    }

    const roomData = roomSnapshot.val();
    // Kiểm tra phòng trống: không có phone hoặc phone rỗng
    if (roomData.phone && roomData.phone.trim()) {
      return res.redirect('/dashboard?error=Phòng không còn trống');
    }

    // Kiểm tra số điện thoại chưa được gán phòng khác
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

    res.redirect('/dashboard?success=Đã cho thuê phòng thành công');
  } catch (error) {
    console.error('Lỗi khi assign tenant:', error);
    res.redirect('/dashboard?error=Lỗi khi assign tenant: ' + error.message);
  }
});

// API lấy danh sách số điện thoại
app.get('/api/phone-numbers', requireAuth, async (req, res) => {
  try {
    // Lấy danh sách users từ Firebase Auth
    const usersResult = await admin.auth().listUsers(1000);
    
    // Lấy danh sách số điện thoại đã được gán phòng
    const roomsSnapshot = await db.ref('rooms').once('value');
    const roomsData = roomsSnapshot.val() || {};
    const assignedPhones = new Set();
    
    Object.values(roomsData).forEach(room => {
      if (room.phone && room.phone.trim()) {
        assignedPhones.add(room.phone);
      }
    });

    const phoneNumbers = usersResult.users
      .filter(user => user.phoneNumber)
      .map(user => ({
        phoneNumber: user.phoneNumber,
        tenantName: user.displayName || 'Chưa có tên',
        email: user.email || '',
        hasRoom: assignedPhones.has(user.phoneNumber),
        userId: user.uid
      }))
      .sort((a, b) => {
        // Số chưa có phòng lên đầu
        if (a.hasRoom && !b.hasRoom) return 1;
        if (!a.hasRoom && b.hasRoom) return -1;
        return a.phoneNumber.localeCompare(b.phoneNumber);
      });

    res.json(phoneNumbers);
  } catch (error) {
    console.error('Lỗi khi lấy danh sách số điện thoại:', error);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// API lấy thông tin phòng cụ thể
app.get('/api/room/:roomId', requireAuth, async (req, res) => {
  try {
    const { roomId } = req.params;
    const roomSnapshot = await db.ref(`rooms/${roomId}`).once('value');
    
    if (!roomSnapshot.exists()) {
      return res.status(404).json({ error: 'Không tìm thấy phòng' });
    }

    const roomData = roomSnapshot.val();
    res.json({
      id: roomId,
      roomNumber: roomData.roomNumber || roomId,
      phoneNumber: roomData.phoneNumber || roomData.phone || '',
      floor: roomData.floor || 1,
      status: roomData.status || 'vacant',
      tenant: roomData.tenant || {}
    });
  } catch (error) {
    console.error('Lỗi khi lấy thông tin phòng:', error);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// Thêm phòng mới
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

// Thêm node vào phòng (cập nhật)
app.post('/add-node', requireAuth, async (req, res) => {
  try {
    const { roomId, nodeId, nodeType, customNodeType } = req.body;

    if (!roomId || !nodeId || !nodeType) {
      return res.redirect('/dashboard?error=Thiếu thông tin cần thiết');
    }

    // Kiểm tra phòng tồn tại
    const roomSnapshot = await db.ref(`rooms/${roomId}`).once('value');
    if (!roomSnapshot.exists()) {
      return res.redirect('/dashboard?error=Phòng không tồn tại');
    }

    // Kiểm tra node đã tồn tại
    const existingNodeSnapshot = await db.ref(`rooms/${roomId}/nodes/${nodeId}`).once('value');
    if (existingNodeSnapshot.exists()) {
      return res.redirect('/dashboard?error=Node đã tồn tại');
    }

    // Xử lý node type
    let finalNodeType = nodeType;
    let customName = null;
    
    if (nodeType === 'custom') {
      if (!customNodeType || !customNodeType.trim()) {
        return res.redirect('/dashboard?error=Vui lòng nhập tên loại node tùy chỉnh');
      }
      customName = customNodeType.trim();
    }

    const nodeData = {
      customName: customName,
      lastData: getDefaultLastData(finalNodeType),
      history: {}
    };

    await db.ref(`rooms/${roomId}/nodes/${nodeId}`).set(nodeData);
    res.redirect('/dashboard?success=Thêm node thành công');
  } catch (error) {
    console.error('Lỗi khi thêm node:', error);
    res.redirect('/dashboard?error=Lỗi khi thêm node: ' + error.message);
  }
});

// Cập nhật thông tin phòng
app.post('/update-room', requireAuth, async (req, res) => {
  try {
    const { roomId, roomNumber, phoneNumber, floor } = req.body;

    // Validate format số phòng (101-999)
    if (!/^[1-9]\d{2}$/.test(roomNumber)) {
      return res.redirect('/dashboard?error=Số phòng phải từ 101-999 (tầng 1-9).');
    }

    // Validate floor range (any floor 1-9 is valid)
    const firstDigit = roomNumber.charAt(0);
    const calculatedFloor = parseInt(firstDigit);
    const roomNum = parseInt(roomNumber);
    
    // Check if room number is valid for its floor
    const expectedMin = calculatedFloor * 100 + 1;  // 101, 201, 301, etc.
    const expectedMax = calculatedFloor * 100 + 99; // 199, 299, 399, etc.
    
    if (roomNum < expectedMin || roomNum > expectedMax) {
      return res.redirect(`/dashboard?error=Phòng tầng ${calculatedFloor} phải từ ${expectedMin}-${expectedMax}.`);
    }

    // Kiểm tra consistency giữa số phòng và tầng được chọn
    if (floor !== calculatedFloor.toString()) {
      return res.redirect(`/dashboard?error=Số phòng ${roomNumber} phải ở tầng ${calculatedFloor}, không phải tầng ${floor}`);
    }

    // Lấy thông tin phòng hiện tại để kiểm tra trạng thái
    const currentRoomSnapshot = await db.ref(`rooms/${roomId}`).once('value');
    const currentRoom = currentRoomSnapshot.val();
    
    // Tự động điều chỉnh trạng thái dựa trên số điện thoại
    let newStatus;
    if (phoneNumber && phoneNumber.trim()) {
      // Có SĐT: nếu đang bảo trì thì giữ nguyên, không thì set occupied
      newStatus = currentRoom.status === 'maintenance' ? 'maintenance' : 'occupied';
    } else {
      // Không có SĐT: nếu đang bảo trì thì giữ nguyên, không thì set vacant
      newStatus = currentRoom.status === 'maintenance' ? 'maintenance' : 'vacant';
    }

    const updateData = {
      roomNumber: roomNumber,
      phoneNumber: phoneNumber || '',
      floor: calculatedFloor, // Sử dụng tầng tự động từ số phòng
      status: newStatus
    };

    await db.ref(`rooms/${roomId}`).update(updateData);
    res.redirect('/dashboard?success=Cập nhật phòng thành công');
  } catch (error) {
    console.error('Lỗi khi cập nhật phòng:', error);
    res.redirect('/dashboard?error=Lỗi khi cập nhật phòng: ' + error.message);
  }
});

// Cập nhật trạng thái phòng
app.post('/update-room-status', requireAuth, async (req, res) => {
  try {
    const { roomId, status } = req.body;

    await db.ref(`rooms/${roomId}`).update({
      status: status
    });

    res.redirect('/dashboard?success=Cập nhật trạng thái thành công');
  } catch (error) {
    console.error('Lỗi khi cập nhật trạng thái:', error);
    res.redirect('/dashboard?error=Lỗi khi cập nhật trạng thái: ' + error.message);
  }
});

// Xóa phòng
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

// Xóa node
app.post('/delete-node', requireAuth, async (req, res) => {
  try {
    const { roomId, nodeId } = req.body;

    if (!roomId || !nodeId) {
      return res.redirect('/dashboard?error=Thiếu thông tin cần thiết');
    }

    // Kiểm tra node tồn tại
    const nodeSnapshot = await db.ref(`rooms/${roomId}/nodes/${nodeId}`).once('value');
    if (!nodeSnapshot.exists()) {
      return res.redirect('/dashboard?error=Node không tồn tại');
    }

    await db.ref(`rooms/${roomId}/nodes/${nodeId}`).remove();
    res.redirect('/dashboard?success=Xóa node thành công');
  } catch (error) {
    console.error('Lỗi khi xóa node:', error);
    res.redirect('/dashboard?error=Lỗi khi xóa node: ' + error.message);
  }
});

// Cập nhật node
app.post('/update-node', requireAuth, async (req, res) => {
  try {
    const { roomId, oldNodeId, newNodeId, customName } = req.body;

    if (!roomId || !oldNodeId || !newNodeId) {
      return res.redirect('/dashboard?error=Thiếu thông tin cần thiết');
    }

    // Kiểm tra phòng tồn tại
    const roomSnapshot = await db.ref(`rooms/${roomId}`).once('value');
    if (!roomSnapshot.exists()) {
      return res.redirect('/dashboard?error=Phòng không tồn tại');
    }

    // Kiểm tra node cũ tồn tại
    const oldNodeSnapshot = await db.ref(`rooms/${roomId}/nodes/${oldNodeId}`).once('value');
    if (!oldNodeSnapshot.exists()) {
      return res.redirect('/dashboard?error=Node không tồn tại');
    }

    const oldNodeData = oldNodeSnapshot.val();

    // Nếu nodeId thay đổi, kiểm tra nodeId mới không trùng
    if (oldNodeId !== newNodeId) {
      const newNodeSnapshot = await db.ref(`rooms/${roomId}/nodes/${newNodeId}`).once('value');
      if (newNodeSnapshot.exists()) {
        return res.redirect('/dashboard?error=Node ID mới đã tồn tại trong phòng');
      }
    }

    // Prepare updated node data
    const updatedNodeData = { ...oldNodeData };
    
    // Update custom name if provided
    if (customName !== undefined && customName !== '') {
      updatedNodeData.customName = customName;
    }

    if (oldNodeId !== newNodeId) {
      // NodeId changed - delete old and create new
      await db.ref(`rooms/${roomId}/nodes/${oldNodeId}`).remove();
      await db.ref(`rooms/${roomId}/nodes/${newNodeId}`).set(updatedNodeData);
    } else {
      // Only update existing node
      await db.ref(`rooms/${roomId}/nodes/${oldNodeId}`).update(updatedNodeData);
    }

    res.redirect('/dashboard?success=Cập nhật node thành công');
  } catch (error) {
    console.error('Lỗi khi cập nhật node:', error);
    res.redirect('/dashboard?error=Lỗi khi cập nhật node: ' + error.message);
  }
});

// ==================== PHONE MANAGEMENT ROUTES ====================

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

// ==================== FIREBASE CONFIG API ====================

// Get Firebase client config
app.get('/api/firebase-config', requireAuth, (req, res) => {
  try {
    // Read project info from admin file
    const adminConfig = require('./firebase-admin.json');
    
    // Generate client-side Firebase config from admin config
    const clientConfig = {
      projectId: adminConfig.project_id,
      authDomain: `${adminConfig.project_id}.firebaseapp.com`,
      databaseURL: `https://${adminConfig.project_id}-default-rtdb.asia-southeast1.firebasedatabase.app`,
      storageBucket: `${adminConfig.project_id}.appspot.com`,
      messagingSenderId: adminConfig.client_id,
      // Note: apiKey and appId need to be obtained from Firebase console
      // These are safe to expose in client-side code
      apiKey: process.env.FIREBASE_API_KEY || "your-api-key-here",
      appId: process.env.FIREBASE_APP_ID || `1:${adminConfig.client_id}:web:your-app-id-here`
    };
    
    console.log('🔥 Providing Firebase client config for project:', adminConfig.project_id);
    
    res.json(clientConfig);
    
  } catch (error) {
    console.error('Error reading Firebase config:', error);
    res.status(500).json({ error: 'Could not load Firebase config' });
  }
});

// ==================== FEEDBACK API ====================

// Get feedback list
app.get('/api/feedback', requireAuth, async (req, res) => {
  try {
    const feedbackSnapshot = await db.ref('feedback').once('value');
    const feedbackData = feedbackSnapshot.val() || {};
    
    console.log('🔍 Loading feedback data...');
    
    // Convert to array and sort by timestamp (newest first)
    const feedbacks = [];
    
    Object.entries(feedbackData).forEach(([timestampKey, feedback]) => {
      // timestampKey should be in format: YYYY-MM-DD-HH-MM-SS
      console.log(`📝 Processing feedback: ${timestampKey}`, feedback);
      
      feedbacks.push({
        id: timestampKey,
        timestamp: timestampKey,
        roomNumber: feedback.roomNumber || null,
        content: feedback.content || '',
        createdAt: parseFeedbackTimestamp(timestampKey)
      });
    });
    
    // Sort by timestamp (newest first)
    feedbacks.sort((a, b) => b.createdAt - a.createdAt);
    
    // Limit to last 20 feedbacks for performance
    const limitedFeedbacks = feedbacks.slice(0, 20);
    
    console.log(`📊 Returning ${limitedFeedbacks.length} feedbacks`);
    
    res.json(limitedFeedbacks);
    
  } catch (error) {
    console.error('Lỗi khi lấy danh sách feedback:', error);
    res.status(500).json({ error: 'Lỗi server khi lấy feedback' });
  }
});

// Add feedback (for testing/demo purposes)
app.post('/api/feedback', requireAuth, async (req, res) => {
  try {
    const { content, roomNumber, isAnonymous } = req.body;
    
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Nội dung góp ý không được để trống' });
    }
    
    // Generate timestamp in format YYYY-MM-DD-HH-MM-SS
    const now = new Date();
    const year = now.getFullYear();
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');
    const hour = now.getHours().toString().padStart(2, '0');
    const minute = now.getMinutes().toString().padStart(2, '0');
    const second = now.getSeconds().toString().padStart(2, '0');
    
    const timestampKey = `${year}-${month}-${day}-${hour}-${minute}-${second}`;
    
    const feedbackData = {
      content: content.trim(),
      roomNumber: (isAnonymous || !roomNumber) ? null : roomNumber.trim(),
      timestamp: now.toISOString()
    };
    
    await db.ref(`feedback/${timestampKey}`).set(feedbackData);
    
    console.log(`📝 Added feedback: ${timestampKey}`, feedbackData);
    
    res.json({ 
      success: true, 
      message: 'Đã thêm góp ý thành công',
      id: timestampKey 
    });
    
  } catch (error) {
    console.error('Lỗi khi thêm feedback:', error);
    res.status(500).json({ error: 'Lỗi server khi thêm feedback' });
  }
});



// Helper function to parse feedback timestamp
function parseFeedbackTimestamp(timestampKey) {
  try {
    // Expected format: YYYY-MM-DD-HH-MM-SS
    const parts = timestampKey.split('-');
    if (parts.length >= 6) {
      const year = parseInt(parts[0]);
      const month = parseInt(parts[1]) - 1; // Month is 0-indexed
      const day = parseInt(parts[2]);
      const hour = parseInt(parts[3]);
      const minute = parseInt(parts[4]);
      const second = parseInt(parts[5]);
      
      return new Date(year, month, day, hour, minute, second);
    }
    
    // Fallback: try to parse as regular date
    return new Date(timestampKey);
  } catch (error) {
    console.error('Error parsing timestamp:', timestampKey, error);
    return new Date(0); // Return epoch if parsing fails
  }
}

// ==================== MONTHLY STATISTICS API ====================

// Get room statistics for charts (30 days)
app.get('/api/room-statistics/:roomId', requireAuth, async (req, res) => {
  try {
    const { roomId } = req.params;
    const roomsSnapshot = await db.ref('rooms').once('value');
    const roomsData = roomsSnapshot.val() || {};
    
    console.log(`🔍 Getting room statistics for: ${roomId}`);
    
    let electricHistory = {};
    let waterHistory = {};
    
    // Get last 30 days
    const last30Days = getLast30Days();
    const fromDate = last30Days[0];
    const toDate = last30Days[last30Days.length - 1];
    
    console.log(`📅 Date range: ${fromDate} to ${toDate}`);
    
    if (roomId === 'all') {
      // Aggregate data from all rooms
      console.log('📊 Processing all rooms');
      
      Object.entries(roomsData).forEach(([roomKey, room]) => {
        if (room.history) {
          console.log(`🏠 Processing room ${roomKey}`);
          const roomElectricHistory = processHistoryData(room.history, fromDate, toDate, 'electric');
          const roomWaterHistory = processHistoryData(room.history, fromDate, toDate, 'water');
          
          Object.entries(roomElectricHistory).forEach(([date, value]) => {
            electricHistory[date] = (electricHistory[date] || 0) + value;
          });
          
          Object.entries(roomWaterHistory).forEach(([date, value]) => {
            waterHistory[date] = (waterHistory[date] || 0) + value;
          });
        }
      });
    } else {
      // Single room data
      console.log(`🏠 Processing single room: ${roomId}`);
      
      if (roomsData[roomId] && roomsData[roomId].history) {
        electricHistory = processHistoryData(roomsData[roomId].history, fromDate, toDate, 'electric');
        waterHistory = processHistoryData(roomsData[roomId].history, fromDate, toDate, 'water');
        console.log(`⚡ Electric data points: ${Object.keys(electricHistory).length}`);
        console.log(`💧 Water data points: ${Object.keys(waterHistory).length}`);
      } else {
        console.log(`❌ No history data found for room ${roomId}`);
      }
    }
    
    res.json({
      electricHistory,
      waterHistory,
      roomId: roomId,
      dateRange: {
        from: fromDate,
        to: toDate
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Lỗi khi lấy thống kê phòng:', error);
    res.status(500).json({ error: 'Lỗi server khi lấy thống kê phòng' });
  }
});

// Helper function to get last 30 days
function getLast30Days() {
  const arr = [];
  const today = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const yyyy = d.getFullYear();
    const mm = (d.getMonth() + 1).toString().padStart(2, '0');
    const dd = d.getDate().toString().padStart(2, '0');
    arr.push(`${yyyy}-${mm}-${dd}`);
  }
  return arr;
}

// Get monthly statistics
app.get('/api/monthly-statistics', requireAuth, async (req, res) => {
  try {
    const roomsSnapshot = await db.ref('rooms').once('value');
    const roomsData = roomsSnapshot.val() || {};
    
    const currentMonth = new Date().getMonth() + 1; // 1-12
    const currentYear = new Date().getFullYear();
    
    let totalElectricity = 0;
    let totalWater = 0;
    
    console.log(`🔍 Calculating monthly statistics for ${currentMonth}/${currentYear}`);
    
    // Process each room
    for (const [roomId, roomData] of Object.entries(roomsData)) {
      console.log(`Processing room ${roomId}`);
      
      // New structure: history is at room level
      if (roomData.history) {
        console.log(`📊 Room ${roomId} has history data`);
        
        // Calculate electricity usage for this room
        const electricUsage = calculateMonthlyUsageByType(roomData.history, currentMonth, currentYear, roomId, 'electric');
        totalElectricity += electricUsage;
        console.log(`⚡ Room ${roomId} electricity usage: ${electricUsage} kWh`);
        
        // Calculate water usage for this room
        const waterUsage = calculateMonthlyUsageByType(roomData.history, currentMonth, currentYear, roomId, 'water');
        totalWater += waterUsage;
        console.log(`💧 Room ${roomId} water usage: ${waterUsage} m³`);
      } else {
        console.log(`📂 Room ${roomId} has no history data`);
      }
    }
    
    console.log(`📊 Final totals - Electricity: ${totalElectricity} kWh, Water: ${totalWater} m³`);
    
    res.json({
      electricity: totalElectricity,
      water: totalWater,
      month: currentMonth,
      year: currentYear,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Lỗi khi tính thống kê tháng:', error);
    res.status(500).json({ error: 'Lỗi server khi tính thống kê tháng' });
  }
});

// Helper function to calculate monthly usage for specific data type
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

// Helper function to calculate monthly usage
function calculateMonthlyUsage(historyData, month, year, nodeId) {
  try {
    const monthStr = month.toString().padStart(2, '0');
    const yearStr = year.toString();
    
    console.log(`📅 Calculating usage for node ${nodeId} for ${monthStr}/${yearStr}`);
    
    // Get all dates in current month
    const monthDates = [];
    const daysInMonth = new Date(year, month, 0).getDate();
    
    for (let day = 1; day <= daysInMonth; day++) {
      const dayStr = day.toString().padStart(2, '0');
      const dateStr = `${yearStr}-${monthStr}-${dayStr}`;
      if (historyData[dateStr]) {
        monthDates.push({
          date: dateStr,
          data: historyData[dateStr]
        });
      }
    }
    
    console.log(`📊 Found ${monthDates.length} days of data for node ${nodeId}`);
    
    if (monthDates.length < 2) {
      console.log(`⚠️ Not enough data for node ${nodeId} (need at least 2 days)`);
      return 0; // Not enough data to calculate usage
    }
    
    // Sort by date
    monthDates.sort((a, b) => a.date.localeCompare(b.date));
    
    // Get first and last readings of the month
    const firstReading = monthDates[0].data;
    const lastReading = monthDates[monthDates.length - 1].data;
    
    console.log(`🔍 Node ${nodeId} first reading (${monthDates[0].date}):`, firstReading);
    console.log(`🔍 Node ${nodeId} last reading (${monthDates[monthDates.length - 1].date}):`, lastReading);
    
    let firstValue = 0;
    let lastValue = 0;
    
    // Determine data type based on available properties
    // Priority: electric -> water -> value
    if (firstReading.electric !== undefined && lastReading.electric !== undefined) {
      firstValue = firstReading.electric || 0;
      lastValue = lastReading.electric || 0;
      console.log(`⚡ Using electric values: ${firstValue} -> ${lastValue}`);
    } else if (firstReading.water !== undefined && lastReading.water !== undefined) {
      firstValue = firstReading.water || 0;
      lastValue = lastReading.water || 0;
      console.log(`💧 Using water values: ${firstValue} -> ${lastValue}`);
    } else if (firstReading.value !== undefined && lastReading.value !== undefined) {
      firstValue = firstReading.value || 0;
      lastValue = lastReading.value || 0;
      console.log(`🔧 Using custom values: ${firstValue} -> ${lastValue}`);
    } else {
      console.log(`❌ No compatible data found for node ${nodeId}`);
      console.log('Available properties in first reading:', Object.keys(firstReading));
      console.log('Available properties in last reading:', Object.keys(lastReading));
    }
    
    // Calculate usage (ensure non-negative)
    const usage = Math.max(0, lastValue - firstValue);
    
    console.log(`📈 Node ${nodeId} monthly usage: ${usage}`);
    
    return usage;
    
  } catch (error) {
    console.error(`❌ Lỗi khi tính usage cho node ${nodeId}:`, error);
    return 0;
  }
}

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

// Chi tiết phòng
app.get('/room-details/:roomId', requireAuth, async (req, res) => {
  try {
    const { roomId } = req.params;
    const roomSnapshot = await db.ref(`rooms/${roomId}`).once('value');
    
    if (!roomSnapshot.exists()) {
      return res.redirect('/dashboard?error=Không tìm thấy phòng');
    }

    const roomData = roomSnapshot.val();
    
    // Xử lý dữ liệu lịch sử
    const processedRoom = {
      id: roomId,
      roomNumber: roomData.roomNumber || roomId,
      phoneNumber: roomData.phoneNumber || roomData.phone || '',
      floor: roomData.floor || 1,
      status: roomData.status || 'vacant',
      tenant: roomData.tenant || {},
      nodes: {},
      history: {}
    };

    // Xử lý nodes và lịch sử
    if (roomData.nodes) {
      for (const [nodeId, nodeData] of Object.entries(roomData.nodes)) {
        const nodeType = nodeData.type || (nodeId.includes('electric') ? 'electricity' : 'water');
        
        processedRoom.nodes[nodeType] = {
          nodeId: nodeId,
          type: nodeType,
          status: nodeData.status || 'active',
          lastReading: nodeData.lastData ? 
            (nodeType === 'electricity' ? nodeData.lastData.electric : nodeData.lastData.water) : 0,
          lastUpdate: nodeData.lastUpdate || null
        };

        // Xử lý lịch sử 7 ngày gần nhất
        if (nodeData.history) {
          const last7Days = getLastNDays(7);
          processedRoom.history[nodeType] = {};
          
          last7Days.forEach(date => {
            if (nodeData.history[date]) {
              const value = nodeType === 'electricity' ? 
                nodeData.history[date].electric : 
                nodeData.history[date].water;
              processedRoom.history[nodeType][date] = value || 0;
            } else {
              processedRoom.history[nodeType][date] = 0;
            }
          });
        }
      }
    }

    res.render('room-details', { room: processedRoom });
  } catch (error) {
    console.error('Lỗi khi lấy chi tiết phòng:', error);
    res.redirect('/dashboard?error=Lỗi khi lấy chi tiết phòng: ' + error.message);
  }
});

// Thống kê (giữ nguyên logic cũ nhưng cải thiện)
app.get('/statistic', requireAuth, async (req, res) => {
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

    // Set default values for month/year if not provided
    const currentDate = new Date();
    const currentMonth = currentDate.getMonth() + 1;
    const currentYear = currentDate.getFullYear();

    fromMonthElectric = fromMonthElectric || currentMonth;
    fromYearElectric = fromYearElectric || currentYear;
    toMonthElectric = toMonthElectric || currentMonth;
    toYearElectric = toYearElectric || currentYear;
    fromMonthWater = fromMonthWater || currentMonth;
    fromYearWater = fromYearWater || currentYear;
    toMonthWater = toMonthWater || currentMonth;
    toYearWater = toYearWater || currentYear;

    // Logic xử lý thống kê theo phòng
    if (roomId && roomData[roomId]) {
      // Thống kê cho một phòng cụ thể
      const room = roomData[roomId];

      // Xử lý dữ liệu từ room history (new structure)
      if (room.history) {
        electricHistory = processHistoryData(room.history, fromElectric, toElectric, 'electric');
        waterHistory = processHistoryData(room.history, fromWater, toWater, 'water');
      }
    } else {
      // Thống kê tổng hợp tất cả phòng
      Object.entries(roomData).forEach(([roomKey, room]) => {
        if (room.history) {
          const roomElectricHistory = processHistoryData(room.history, fromElectric, toElectric, 'electric');
          const roomWaterHistory = processHistoryData(room.history, fromWater, toWater, 'water');
          
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
});

// Quản lí thanh toán
app.get('/payments', requireAuth, async (req, res) => {
  try {
    const roomsSnapshot = await db.ref('rooms').once('value');
    const roomsData = roomsSnapshot.val() || {};
    
    // Lấy tháng hiện tại
    const currentDate = new Date();
    const currentMonth = currentDate.getMonth() + 1;
    const currentYear = currentDate.getFullYear();
    const currentMonthKey = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;
    
    // Xử lý dữ liệu phòng và trạng thái thanh toán
    const rooms = Object.entries(roomsData).map(([roomId, roomInfo]) => {
      const floor = roomId.charAt(0);
      
      // Mock data cho demo - sau này sẽ thay bằng data thật
      const mockElectricUsage = Math.floor(Math.random() * 100) + 50; // 50-150 kWh
      const mockWaterUsage = Math.floor(Math.random() * 20) + 10; // 10-30 m³
      const electricRate = 3500; // VND per kWh
      const waterRate = 15000; // VND per m³
      const roomFee = 2000000; // 2 triệu VND
      
      const electricCost = mockElectricUsage * electricRate;
      const waterCost = mockWaterUsage * waterRate;
      const totalCost = roomFee + electricCost + waterCost;
      
      // Mock payment status - random cho demo
      const isPaid = Math.random() > 0.3; // 70% đã thanh toán
      const paymentDate = isPaid ? new Date(currentYear, currentMonth - 1, Math.floor(Math.random() * 28) + 1) : null;
      
      return {
        id: roomId,
        roomNumber: roomId,
        phoneNumber: formatPhoneNumber(roomInfo.phone || ''),
        floor: parseInt(floor),
        status: (roomInfo.phone && roomInfo.phone.trim()) ? 'occupied' : 'vacant',
        currentMonth: currentMonthKey,
        payment: {
          isPaid: isPaid,
          paymentDate: paymentDate,
          roomFee: roomFee,
          electricUsage: mockElectricUsage,
          electricCost: electricCost,
          waterUsage: mockWaterUsage,
          waterCost: waterCost,
          totalCost: totalCost,
          dueDate: new Date(currentYear, currentMonth, 5) // Hạn thanh toán ngày 5 tháng sau
        }
      };
    }).sort((a, b) => a.roomNumber.localeCompare(b.roomNumber));
    
    // Tính thống kê
    const occupiedRooms = rooms.filter(r => r.status === 'occupied');
    const paidRooms = occupiedRooms.filter(r => r.payment.isPaid);
    const unpaidRooms = occupiedRooms.filter(r => !r.payment.isPaid);
    const totalRevenue = paidRooms.reduce((sum, room) => sum + room.payment.totalCost, 0);
    const pendingRevenue = unpaidRooms.reduce((sum, room) => sum + room.payment.totalCost, 0);
    
    res.render('payments', {
      rooms: rooms,
      currentMonth: currentMonth,
      currentYear: currentYear,
      currentMonthKey: currentMonthKey,
      stats: {
        totalRooms: occupiedRooms.length,
        paidRooms: paidRooms.length,
        unpaidRooms: unpaidRooms.length,
        totalRevenue: totalRevenue,
        pendingRevenue: pendingRevenue,
        paymentRate: occupiedRooms.length > 0 ? Math.round((paidRooms.length / occupiedRooms.length) * 100) : 0
      },
      success: req.query.success || null,
      error: req.query.error || null
    });
  } catch (error) {
    console.error('Lỗi khi tải trang thanh toán:', error);
    res.redirect('/dashboard?error=Lỗi khi tải trang thanh toán: ' + error.message);
  }
});

// API đánh dấu đã thanh toán
app.post('/mark-payment', requireAuth, async (req, res) => {
  try {
    const { roomId, month } = req.body;
    
    if (!roomId || !month) {
      return res.redirect('/payments?error=Thiếu thông tin cần thiết');
    }
    
    // TODO: Implement actual payment marking logic
    // For now, just redirect with success message
    console.log(`💰 Marking payment for room ${roomId} for month ${month}`);
    
    res.redirect('/payments?success=Đã đánh dấu thanh toán thành công');
  } catch (error) {
    console.error('Lỗi khi đánh dấu thanh toán:', error);
    res.redirect('/payments?error=Lỗi khi đánh dấu thanh toán: ' + error.message);
  }
});

// Utility functions
function getLastNDays(n) {
  const arr = [];
  const today = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const yyyy = d.getFullYear();
    const mm = (d.getMonth() + 1).toString().padStart(2, '0');
    const dd = d.getDate().toString().padStart(2, '0');
    arr.push(`${yyyy}-${mm}-${dd}`);
  }
  return arr;
}

function getDateRange(from, to) {
  const arr = [];
  if (!from || !to) return arr;
  const d1 = new Date(from);
  const d2 = new Date(to);
  while (d1 <= d2) {
    const yyyy = d1.getFullYear();
    const mm = (d1.getMonth() + 1).toString().padStart(2, '0');
    const dd = d1.getDate().toString().padStart(2, '0');
    arr.push(`${yyyy}-${mm}-${dd}`);
    d1.setDate(d1.getDate() + 1);
  }
  return arr;
}

function processHistoryData(history, fromDate, toDate, dataType) {
  const result = {};
  const dateRange = getDateRange(fromDate, toDate);
  
  for (let i = 0; i < dateRange.length - 1; i++) {
    const d1 = dateRange[i];
    const d2 = dateRange[i + 1];
    const label = `${d2.slice(8,10)}/${d2.slice(5,7)}/${d2.slice(2,4)}`;
    
    let value = 0;
    if (history[d1] && history[d2]) {
      const v1 = history[d1][dataType] || 0;
      const v2 = history[d2][dataType] || 0;
      value = Math.max(0, v2 - v1); // Đảm bảo không âm
    }
    
    result[label] = value;
  }
  
  return result;
}

// Helper function để lấy default data theo loại node
function getDefaultLastData(nodeType) {
  switch (nodeType) {
    case 'electricity':
      return { electric: 0, batt: 0, alerts: 0 };
    case 'water':
      return { water: 0, batt: 0, alerts: 0 };
    case 'custom':
      return { value: 0, batt: 0, alerts: 0 };
    default:
      return { value: 0, batt: 0, alerts: 0 };
  }
}

app.listen(PORT, () => {
  console.log(`🚀 Admin site is running at http://localhost:${PORT}`);
});
