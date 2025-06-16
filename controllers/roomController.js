const { db } = require("../config/database");
const { formatPhoneNumber } = require("../services/phoneService");

// Get available rooms
const getAvailableRooms = async (req, res) => {
  try {
    const roomsSnapshot = await db.ref("rooms").once("value");
    const roomsData = roomsSnapshot.val() || {};
    
    const availableRooms = Object.entries(roomsData)
      .filter(([roomId, roomInfo]) => !roomInfo.phone || !roomInfo.phone.trim())
      .map(([roomId, roomInfo]) => {
        const floor = roomId.charAt(0);
        return {
          id: roomId,
          roomNumber: roomId,
          floor: parseInt(floor)
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
    const roomSnapshot = await db.ref("rooms/" + roomId).once("value");
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
    
    // Check if room already exists
    const existingRoom = await db.ref("rooms/" + roomNumber).once("value");
    if (existingRoom.val()) {
      return res.status(400).json({ error: "Room already exists" });
    }
    
    await db.ref("rooms/" + roomNumber).set({
      phone: "",
      nodes: {},
      history: {},
      createdAt: Date.now()
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
    const { roomId, phoneNumber, electricityNode, waterNode } = req.body;

    if (!roomId || !phoneNumber) {
      return res.redirect("/dashboard?error=Thiếu thông tin phòng hoặc số điện thoại");
    }

    // Kiểm tra phòng tồn tại và đang trống
    const roomSnapshot = await db.ref(`rooms/${roomId}`).once("value");
    if (!roomSnapshot.exists()) {
      return res.redirect("/dashboard?error=Phòng không tồn tại");
    }

    const roomData = roomSnapshot.val();
    // Kiểm tra phòng trống: không có phone hoặc phone rỗng
    if (roomData.phone && roomData.phone.trim()) {
      return res.redirect("/dashboard?error=Phòng đã có người thuê");
    }

    // Format phone number
    const formattedPhone = formatPhoneNumber(phoneNumber);

    // Cập nhật thông tin phòng
    const updateData = {
      phone: formattedPhone,
      assignedAt: Date.now()
    };

    // Thêm nodes nếu có
    if (electricityNode || waterNode) {
      updateData.nodes = roomData.nodes || {};
      
      if (electricityNode) {
        updateData.nodes[electricityNode] = {
          type: "electricity",
          lastData: {},
          customName: electricityNode
        };
      }
      
      if (waterNode) {
        updateData.nodes[waterNode] = {
          type: "water", 
          lastData: {},
          customName: waterNode
        };
      }
    }

    await db.ref(`rooms/${roomId}`).update(updateData);
    
    res.redirect("/dashboard?success=Đã gán thuê phòng thành công");
  } catch (error) {
    console.error("Error assigning tenant:", error);
    res.redirect("/dashboard?error=Lỗi khi gán thuê phòng");
  }
};

// Update room
const updateRoom = async (req, res) => {
  try {
    const { roomId, phoneNumber } = req.body;
    
    if (!roomId) {
      return res.status(400).json({ error: "Missing roomId" });
    }

    const roomRef = db.ref(`rooms/${roomId}`);
    const roomSnapshot = await roomRef.once("value");
    
    if (!roomSnapshot.exists()) {
      return res.status(404).json({ error: "Room not found" });
    }

    const updateData = {};
    if (phoneNumber !== undefined) {
      updateData.phone = formatPhoneNumber(phoneNumber);
      updateData.updatedAt = Date.now();
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
    
    if (!roomId) {
      return res.status(400).json({ error: "Missing roomId" });
    }

    const roomRef = db.ref(`rooms/${roomId}`);
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
    const roomsSnapshot = await db.ref("rooms").once("value");
    const roomsData = roomsSnapshot.val() || {};
    
    const phoneNumbers = Object.entries(roomsData)
      .filter(([roomId, roomInfo]) => roomInfo.phone && roomInfo.phone.trim())
      .map(([roomId, roomInfo]) => ({
        roomId,
        phoneNumber: formatPhoneNumber(roomInfo.phone)
      }));
    
    res.json(phoneNumbers);
  } catch (error) {
    console.error("Error fetching phone numbers:", error);
    res.status(500).json({ error: "Failed to fetch phone numbers" });
  }
};

module.exports = {
  getAvailableRooms,
  getRoomById,
  addRoom,
  assignTenant,
  updateRoom,
  deleteRoom,
  getPhoneNumbers
};