const { db } = require("../config/database");
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

// Get available rooms
const getAvailableRooms = async (req, res) => {
  try {
    const targetBuildingId = getTargetBuildingId(req);
    const [roomsSnapshot, phoneToRoomSnapshot] = await Promise.all([
      db.ref(`buildings/${targetBuildingId}/rooms`).once("value"),
      db.ref('phone_to_room').once("value")
    ]);
    
    const roomsData = roomsSnapshot.val() || {};
    const phoneToRoomData = phoneToRoomSnapshot.val() || {};
    
    // Get rooms that have tenants in this building
    const occupiedRoomIds = new Set(
      Object.values(phoneToRoomData)
        .filter(data => data.buildingId === targetBuildingId)
        .map(data => data.roomId)
    );
    
    const availableRooms = Object.entries(roomsData)
      .filter(([roomId, roomInfo]) => {
        // Phòng available nếu: không có tenants VÀ không phải maintenance
        const hasNoTenants = !occupiedRoomIds.has(roomId);
        const notMaintenance = roomInfo.status !== 'maintenance';
        
        return hasNoTenants && notMaintenance;
      })
      .map(([roomId, roomInfo]) => {
        const floor = roomId.charAt(0);
        return {
          id: roomId,
          roomNumber: roomId,
          floor: parseInt(floor),
          status: roomInfo.status || 'vacant'
        };
      });
    
    res.json(availableRooms);
  } catch (error) {
    console.error("Error fetching available rooms:", error);
    res.status(500).json({ error: "Failed to fetch available rooms" });
  }
};

// Get room by ID
const getRoomById = async (req, res) => {
  try {
    const { roomId } = req.params;
    const targetBuildingId = getTargetBuildingId(req);
    const roomSnapshot = await db.ref(`buildings/${targetBuildingId}/rooms/${roomId}`).once("value");
    const roomData = roomSnapshot.val();
    
    if (!roomData) {
      return res.status(404).json({ error: "Room not found" });
    }
    
    res.json({
      id: roomId,
      ...roomData,
      phoneNumber: formatPhoneNumber(roomData.phone || "")
    });
  } catch (error) {
    console.error("Error fetching room:", error);
    res.status(500).json({ error: "Failed to fetch room" });
  }
};

// Add new room
const addRoom = async (req, res) => {
  try {
    const { roomNumber, floor } = req.body;
    const targetBuildingId = getTargetBuildingId(req);
    
    // Check if room already exists
    const existingRoom = await db.ref(`buildings/${targetBuildingId}/rooms/${roomNumber}`).once("value");
    if (existingRoom.val()) {
      return res.status(400).json({ error: "Room already exists" });
    }
    
    await db.ref(`buildings/${targetBuildingId}/rooms/${roomNumber}`).set({
      status: "vacant",
      nodes: {},
      history: {}
    });
    
    res.json({ success: true, message: "Room added successfully" });
  } catch (error) {
    console.error("Error adding room:", error);
    res.status(500).json({ error: "Failed to add room" });
  }
};

