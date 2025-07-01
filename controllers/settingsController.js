const { db } = require("../config/database");

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

const getSettings = async (req, res) => {
  try {
    const targetBuildingId = getTargetBuildingId(req);
    const buildings = {
      building_id_1: { name: "Tòa nhà A" },
      building_id_2: { name: "Tòa nhà B" }
    };

    // Lấy dữ liệu building từ Firebase
    const buildingSnapshot = await db.ref(`buildings/${targetBuildingId}`).once("value");
    const buildingData = buildingSnapshot.val() || {};

    // Lấy calibration data từ Firebase nodes
    const roomsSnapshot = await db.ref(`buildings/${targetBuildingId}/rooms`).once("value");
    const roomsData = roomsSnapshot.val() || {};

    // Chuẩn bị danh sách rooms cho dropdown
    const roomsList = Object.entries(roomsData).map(([roomId, roomData]) => ({
      id: roomId,
      name: `Phòng ${roomId}`,
      hasElectricity: roomData.nodes && Object.values(roomData.nodes).some(node => node.type === 'electricity'),
      hasWater: roomData.nodes && Object.values(roomData.nodes).some(node => node.type === 'water')
    }));

    // Tìm nodes điện và nước để lấy calibration data (lấy từ phòng đầu tiên có nodes)
    let electricityCalibration = { sensorValue: 0, actualValue: 0, calibrationFactor: 1.0, calibratedAt: null };
    let waterCalibration = { sensorValue: 0, actualValue: 0, calibrationFactor: 1.0, calibratedAt: null };

    // Ưu tiên lấy từ phòng đầu tiên có nodes
    const roomsWithNodes = roomsList.filter(room => room.hasElectricity || room.hasWater);
    const firstRoomWithNodes = roomsWithNodes[0];
    
    if (firstRoomWithNodes && roomsData[firstRoomWithNodes.id] && roomsData[firstRoomWithNodes.id].nodes) {
      Object.values(roomsData[firstRoomWithNodes.id].nodes).forEach(node => {
        if (node.type === 'electricity' && node.calibration) {
          electricityCalibration = node.calibration;
        } else if (node.type === 'water' && node.calibration) {
          waterCalibration = node.calibration;
        }
      });
    }

    // Lấy giá điện, giá nước và ngày cập nhật từ Firebase
    const currentSettings = {
      electricityPrice: buildingData.price_electric || 3000,
      waterPrice: buildingData.price_water || 15000,
      electricityUpdatedAt: buildingData.price_electric_updated_at || null,
      waterUpdatedAt: buildingData.price_water_updated_at || null,
      calibrationData: {
        electricity: electricityCalibration,
        water: waterCalibration
      },
      rooms: roomsList
    };

    console.log('Current pricing data:', {
      electricityPrice: currentSettings.electricityPrice,
      waterPrice: currentSettings.waterPrice,
      electricityUpdatedAt: currentSettings.electricityUpdatedAt,
      waterUpdatedAt: currentSettings.waterUpdatedAt
    });

    res.render("settings", {
      currentPage: "settings",
      admin: req.session.admin,
      buildings: req.session.admin?.role === 'super_admin' ? buildings : null,
      selectedBuildingId: targetBuildingId,
      currentSettings: currentSettings,
      targetBuildingId: targetBuildingId
    });

  } catch (error) {
    console.error("Error loading settings:", error);
    res.status(500).render("error", { 
      error: "Lỗi khi tải trang cài đặt: " + error.message 
    });
  }
};

// API để cập nhật calibration
const updateCalibration = async (req, res) => {
  try {
    const { type, sensorValue, actualValue } = req.body;
    const targetBuildingId = getTargetBuildingId(req);

    // Validation
    if (!type || !['electricity', 'water'].includes(type)) {
      return res.status(400).json({
        success: false,
        error: "Loại cảm biến không hợp lệ"
      });
    }

    if (typeof sensorValue !== 'number' || typeof actualValue !== 'number') {
      return res.status(400).json({
        success: false,
        error: "Giá trị số không hợp lệ"
      });
    }

    if (sensorValue <= 0 || actualValue <= 0) {
      return res.status(400).json({
        success: false,
        error: "Giá trị phải lớn hơn 0"
      });
    }

    const { roomId } = req.body;

    // Validation cho roomId
    if (!roomId) {
      return res.status(400).json({
        success: false,
        error: "Vui lòng chọn phòng"
      });
    }

    // Tính toán calibration factor
    const calibrationFactor = actualValue / sensorValue;

    // Lấy dữ liệu room cụ thể
    const roomSnapshot = await db.ref(`buildings/${targetBuildingId}/rooms/${roomId}`).once("value");
    const roomData = roomSnapshot.val();

    if (!roomData) {
      return res.status(400).json({
        success: false,
        error: "Phòng không tồn tại"
      });
    }

    // Tìm và cập nhật nodes của type tương ứng trong phòng này
    let updatedCount = 0;
    const calibrationData = {
      sensorValue,
      actualValue,
      calibrationFactor: parseFloat(calibrationFactor.toFixed(4)),
      calibratedAt: Date.now()
    };

    if (roomData.nodes) {
      for (const [nodeId, node] of Object.entries(roomData.nodes)) {
        if (node.type === type) {
          // Cập nhật calibration data cho node này
          await db.ref(`buildings/${targetBuildingId}/rooms/${roomId}/nodes/${nodeId}/calibration`).set(calibrationData);
          updatedCount++;
        }
      }
    }

    console.log(`📊 Calibration updated for ${targetBuildingId} room ${roomId}:`, {
      type,
      sensorValue,
      actualValue,
      calibrationFactor,
      nodesUpdated: updatedCount
    });

    res.json({
      success: true,
      message: `Đã cập nhật calibration ${type === 'electricity' ? 'điện' : 'nước'} cho phòng ${roomId} (${updatedCount} node)`,
      data: {
        type,
        roomId,
        sensorValue,
        actualValue,
        calibrationFactor: parseFloat(calibrationFactor.toFixed(4)),
        nodesUpdated: updatedCount
      }
    });

  } catch (error) {
    console.error("Error updating calibration:", error);
    res.status(500).json({
      success: false,
      error: "Lỗi khi cập nhật calibration: " + error.message
    });
  }
};

