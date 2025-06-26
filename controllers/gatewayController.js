const { db } = require("../config/database");

// Helper function to get target building ID
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

// Update gateway ID
const updateGateway = async (req, res) => {
  try {
    const { gatewayId } = req.body;
    const targetBuildingId = getTargetBuildingId(req);
    
    if (!gatewayId || !gatewayId.trim()) {
      return res.status(400).json({ 
        success: false,
        message: "Gateway ID không được để trống" 
      });
    }

    // Validate format
    const trimmedGatewayId = gatewayId.trim();
    if (!/^[a-zA-Z0-9\-_]+$/.test(trimmedGatewayId)) {
      return res.status(400).json({
        success: false,
        message: "Gateway ID chỉ được chứa chữ cái, số, dấu gạch ngang và gạch dưới"
      });
    }

    if (trimmedGatewayId.length < 3 || trimmedGatewayId.length > 50) {
      return res.status(400).json({
        success: false,
        message: "Gateway ID phải từ 3-50 ký tự"
      });
    }

    // Update gateway ID in database
    await db.ref(`buildings/${targetBuildingId}/gateway_id`).set(trimmedGatewayId);
    
    res.json({
      success: true,
      message: "Cập nhật Gateway ID thành công!",
      data: {
        gatewayId: trimmedGatewayId,
        buildingId: targetBuildingId
      }
    });
  } catch (error) {
    console.error("Error updating gateway ID:", error);
    res.status(500).json({
      success: false,
      message: "Lỗi khi cập nhật Gateway ID: " + error.message
    });
  }
};

// Get gateway ID
const getGateway = async (req, res) => {
  try {
    const targetBuildingId = getTargetBuildingId(req);
    
    const gatewaySnapshot = await db.ref(`buildings/${targetBuildingId}/gateway_id`).once("value");
    const gatewayId = gatewaySnapshot.val() || null;
    
    res.json({
      success: true,
      gatewayId: gatewayId,
      buildingId: targetBuildingId
    });
  } catch (error) {
    console.error("Error getting gateway ID:", error);
    res.status(500).json({
      success: false,
      message: "Lỗi khi lấy Gateway ID: " + error.message
    });
  }
};

// Delete Gateway ID
const deleteGateway = async (req, res) => {
  try {
    // Get building ID from session
    let targetBuildingId = 'building_id_1'; // default
    
    if (req.session.admin) {
      if (req.session.admin.role === 'admin') {
        targetBuildingId = req.session.admin.building_ids || 'building_id_1';
      } else if (req.session.admin.role === 'super_admin' && req.session.selectedBuildingId) {
        targetBuildingId = req.session.selectedBuildingId;
      }
    }
    
    // Delete gateway_id from Firebase
    await db.ref(`buildings/${targetBuildingId}/gateway_id`).remove();
    
    res.json({ 
      success: true, 
      message: 'Xóa Gateway ID thành công' 
    });
  } catch (error) {
    console.error('Error deleting gateway ID:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Lỗi server khi xóa Gateway ID' 
    });
  }
};

module.exports = {
  updateGateway,
  getGateway,
  deleteGateway
}; 