// Assign tenant to room
const assignTenant = async (req, res) => {
  try {
    const { roomId, tenantName, phoneNumber } = req.body;
    const targetBuildingId = getTargetBuildingId(req);

    if (!roomId || !phoneNumber || !tenantName) {
      return res.status(400).json({ 
        success: false,
        message: "Thiếu thông tin phòng, tên hoặc số điện thoại" 
      });
    }

    // Format phone number
    const formattedPhone = formatPhoneNumber(phoneNumber);

    // 1. Kiểm tra số điện thoại đã được sử dụng chưa (global check)
    const existingPhoneSnapshot = await db.ref(`phone_to_room/${formattedPhone}`).once("value");
    if (existingPhoneSnapshot.exists()) {
      const existingData = existingPhoneSnapshot.val();
      return res.status(400).json({
        success: false,
        message: `Số điện thoại đã được sử dụng cho phòng ${existingData.roomId} tại ${existingData.buildingId}`
      });
    }

    // 2. Kiểm tra phòng tồn tại
    const roomSnapshot = await db.ref(`buildings/${targetBuildingId}/rooms/${roomId}`).once("value");
    if (!roomSnapshot.exists()) {
      return res.status(404).json({
        success: false,
        message: "Phòng không tồn tại"
      });
    }

    const roomData = roomSnapshot.val();
    
    // 3. Kiểm tra phòng có đang bảo trì không
    if (roomData.status === 'maintenance') {
      return res.status(400).json({
        success: false,
        message: "Không thể thêm người thuê vào phòng đang bảo trì"
      });
    }

    // 4. Kiểm tra phòng có người đại diện chưa từ global mapping
    const existingPhonesSnapshot = await db.ref('phone_to_room').orderByChild('roomId').equalTo(roomId).once("value");
    const existingPhones = existingPhonesSnapshot.val() || {};
    
    // Filter theo building để tránh conflicts
    const roomPhones = Object.entries(existingPhones)
      .filter(([phone, data]) => data.buildingId === targetBuildingId)
      .map(([phone, data]) => data);
    
    const isFirstTenant = roomPhones.length === 0;
    const isRepresentative = isFirstTenant; // Người đầu tiên là đại diện

    // 6. Cập nhật database - simplified structure
    const updates = {};
    
    // 6a. Thêm vào global phone mapping (primary source of truth)
    updates[`phone_to_room/${formattedPhone}`] = {
      buildingId: targetBuildingId,
      roomId: roomId,
      name: tenantName.trim(),
      isRepresentative: isRepresentative
    };

    // 6b. Chỉ cập nhật room status (không cần redundant data)
    updates[`buildings/${targetBuildingId}/rooms/${roomId}/status`] = "occupied";

    // 7. Thực hiện atomic update
    await db.ref().update(updates);
    
    res.json({
      success: true,
      message: isRepresentative ? 
        "Thêm người đại diện thành công!" : 
        "Thêm thành viên thành công!",
      data: {
        isRepresentative: isRepresentative,
        tenantCount: roomPhones.length + 1
      }
    });
  } catch (error) {
    console.error("Error assigning tenant:", error);
    res.status(500).json({
      success: false,
      message: "Lỗi khi thêm người thuê: " + error.message
    });
  }
};

// Update room
const updateRoom = async (req, res) => {
  try {
    const { roomId, phoneNumber, status } = req.body;
    const targetBuildingId = getTargetBuildingId(req);
    
    if (!roomId) {
      return res.status(400).json({ error: "Missing roomId" });
    }

    const roomRef = db.ref(`buildings/${targetBuildingId}/rooms/${roomId}`);
    const roomSnapshot = await roomRef.once("value");
    
    if (!roomSnapshot.exists()) {
      return res.status(404).json({ error: "Room not found" });
    }

    const updateData = {};
    if (phoneNumber !== undefined) {
      updateData.phone = formatPhoneNumber(phoneNumber);
      
      // Auto-update status based on phone presence
      if (!phoneNumber || !phoneNumber.trim()) {
        // Phone removed -> set to vacant (unless explicitly setting to maintenance)
        if (status === undefined) {
          updateData.status = "vacant";
        }
      } else {
        // Phone added -> set to occupied (unless explicitly setting status)
        if (status === undefined) {
          updateData.status = "occupied";
        }
      }
    }
    if (status !== undefined) {
      // Validate status values
      if (!['vacant', 'occupied', 'maintenance'].includes(status)) {
        return res.status(400).json({ error: "Invalid status value" });
      }
      updateData.status = status;
    }

    await roomRef.update(updateData);
    
    res.json({ success: true, message: "Room updated successfully" });
  } catch (error) {
    console.error("Error updating room:", error);
    res.status(500).json({ error: "Failed to update room" });
  }
};

// Delete room
const deleteRoom = async (req, res) => {
  try {
    const { roomId } = req.body;
    const targetBuildingId = getTargetBuildingId(req);
    
    if (!roomId) {
      return res.status(400).json({ error: "Missing roomId" });
    }

    const roomRef = db.ref(`buildings/${targetBuildingId}/rooms/${roomId}`);
    const roomSnapshot = await roomRef.once("value");
    
    if (!roomSnapshot.exists()) {
      return res.status(404).json({ error: "Room not found" });
    }

    await roomRef.remove();
    
    res.json({ success: true, message: "Room deleted successfully" });
  } catch (error) {
    console.error("Error deleting room:", error);
    res.status(500).json({ error: "Failed to delete room" });
  }
};

// Get phone numbers
const getPhoneNumbers = async (req, res) => {
  try {
    const targetBuildingId = getTargetBuildingId(req);
    
    // Lấy từ global phone mapping, filter theo building
    const phoneToRoomSnapshot = await db.ref('phone_to_room').once("value");
    const phoneToRoomData = phoneToRoomSnapshot.val() || {};
    
    const phoneNumbers = Object.entries(phoneToRoomData)
      .filter(([phone, data]) => data.buildingId === targetBuildingId)
      .map(([phone, data]) => ({
        roomId: data.roomId,
        phoneNumber: phone,
        name: data.name,
        isRepresentative: data.isRepresentative
      }));
    
    res.json(phoneNumbers);
  } catch (error) {
    console.error("Error fetching phone numbers:", error);
    res.status(500).json({ error: "Failed to fetch phone numbers" });
  }
};

