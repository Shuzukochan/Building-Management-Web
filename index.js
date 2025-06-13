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

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(session({
  secret: 'secret-key',
  resave: false,
  saveUninitialized: true
}));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

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
    return res.redirect('/');
  }
  next();
}

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
      lastData: getDefaultLastData(finalNodeType)
      // Note: history is now stored at room level, not node level
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

// ==================== MONTHLY STATISTICS API ====================

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

    // Xử lý nodes - lấy lastReading từ room history
    if (roomData.nodes) {
      for (const [nodeId, nodeData] of Object.entries(roomData.nodes)) {
        const nodeType = nodeData.type || (nodeId.includes('electric') ? 'electricity' : 'water');
        
        // Lấy lastReading từ room history thay vì node lastData
        let lastReading = 0;
        if (roomData.history) {
          const sortedDates = Object.keys(roomData.history).sort();
          const latestDate = sortedDates[sortedDates.length - 1];
          if (latestDate && roomData.history[latestDate]) {
            if (nodeType === 'electricity') {
              lastReading = roomData.history[latestDate].electric || 0;
            } else if (nodeType === 'water') {
              lastReading = roomData.history[latestDate].water || 0;
            } else {
              // For custom nodes, try to get value from lastData if available
              lastReading = nodeData.lastData ? (nodeData.lastData.value || 0) : 0;
            }
          }
        }
        
        processedRoom.nodes[nodeType] = {
          nodeId: nodeId,
          type: nodeType,
          status: nodeData.status || 'active',
          lastReading: lastReading,
          lastUpdate: nodeData.lastUpdate || null
        };
      }
    }

    // Xử lý lịch sử 7 ngày gần nhất từ room history
    if (roomData.history) {
      const last7Days = getLastNDays(7);
      
      // Tạo history cho từng loại dữ liệu
      processedRoom.history.electricity = {};
      processedRoom.history.water = {};
      
      last7Days.forEach(date => {
        if (roomData.history[date]) {
          processedRoom.history.electricity[date] = roomData.history[date].electric || 0;
          processedRoom.history.water[date] = roomData.history[date].water || 0;
        } else {
          processedRoom.history.electricity[date] = 0;
          processedRoom.history.water[date] = 0;
        }
      });
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
    
    console.log(`📅 Date ranges being used:`);
    console.log(`⚡ Electric: ${fromElectric} to ${toElectric}`);
    console.log(`💧 Water: ${fromWater} to ${toWater}`);
    console.log(`🏠 Selected room: ${roomId || 'All rooms'}`);

    // Parse month format from YYYY-MM to separate month and year
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

    // Set default values for month/year if not provided
    const currentDate = new Date();
    const currentMonth = currentDate.getMonth() + 1;
    const currentYear = currentDate.getFullYear();

    // Xử lý default cho chế độ tháng (9 tháng gần nhất)
    if (viewTypeElectric === 'month' && (!fromMonthElectric || !toMonthElectric)) {
      const last9Months = getLastNMonths(9);
      fromMonthElectric = last9Months[0].month;
      fromYearElectric = last9Months[0].year;
      toMonthElectric = last9Months[last9Months.length - 1].month;
      toYearElectric = last9Months[last9Months.length - 1].year;
    }

    if (viewTypeWater === 'month' && (!fromMonthWater || !toMonthWater)) {
      const last9Months = getLastNMonths(9);
      fromMonthWater = last9Months[0].month;
      fromYearWater = last9Months[0].year;
      toMonthWater = last9Months[last9Months.length - 1].month;
      toYearWater = last9Months[last9Months.length - 1].year;
    }

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
      console.log(`🏠 Processing statistics for room ${roomId}`);
      const room = roomData[roomId];
      console.log(`📊 Room data structure:`, {
        hasHistory: !!room.history,
        historyKeys: room.history ? Object.keys(room.history).sort() : [],
        sampleHistoryEntry: room.history ? room.history[Object.keys(room.history)[0]] : null
      });

      // Xử lý dữ liệu từ room history (new structure)
      if (room.history) {
        console.log(`⚡ Processing electric data for room ${roomId}`);
        if (viewTypeElectric === 'month') {
          electricHistory = processMonthlyData(room.history, fromMonthElectric, fromYearElectric, toMonthElectric, toYearElectric, 'electric');
        } else {
          electricHistory = processHistoryData(room.history, fromElectric, toElectric, 'electric');
        }
        
        console.log(`💧 Processing water data for room ${roomId}`);
        if (viewTypeWater === 'month') {
          waterHistory = processMonthlyData(room.history, fromMonthWater, fromYearWater, toMonthWater, toYearWater, 'water');
        } else {
          waterHistory = processHistoryData(room.history, fromWater, toWater, 'water');
        }
      } else {
        console.log(`❌ No history data found for room ${roomId}, creating empty charts`);
        // Tạo dữ liệu 0 cho tất cả ngày trong range
        if (viewTypeElectric === 'month') {
          electricHistory = processMonthlyData(null, fromMonthElectric, fromYearElectric, toMonthElectric, toYearElectric, 'electric');
        } else {
          electricHistory = processHistoryData(null, fromElectric, toElectric, 'electric');
        }
        
        if (viewTypeWater === 'month') {
          waterHistory = processMonthlyData(null, fromMonthWater, fromYearWater, toMonthWater, toYearWater, 'water');
        } else {
          waterHistory = processHistoryData(null, fromWater, toWater, 'water');
        }
      }
    } else {
      // Thống kê tổng hợp tất cả phòng
      console.log(`🏢 Processing statistics for all rooms`);
      
      // Khởi tạo tất cả ngày/tháng với giá trị 0
      if (viewTypeElectric === 'month') {
        const monthRange = getMonthRange(fromMonthElectric, fromYearElectric, toMonthElectric, toYearElectric);
        monthRange.forEach(monthInfo => {
          const label = `${String(monthInfo.month).padStart(2, '0')}/${String(monthInfo.year).slice(-2)}`;
          electricHistory[label] = 0;
        });
      } else {
        const electricDateRange = getDateRange(fromElectric, toElectric);
        electricDateRange.forEach(date => {
          const label = `${date.slice(8,10)}/${date.slice(5,7)}/${date.slice(2,4)}`;
          electricHistory[label] = 0;
        });
      }
      
      if (viewTypeWater === 'month') {
        const monthRange = getMonthRange(fromMonthWater, fromYearWater, toMonthWater, toYearWater);
        monthRange.forEach(monthInfo => {
          const label = `${String(monthInfo.month).padStart(2, '0')}/${String(monthInfo.year).slice(-2)}`;
          waterHistory[label] = 0;
        });
      } else {
        const waterDateRange = getDateRange(fromWater, toWater);
        waterDateRange.forEach(date => {
          const label = `${date.slice(8,10)}/${date.slice(5,7)}/${date.slice(2,4)}`;
          waterHistory[label] = 0;
        });
      }
      
      // Cộng dồn dữ liệu từ các phòng
      Object.entries(roomData).forEach(([roomKey, room]) => {
        if (room.history) {
          console.log(`📊 Processing room ${roomKey} for aggregation`);
          
          let roomElectricHistory, roomWaterHistory;
          
          if (viewTypeElectric === 'month') {
            roomElectricHistory = processMonthlyData(room.history, fromMonthElectric, fromYearElectric, toMonthElectric, toYearElectric, 'electric');
          } else {
            roomElectricHistory = processHistoryData(room.history, fromElectric, toElectric, 'electric');
          }
          
          if (viewTypeWater === 'month') {
            roomWaterHistory = processMonthlyData(room.history, fromMonthWater, fromYearWater, toMonthWater, toYearWater, 'water');
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
      
      console.log(`📊 Aggregated electric data:`, electricHistory);
      console.log(`📊 Aggregated water data:`, waterHistory);
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

function getLastNMonths(n) {
  const arr = [];
  const today = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setMonth(d.getMonth() - i);
    arr.push({
      month: d.getMonth() + 1,
      year: d.getFullYear(),
      monthYear: `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}`
    });
  }
  return arr;
}

function getDateRange(from, to) {
  const arr = [];
  if (!from || !to) return arr;
  const d1 = new Date(from);
  const d2 = new Date(to);
  // Không bao gồm ngày cuối (to), chỉ đến ngày trước đó
  while (d1 < d2) {
    const yyyy = d1.getFullYear();
    const mm = (d1.getMonth() + 1).toString().padStart(2, '0');
    const dd = d1.getDate().toString().padStart(2, '0');
    arr.push(`${yyyy}-${mm}-${dd}`);
    d1.setDate(d1.getDate() + 1);
  }
  return arr;
}

function processHistoryData(history, fromDate, toDate, dataType) {
  console.log(`🔍 Processing ${dataType} data from ${fromDate} to ${toDate}`);
  console.log(`📊 Available history dates:`, Object.keys(history || {}).sort());
  
  const result = {};
  const dateRange = getDateRange(fromDate, toDate);
  
  console.log(`📅 Date range to process:`, dateRange);
  
  if (dateRange.length < 1) {
    console.log(`⚠️ No dates in range`);
    return result;
  }
  
  if (!history) {
    console.log(`❌ No history data provided, creating empty chart with 0 values`);
    // Tạo chart với giá trị 0 cho tất cả ngày trong range
    dateRange.forEach(date => {
      const label = `${date.slice(8,10)}/${date.slice(5,7)}/${date.slice(2,4)}`;
      result[label] = 0;
    });
    return result;
  }
  
  // Tính consumption cho từng ngày (ngày hôm nay trừ ngày hôm qua)
  console.log(`📊 Calculating consumption for each day in range`);
  
  dateRange.forEach(date => {
    const label = `${date.slice(8,10)}/${date.slice(5,7)}/${date.slice(2,4)}`;
    let consumption = 0;
    
    // Tìm ngày hôm qua để tính consumption
    const currentDate = new Date(date);
    const yesterday = new Date(currentDate);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    
    // Tính consumption = giá trị ngày hôm nay - giá trị ngày hôm qua
    if (history[date] && history[yesterdayStr] && 
        history[date][dataType] !== undefined && 
        history[yesterdayStr][dataType] !== undefined) {
      
      const todayValue = history[date][dataType] || 0;
      const yesterdayValue = history[yesterdayStr][dataType] || 0;
      consumption = Math.max(0, todayValue - yesterdayValue); // Đảm bảo không âm
      
      console.log(`📊 ${label}: ${dataType} consumption = ${todayValue} - ${yesterdayValue} = ${consumption}`);
    } else if (history[date] && history[date][dataType] !== undefined) {
      // Nếu không có dữ liệu ngày hôm qua, có thể là ngày đầu tiên
      // Hiển thị giá trị raw (có thể là consumption từ đầu tháng)
      consumption = history[date][dataType] || 0;
      console.log(`📊 ${label}: ${dataType} = ${consumption} (first day or missing yesterday data)`);
    } else {
      console.log(`📊 ${label}: ${dataType} = 0 (missing data for consumption calculation)`);
    }
    
    result[label] = consumption;
  });
  
  console.log(`📊 Final ${dataType} consumption result:`, result);
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

// API debug - kiểm tra dữ liệu thô của phòng
app.get('/api/debug/room/:roomId', requireAuth, async (req, res) => {
  try {
    const { roomId } = req.params;
    const roomSnapshot = await db.ref(`rooms/${roomId}`).once('value');
    
    if (!roomSnapshot.exists()) {
      return res.status(404).json({ error: 'Phòng không tồn tại' });
    }

    const roomData = roomSnapshot.val();
    
    // Tạo response chi tiết
    const debugInfo = {
      roomId: roomId,
      hasHistory: !!roomData.history,
      historyDates: roomData.history ? Object.keys(roomData.history).sort() : [],
      historyCount: roomData.history ? Object.keys(roomData.history).length : 0,
      sampleHistory: roomData.history ? Object.fromEntries(
        Object.entries(roomData.history).slice(0, 5)
      ) : {},
      nodes: roomData.nodes ? Object.keys(roomData.nodes) : [],
      fullData: roomData
    };

    res.json(debugInfo);
  } catch (error) {
    console.error('Lỗi debug API:', error);
    res.status(500).json({ error: 'Lỗi server debug' });
  }
});

// API test statistic data cho phòng cụ thể
app.get('/api/test/statistic/:roomId', requireAuth, async (req, res) => {
  try {
    const { roomId } = req.params;
    const { days = 10 } = req.query; // Số ngày muốn test, mặc định 10
    
    const roomSnapshot = await db.ref(`rooms/${roomId}`).once('value');
    if (!roomSnapshot.exists()) {
      return res.status(404).json({ error: 'Phòng không tồn tại' });
    }

    const roomData = roomSnapshot.val();
    
    // Lấy ngày range
    const lastNDays = getLastNDays(parseInt(days));
    const fromDate = lastNDays[0];
    const toDate = lastNDays[lastNDays.length - 1];
    
    console.log(`🧪 Testing statistic for room ${roomId} from ${fromDate} to ${toDate}`);
    
    let electricHistory = {};
    let waterHistory = {};
    
    if (roomData.history) {
      electricHistory = processHistoryData(roomData.history, fromDate, toDate, 'electric');
      waterHistory = processHistoryData(roomData.history, fromDate, toDate, 'water');
    }
    
    const testResult = {
      roomId: roomId,
      dateRange: { from: fromDate, to: toDate },
      hasHistory: !!roomData.history,
      historyDates: roomData.history ? Object.keys(roomData.history).sort() : [],
      rawHistorySample: roomData.history ? Object.fromEntries(
        Object.entries(roomData.history).slice(-5) // 5 entries gần nhất
      ) : {},
      processedData: {
        electric: electricHistory,
        water: waterHistory
      },
      chartData: {
        electricLabels: Object.keys(electricHistory),
        electricData: Object.values(electricHistory),
        waterLabels: Object.keys(waterHistory),
        waterData: Object.values(waterHistory)
      }
    };

    res.json(testResult);
  } catch (error) {
    console.error('Lỗi test statistic API:', error);
    res.status(500).json({ error: 'Lỗi server test statistic' });
  }
});

function processMonthlyData(history, fromMonth, fromYear, toMonth, toYear, dataType) {
  console.log(`🔍 Processing monthly ${dataType} data from ${fromMonth}/${fromYear} to ${toMonth}/${toYear}`);
  
  const result = {};
  const monthRange = getMonthRange(fromMonth, fromYear, toMonth, toYear);
  
  console.log(`📅 Month range to process:`, monthRange);
  
  if (monthRange.length < 1) {
    console.log(`⚠️ No months in range`);
    return result;
  }
  
  if (!history) {
    console.log(`❌ No history data provided, creating empty chart with 0 values`);
    monthRange.forEach(monthInfo => {
      const label = `${String(monthInfo.month).padStart(2, '0')}/${String(monthInfo.year).slice(-2)}`;
      result[label] = 0;
    });
    return result;
  }
  
  // Tính consumption cho từng tháng (max - min)
  console.log(`📊 Calculating monthly consumption (max - min)`);
  
  monthRange.forEach(monthInfo => {
    const label = `${String(monthInfo.month).padStart(2, '0')}/${String(monthInfo.year).slice(-2)}`;
    
    // Lấy tất cả giá trị trong tháng này
    const monthlyValues = [];
    const daysInMonth = new Date(monthInfo.year, monthInfo.month, 0).getDate();
    
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${monthInfo.year}-${String(monthInfo.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      
      if (history[dateStr] && history[dateStr][dataType] !== undefined) {
        monthlyValues.push(history[dateStr][dataType]);
      }
    }
    
    let monthlyConsumption = 0;
    if (monthlyValues.length > 0) {
      const maxValue = Math.max(...monthlyValues);
      const minValue = Math.min(...monthlyValues);
      monthlyConsumption = Math.max(0, maxValue - minValue);
      
      console.log(`📊 ${label}: ${dataType} values [${minValue} -> ${maxValue}] = ${monthlyConsumption}`);
    } else {
      console.log(`📊 ${label}: ${dataType} = 0 (no data in month)`);
    }
    
    result[label] = monthlyConsumption;
  });
  
  console.log(`📊 Final monthly ${dataType} result:`, result);
  return result;
}

function getMonthRange(fromMonth, fromYear, toMonth, toYear) {
  const months = [];
  let currentMonth = fromMonth;
  let currentYear = fromYear;
  
  while (currentYear < toYear || (currentYear === toYear && currentMonth <= toMonth)) {
    months.push({
      month: currentMonth,
      year: currentYear
    });
    
    currentMonth++;
    if (currentMonth > 12) {
      currentMonth = 1;
      currentYear++;
    }
  }
  
  return months;
}

app.listen(PORT, () => {
  console.log(`🚀 Admin site is running at http://localhost:${PORT}`);
});