// API để cập nhật giá
const updatePricing = async (req, res) => {
  try {
    const { electricityPrice, waterPrice } = req.body;
    const targetBuildingId = getTargetBuildingId(req);

    // Validation
    if (typeof electricityPrice !== 'number' || typeof waterPrice !== 'number') {
      return res.status(400).json({
        success: false,
        error: "Giá trị không hợp lệ"
      });
    }

    if (electricityPrice <= 0 || waterPrice <= 0) {
      return res.status(400).json({
        success: false,
        error: "Giá phải lớn hơn 0"
      });
    }

    // Lấy dữ liệu hiện tại
    const buildingSnapshot = await db.ref(`buildings/${targetBuildingId}`).once("value");
    const buildingData = buildingSnapshot.val() || {};
    
    // Lấy giá và thời gian hiện tại
    const currentElectricityPrice = buildingData.price_electric || 0;
    const currentWaterPrice = buildingData.price_water || 0;
    const currentElectricityUpdatedAt = buildingData.price_electric_updated_at || null;
    const currentWaterUpdatedAt = buildingData.price_water_updated_at || null;
    
    const updatedAt = Date.now();
    const updates = {};
    
    // Chỉ cập nhật timestamp cho giá điện nếu giá điện thay đổi
    updates[`buildings/${targetBuildingId}/price_electric`] = electricityPrice;
    if (electricityPrice !== currentElectricityPrice) {
      updates[`buildings/${targetBuildingId}/price_electric_updated_at`] = updatedAt;
    }
    
    // Chỉ cập nhật timestamp cho giá nước nếu giá nước thay đổi
    updates[`buildings/${targetBuildingId}/price_water`] = waterPrice;
    if (waterPrice !== currentWaterPrice) {
      updates[`buildings/${targetBuildingId}/price_water_updated_at`] = updatedAt;
    }
    
    // Xóa trường cũ nếu có
    if (buildingData.price_updated_at) {
      updates[`buildings/${targetBuildingId}/price_updated_at`] = null;
    }

    await db.ref().update(updates);

    // Lấy timestamp mới nhất sau khi cập nhật
    const newElectricityUpdatedAt = (electricityPrice !== currentElectricityPrice) ? updatedAt : currentElectricityUpdatedAt;
    const newWaterUpdatedAt = (waterPrice !== currentWaterPrice) ? updatedAt : currentWaterUpdatedAt;

    console.log(`💰 Pricing update for ${targetBuildingId}:`, {
      electricityPrice,
      electricityUpdated: electricityPrice !== currentElectricityPrice,
      waterPrice,
      waterUpdated: waterPrice !== currentWaterPrice
    });

    res.json({
      success: true,
      message: "Đã cập nhật giá thành công",
      data: {
        electricityPrice,
        waterPrice,
        electricityUpdatedAt: newElectricityUpdatedAt,
        waterUpdatedAt: newWaterUpdatedAt
      }
    });

  } catch (error) {
    console.error("Error updating pricing:", error);
    res.status(500).json({
      success: false,
      error: "Lỗi khi cập nhật giá: " + error.message
    });
  }
};

// API để lấy calibration data của một phòng cụ thể
const getRoomCalibrationData = async (req, res) => {
  try {
    const { roomId } = req.params;
    const targetBuildingId = getTargetBuildingId(req);

    if (!roomId) {
      return res.status(400).json({
        success: false,
        error: "Thiếu roomId"
      });
    }

    // Lấy dữ liệu room cụ thể
    const roomSnapshot = await db.ref(`buildings/${targetBuildingId}/rooms/${roomId}`).once("value");
    const roomData = roomSnapshot.val();

    if (!roomData) {
      return res.status(404).json({
        success: false,
        error: "Phòng không tồn tại"
      });
    }

    // Tìm calibration data cho electricity và water
    let electricityCalibration = { sensorValue: 0, actualValue: 0, calibrationFactor: 1.0, calibratedAt: null };
    let waterCalibration = { sensorValue: 0, actualValue: 0, calibrationFactor: 1.0, calibratedAt: null };

    if (roomData.nodes) {
      Object.values(roomData.nodes).forEach(node => {
        if (node.type === 'electricity' && node.calibration) {
          electricityCalibration = node.calibration;
        } else if (node.type === 'water' && node.calibration) {
          waterCalibration = node.calibration;
        }
      });
    }

    res.json({
      success: true,
      data: {
        roomId,
        calibrationData: {
          electricity: electricityCalibration,
          water: waterCalibration
        }
      }
    });

  } catch (error) {
    console.error("Error loading room calibration data:", error);
    res.status(500).json({
      success: false,
      error: "Lỗi khi tải dữ liệu calibration: " + error.message
    });
  }
};

module.exports = {
  getSettings,
  updateCalibration,
  updatePricing,
  getRoomCalibrationData
}; 