// Get tenants for a room
const getRoomTenants = async (req, res) => {
  try {
    const { roomId } = req.params;
    const targetBuildingId = getTargetBuildingId(req);
    
    // Lấy tenants từ global mapping
    const phoneToRoomSnapshot = await db.ref('phone_to_room').orderByChild('roomId').equalTo(roomId).once("value");
    const phoneToRoomData = phoneToRoomSnapshot.val() || {};
    
    // Filter theo building
    const tenants = Object.entries(phoneToRoomData)
      .filter(([phone, data]) => data.buildingId === targetBuildingId)
      .map(([phone, data]) => ({
        phone: phone,
        name: data.name,
        isRepresentative: data.isRepresentative
      }))
      .sort((a, b) => a.isRepresentative === b.isRepresentative ? 0 : a.isRepresentative ? -1 : 1); // Representative first
    
    res.json({
      success: true,
      tenants: tenants,
      tenantCount: tenants.length,
      representative: tenants.find(t => t.isRepresentative) || null
    });
  } catch (error) {
    console.error("Error fetching room tenants:", error);
    res.status(500).json({ 
      success: false,
      error: "Failed to fetch room tenants" 
    });
  }
};

// Delete tenant from room  
const deleteTenant = async (req, res) => {
  try {
    const { roomId } = req.params;
    const { tenantIndex } = req.body;
    const targetBuildingId = getTargetBuildingId(req);

    if (tenantIndex === undefined) {
      return res.status(400).json({ 
        success: false,
        message: "Thiếu thông tin người thuê cần xóa" 
      });
    }

    // Lấy danh sách tenants hiện tại
    const phoneToRoomSnapshot = await db.ref('phone_to_room').orderByChild('roomId').equalTo(roomId).once("value");
    const phoneToRoomData = phoneToRoomSnapshot.val() || {};
    
    // Filter theo building và sort
    const tenants = Object.entries(phoneToRoomData)
      .filter(([phone, data]) => data.buildingId === targetBuildingId)
      .map(([phone, data]) => ({ phone, ...data }))
      .sort((a, b) => a.isRepresentative === b.isRepresentative ? 0 : a.isRepresentative ? -1 : 1);

    if (tenantIndex >= tenants.length) {
      return res.status(400).json({
        success: false,
        message: "Không tìm thấy người thuê cần xóa"
      });
    }

    const tenantToDelete = tenants[tenantIndex];
    const phoneToDelete = tenantToDelete.phone;

    // Chuẩn bị updates
    const updates = {};
    
    // Xóa khỏi global mapping
    updates[`phone_to_room/${phoneToDelete}`] = null;

    // Nếu xóa hết tenants, set room status = vacant
    if (tenants.length === 1) {
      updates[`buildings/${targetBuildingId}/rooms/${roomId}/status`] = "vacant";
    } 
    // Nếu xóa representative, reassign representative cho tenant tiếp theo
    else if (tenantToDelete.isRepresentative && tenants.length > 1) {
      const nextTenant = tenants.find(t => t.phone !== phoneToDelete);
      if (nextTenant) {
        updates[`phone_to_room/${nextTenant.phone}/isRepresentative`] = true;
      }
    }

    // Thực hiện update
    await db.ref().update(updates);

    res.json({
      success: true,
      message: tenantToDelete.isRepresentative ? 
        "Xóa người đại diện thành công!" : 
        "Xóa người thuê thành công!",
      data: {
        remainingCount: tenants.length - 1
      }
    });
  } catch (error) {
    console.error("Error deleting tenant:", error);
    res.status(500).json({
      success: false,
      message: "Lỗi khi xóa người thuê: " + error.message
    });
  }
};

// Edit tenant info
const editTenant = async (req, res) => {
  try {
    const { roomId } = req.params;
    const { tenantIndex, tenantName, phoneNumber } = req.body;
    const targetBuildingId = getTargetBuildingId(req);

    if (tenantIndex === undefined || !tenantName || !phoneNumber) {
      return res.status(400).json({ 
        success: false,
        message: "Thiếu thông tin cần thiết để cập nhật" 
      });
    }

    const formattedPhone = formatPhoneNumber(phoneNumber);

    // Lấy danh sách tenants hiện tại
    const phoneToRoomSnapshot = await db.ref('phone_to_room').orderByChild('roomId').equalTo(roomId).once("value");
    const phoneToRoomData = phoneToRoomSnapshot.val() || {};
    
    const tenants = Object.entries(phoneToRoomData)
      .filter(([phone, data]) => data.buildingId === targetBuildingId)
      .map(([phone, data]) => ({ phone, ...data }))
      .sort((a, b) => a.isRepresentative === b.isRepresentative ? 0 : a.isRepresentative ? -1 : 1);

    if (tenantIndex >= tenants.length) {
      return res.status(400).json({
        success: false,
        message: "Không tìm thấy người thuê cần sửa"
      });
    }

    const currentTenant = tenants[tenantIndex];
    const oldPhone = currentTenant.phone;
    
    // Kiểm tra phone mới có trùng với ai khác không (trừ chính nó)
    if (formattedPhone !== oldPhone) {
      const existingPhoneSnapshot = await db.ref(`phone_to_room/${formattedPhone}`).once("value");
      if (existingPhoneSnapshot.exists()) {
        const existingData = existingPhoneSnapshot.val();
        return res.status(400).json({
          success: false,
          message: `Số điện thoại đã được sử dụng cho phòng ${existingData.roomId}`
        });
      }
    }

    const updates = {};
    
    // Nếu phone số thay đổi
    if (formattedPhone !== oldPhone) {
      // Xóa phone cũ
      updates[`phone_to_room/${oldPhone}`] = null;
      
      // Thêm phone mới với thông tin cập nhật
      updates[`phone_to_room/${formattedPhone}`] = {
        buildingId: targetBuildingId,
        roomId: roomId,
        name: tenantName.trim(),
        isRepresentative: currentTenant.isRepresentative
      };
    } else {
      // Chỉ cập nhật tên
      updates[`phone_to_room/${oldPhone}/name`] = tenantName.trim();
    }

    await db.ref().update(updates);

    res.json({
      success: true,
      message: "Cập nhật thông tin người thuê thành công!",
      data: {
        oldPhone: oldPhone,
        newPhone: formattedPhone,
        name: tenantName.trim()
      }
    });
  } catch (error) {
    console.error("Error editing tenant:", error);
    res.status(500).json({
      success: false,
      message: "Lỗi khi cập nhật thông tin: " + error.message
    });
  }
};

// Get room data (for UI updates)
const getRoomData = async (req, res) => {
  try {
    const { roomId } = req.params;
    const targetBuildingId = getTargetBuildingId(req);
    
    // Get room info
    const roomSnapshot = await db.ref(`buildings/${targetBuildingId}/rooms/${roomId}`).once("value");
    if (!roomSnapshot.exists()) {
      return res.status(404).json({
        success: false,
        message: "Phòng không tồn tại"
      });
    }

    const roomData = roomSnapshot.val();
    
    // Get tenants from global mapping
    const phoneToRoomSnapshot = await db.ref('phone_to_room').orderByChild('roomId').equalTo(roomId).once("value");
    const phoneToRoomData = phoneToRoomSnapshot.val() || {};
    
    const tenants = Object.entries(phoneToRoomData)
      .filter(([phone, data]) => data.buildingId === targetBuildingId)
      .map(([phone, data]) => ({
        phone: phone,
        name: data.name,
        isRepresentative: data.isRepresentative
      }))
      .sort((a, b) => a.isRepresentative === b.isRepresentative ? 0 : a.isRepresentative ? -1 : 1);

    const representative = tenants.find(t => t.isRepresentative) || tenants[0] || null;

    const room = {
      id: roomId,
      roomNumber: roomId,
      status: roomData.status || (tenants.length > 0 ? 'occupied' : 'vacant'),
      phoneNumber: representative ? formatPhoneNumber(representative.phone) : "",
      tenantName: representative ? representative.name : null,
      tenantCount: tenants.length,
      tenants: tenants
    };

    res.json({
      success: true,
      room: room
    });
  } catch (error) {
    console.error("Error getting room data:", error);
    res.status(500).json({
      success: false,
      message: "Lỗi khi lấy thông tin phòng: " + error.message
    });
  }
};

module.exports = {
  getAvailableRooms,
  getRoomById,
  addRoom,
  assignTenant,
  updateRoom,
  deleteRoom,
  getPhoneNumbers,
  getRoomTenants,
  deleteTenant,
  editTenant,
  getRoomData
};