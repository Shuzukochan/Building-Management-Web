const { db } = require("../config/database");
const axios = require('axios');

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
    // Load buildings từ Firebase
    let buildings = {};
    try {
      const buildingsSnapshot = await db.ref('buildings').once('value');
      const buildingsData = buildingsSnapshot.val() || {};
      buildings = Object.fromEntries(
        Object.entries(buildingsData).map(([id, data]) => [id, { name: data.name || id }])
      );
    } catch (buildingError) {
      console.error('Error loading buildings in settings:', buildingError);
      // Fallback to default buildings
      buildings = {
      building_id_1: { name: "Tòa nhà A" },
      building_id_2: { name: "Tòa nhà B" }
    };
    }

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
      buildings,
      selectedBuildingId: req.session.selectedBuildingId,
      currentSettings: currentSettings,
      targetBuildingId: targetBuildingId,
      allRoomsData: roomsData
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
    const { 
      type, 
      roomId, 
      isInitialCalibration, 
      isErrorCorrection,
      offset,
      calibrationFactor,
      firstSensorValue,
      firstActualValue,
      currentSensorValue,
      currentMeterValue
    } = req.body;
    const targetBuildingId = getTargetBuildingId(req);

    // Validation
    if (!type || !['electricity', 'water'].includes(type)) {
      return res.status(400).json({
        success: false,
        error: "Loại cảm biến không hợp lệ"
      });
    }

    if (!roomId) {
      return res.status(400).json({
        success: false,
        error: "Vui lòng chọn phòng"
      });
    }

    // Validation cho hiệu chỉnh ban đầu
    if (isInitialCalibration) {
      if (typeof firstSensorValue !== 'number' || typeof firstActualValue !== 'number') {
        return res.status(400).json({
          success: false,
          error: "Giá trị sensor hoặc đồng hồ ban đầu không hợp lệ"
        });
      }

      if (firstSensorValue <= 0 || firstActualValue <= 0) {
        return res.status(400).json({
          success: false,
          error: "Giá trị phải lớn hơn 0"
        });
      }

      if (typeof offset !== 'number' || typeof calibrationFactor !== 'number') {
        return res.status(400).json({
          success: false,
          error: "Offset hoặc calibration factor không hợp lệ"
        });
      }
    }

    // Validation cho hiệu chỉnh sai số
    if (isErrorCorrection) {
      if (typeof currentSensorValue !== 'number' || typeof currentMeterValue !== 'number') {
        return res.status(400).json({
          success: false,
          error: "Giá trị sensor hoặc đồng hồ hiện tại không hợp lệ"
        });
      }

      if (currentSensorValue <= 0 || currentMeterValue <= 0) {
        return res.status(400).json({
          success: false,
          error: "Giá trị phải lớn hơn 0"
        });
      }

      if (typeof firstSensorValue !== 'number' || typeof firstActualValue !== 'number') {
        return res.status(400).json({
          success: false,
          error: "Thiếu dữ liệu hiệu chuẩn ban đầu"
        });
      }

      if (typeof offset !== 'number' || typeof calibrationFactor !== 'number') {
        return res.status(400).json({
          success: false,
          error: "Offset hoặc calibration factor không hợp lệ"
        });
      }
    }

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
    let calibrationData = {};

    if (isInitialCalibration) {
      // Hiệu chỉnh ban đầu
      calibrationData = {
        // Dữ liệu mới theo yêu cầu
        offset: parseFloat(offset.toFixed(4)),
        calibrationFactor: parseFloat(calibrationFactor.toFixed(4)),
        firstSensorValue: parseFloat(firstSensorValue.toFixed(4)),
        firstActualValue: parseFloat(firstActualValue.toFixed(4)),
        calibratedAt: Date.now(),
        
        // Giữ tương thích ngược với UI cũ
        sensorValue: parseFloat(firstSensorValue.toFixed(4)),
        actualValue: parseFloat(firstActualValue.toFixed(4))
      };
    } else if (isErrorCorrection) {
      // Hiệu chỉnh sai số
      calibrationData = {
        // Dữ liệu mới theo yêu cầu
        offset: parseFloat(offset.toFixed(4)),
        calibrationFactor: parseFloat(calibrationFactor.toFixed(4)),
        firstSensorValue: parseFloat(firstSensorValue.toFixed(4)),
        firstActualValue: parseFloat(firstActualValue.toFixed(4)),
        lastSensorValue: parseFloat(currentSensorValue.toFixed(4)),
        lastMeterValue: parseFloat(currentMeterValue.toFixed(4)),
        calibratedAt: Date.now(),
        
        // Giữ tương thích ngược với UI cũ
        sensorValue: parseFloat(firstSensorValue.toFixed(4)),
        actualValue: parseFloat(firstActualValue.toFixed(4))
      };
    }

    if (roomData.nodes) {
      for (const [nodeId, node] of Object.entries(roomData.nodes)) {
        if (node.type === type) {
          // Log dữ liệu trước khi lưu
          console.log(`🔄 Saving calibration to Firebase for node ${nodeId}:`, JSON.stringify(calibrationData, null, 2));
          
          // Cập nhật calibration data cho node này
          await db.ref(`buildings/${targetBuildingId}/rooms/${roomId}/nodes/${nodeId}/calibration`).set(calibrationData);
          updatedCount++;
          
          // Log xác nhận đã lưu
          console.log(`✅ Calibration saved successfully for node ${nodeId}`);
        }
      }
    }

    console.log(`📊 Calibration updated for ${targetBuildingId} room ${roomId}:`, {
      type,
      calibrationType: isInitialCalibration ? 'initial' : 'error_correction',
      offset,
      calibrationFactor,
      firstSensorValue,
      firstActualValue,
      currentSensorValue: currentSensorValue || null,
      currentMeterValue: currentMeterValue || null,
      nodesUpdated: updatedCount
    });

    res.json({
      success: true,
      message: `Đã cập nhật hiệu chuẩn ${type === 'electricity' ? 'điện' : 'nước'} cho phòng ${roomId} (${updatedCount} node)`,
      data: {
        type,
        roomId,
        offset: parseFloat(offset.toFixed(4)),
        calibrationFactor: parseFloat(calibrationFactor.toFixed(4)),
        firstSensorValue: parseFloat(firstSensorValue.toFixed(4)),
        firstActualValue: parseFloat(firstActualValue.toFixed(4)),
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
    let electricityCalibration = { 
      offset: 0,
      calibrationFactor: 1.0, 
      firstSensorValue: undefined,
      firstActualValue: undefined,
      sensorValue: 0, // Keep for backward compatibility
      actualValue: 0, // Keep for backward compatibility
      calibratedAt: null 
    };
    let waterCalibration = { 
      offset: 0,
      calibrationFactor: 1.0, 
      firstSensorValue: undefined,
      firstActualValue: undefined,
      sensorValue: 0, // Keep for backward compatibility
      actualValue: 0, // Keep for backward compatibility
      calibratedAt: null 
    };
    
    // Tìm lastData cho water và electricity
    let electricityLastData = null;
    let waterLastData = null;

    if (roomData.nodes) {
      Object.values(roomData.nodes).forEach(node => {
        if (node.type === 'electricity' && node.calibration) {
          electricityCalibration = {
            ...electricityCalibration,
            ...node.calibration,
            // Ensure backward compatibility
            sensorValue: node.calibration.firstSensorValue || node.calibration.sensorValue || 0,
            actualValue: node.calibration.firstActualValue || node.calibration.actualValue || 0
          };
          electricityLastData = node.lastData;
        } else if (node.type === 'water' && node.calibration) {
          waterCalibration = {
            ...waterCalibration,
            ...node.calibration,
            // Ensure backward compatibility
            sensorValue: node.calibration.firstSensorValue || node.calibration.sensorValue || 0,
            actualValue: node.calibration.firstActualValue || node.calibration.actualValue || 0
          };
          waterLastData = node.lastData;
        }
        // Nếu chưa có calibration thì vẫn lấy lastData
        if (node.type === 'electricity' && !electricityLastData && node.lastData) {
          electricityLastData = node.lastData;
        }
        if (node.type === 'water' && !waterLastData && node.lastData) {
          waterLastData = node.lastData;
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
        },
        lastData: {
          electricity: electricityLastData,
          water: waterLastData
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

// API để đặt chu kỳ gửi dữ liệu cho node
const setNodePeriod = async (req, res) => {
  try {
    const { nodeId, periodSeconds } = req.body;

    if (!nodeId || !periodSeconds || periodSeconds <= 0) {
      return res.status(400).json({ success: false, error: 'Thiếu nodeId hoặc periodSeconds không hợp lệ' });
    }

    const periodMs = periodSeconds * 1000;
    const base64Data = Buffer.from(`period:${periodMs}`, 'utf8').toString('base64');

    const payload = {
      queueItem: {
        confirmed: false,
        data: base64Data,
        fPort: 2
      }
    };

    // Debug log
    console.log(`🚀 Sending node period`, { nodeId, periodSeconds, periodMs, base64Data });

    const apiToken = process.env.NODE_QUEUE_API_TOKEN;
    if (!apiToken) {
      return res.status(500).json({ success: false, error: 'Thiếu NODE_QUEUE_API_TOKEN trong .env' });
    }

    const url = `https://api.shuzuko.id.vn/api/devices/${nodeId}/queue`;
    const response = await axios.post(url, payload, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiToken}`
      }
    });

    if (response.status >= 200 && response.status < 300) {
      return res.json({ success: true, message: 'Thiết lập chu kỳ thành công!' });
    } else {
      return res.status(response.status).json({ success: false, error: 'Gửi thất bại', data: response.data });
    }
  } catch (error) {
    console.error('Error setting node period:', error);
    return res.status(500).json({ success: false, error: 'Lỗi server: ' + error.message });
  }
};

// API để cập nhật calibration cho nước (hỗ trợ cả logic cũ và mới)
const updateWaterCalibration = async (req, res) => {
  try {
    const { type, isInitialCalibration, isErrorCorrection, offset, calibrationFactor, firstSensorValue, firstActualValue, currentSensorValue, currentMeterValue, sensorValue, actualValue, currentRawSensorValue, initialMeterValue } = req.body;
    const targetBuildingId = getTargetBuildingId(req);

    // Force type to water
    const calibrationType = 'water';
    const { roomId } = req.body;

    // Validation cho roomId
    if (!roomId) {
      return res.status(400).json({
        success: false,
        error: "Vui lòng chọn phòng"
      });
    }

    let calibrationData;

    if (isInitialCalibration) {
      // Logic mới cho hiệu chuẩn ban đầu nước
      console.log('🆕 Processing water initial calibration');

      // Validation cho initial calibration
      if (typeof initialMeterValue !== 'number' || initialMeterValue <= 0) {
        return res.status(400).json({
          success: false,
          error: "Giá trị đồng hồ ban đầu không hợp lệ"
        });
      }

      calibrationData = {
        offset: 0, // Ban đầu offset = 0
        calibrationFactor: 1, // Ban đầu calibrationFactor = 1  
        firstSensorValue: initialMeterValue, // Cảm biến sẽ được set thành giá trị này
        firstActualValue: initialMeterValue, // Giá trị đồng hồ người dùng nhập
        initialMeterValue: initialMeterValue, // Lưu giá trị ban đầu
        calibratedAt: Date.now(),
        // Backward compatibility
        sensorValue: initialMeterValue,
        actualValue: initialMeterValue
      };

    } else if (isErrorCorrection) {
      // Logic mới cho hiệu chuẩn sai số
      console.log('🆕 Processing water error correction calibration');

      // Validation cho error correction
      if (typeof offset !== 'number' || typeof calibrationFactor !== 'number' ||
          typeof firstSensorValue !== 'number' || typeof firstActualValue !== 'number' ||
          typeof currentSensorValue !== 'number' || typeof currentMeterValue !== 'number') {
        return res.status(400).json({
          success: false,
          error: "Dữ liệu hiệu chuẩn sai số không hợp lệ"
        });
      }

      calibrationData = {
        offset: parseFloat(offset.toFixed(4)),
        calibrationFactor: parseFloat(calibrationFactor.toFixed(4)),
        firstSensorValue,
        firstActualValue,
        lastSensorValue: currentSensorValue,
        lastMeterValue: currentMeterValue,
        calibratedAt: Date.now(),
        // Backward compatibility
        sensorValue: firstSensorValue,
        actualValue: firstActualValue
      };

    } else {
      // Logic cũ
      console.log('🔄 Processing water calibration (old logic)');

      // Validation
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

      // Validation đặc biệt cho nước
      if (currentRawSensorValue && typeof currentRawSensorValue !== 'number') {
        return res.status(400).json({
          success: false,
          error: "Giá trị cảm biến thực tế hiện tại không hợp lệ"
        });
      }

      // Tính toán calibration factor (logic cũ)
      let calculatedCalibrationFactor;
      if (currentRawSensorValue && currentRawSensorValue > 0) {
        // Đối với nước có lastData: sử dụng giá trị thô của cảm biến
        calculatedCalibrationFactor = actualValue / currentRawSensorValue;
      } else {
        // Đối với nước chưa có lastData: sử dụng sensorValue
        calculatedCalibrationFactor = actualValue / sensorValue;
      }

      calibrationData = {
        sensorValue,
        actualValue,
        calibrationFactor: parseFloat(calculatedCalibrationFactor.toFixed(4)),
        calibratedAt: Date.now()
      };

      // Thêm currentRawSensorValue vào calibrationData nếu có
      if (currentRawSensorValue) {
        calibrationData.currentRawSensorValue = currentRawSensorValue;
      }
    }

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

    if (roomData.nodes) {
      for (const [nodeId, node] of Object.entries(roomData.nodes)) {
        if (node.type === calibrationType) {
          // Log dữ liệu trước khi lưu
          console.log(`🔄 Saving water calibration to Firebase for node ${nodeId}:`, JSON.stringify(calibrationData, null, 2));
          
          // Cập nhật calibration data cho node này
          await db.ref(`buildings/${targetBuildingId}/rooms/${roomId}/nodes/${nodeId}/calibration`).set(calibrationData);
          updatedCount++;
          
          // Log xác nhận đã lưu
          console.log(`✅ Water calibration saved successfully for node ${nodeId}`);
        }
      }
    }

    let logData;
    
    if (isInitialCalibration) {
      logData = {
        type: calibrationType,
        isInitialCalibration: true,
        initialMeterValue,
        offset: 0,
        calibrationFactor: 1,
        firstSensorValue: initialMeterValue,
        firstActualValue: initialMeterValue,
        nodesUpdated: updatedCount
      };
    } else if (isErrorCorrection) {
      logData = {
        type: calibrationType,
        isErrorCorrection: true,
        offset,
        calibrationFactor,
        firstSensorValue,
        firstActualValue,
        currentSensorValue,
        currentMeterValue,
        nodesUpdated: updatedCount
      };
    } else {
      logData = {
        type: calibrationType,
        sensorValue,
        actualValue,
        currentRawSensorValue: currentRawSensorValue || 'N/A',
        useDisplayValue: req.body.useDisplayValue || false,
        calculationMethod: currentRawSensorValue ? 'Raw sensor value' : 'Display value',
        calibrationFactor: calibrationData.calibrationFactor,
        nodesUpdated: updatedCount
      };
    }

    console.log(`📊 Water Calibration updated for ${targetBuildingId} room ${roomId}:`, logData);

    let message;
    if (isInitialCalibration) {
      message = `Đã lưu hiệu chuẩn ban đầu nước cho phòng ${roomId} (${updatedCount} node)`;
    } else if (isErrorCorrection) {
      message = `Đã cập nhật hiệu chuẩn sai số nước cho phòng ${roomId} (${updatedCount} node)`;
    } else {
      message = `Đã cập nhật calibration nước cho phòng ${roomId} (${updatedCount} node)`;
    }

    res.json({
      success: true,
      message: message,
      data: {
        type: calibrationType,
        roomId,
        ...calibrationData,
        nodesUpdated: updatedCount
      }
    });

  } catch (error) {
    console.error("Error updating water calibration:", error);
    res.status(500).json({
      success: false,
      error: "Lỗi khi cập nhật calibration nước: " + error.message
    });
  }
};

// API để gửi hiệu chuẩn ban đầu nước (sử dụng logic setNodePeriod)
const setWaterInitialCalibration = async (req, res) => {
  try {
    const { nodeId, waterValue } = req.body;

    if (!nodeId || !waterValue || waterValue <= 0) {
      return res.status(400).json({ success: false, error: 'Thiếu nodeId hoặc waterValue không hợp lệ' });
    }

    // Tạo base64 data giống như setNodePeriod nhưng dùng water:value
    const base64Data = Buffer.from(`water:${waterValue}`, 'utf8').toString('base64');

    const payload = {
      queueItem: {
        confirmed: false,
        data: base64Data,
        fPort: 2
      }
    };

    // Debug log
    console.log(`🚀 Sending water initial calibration`, { nodeId, waterValue, base64Data });

    const apiToken = process.env.NODE_QUEUE_API_TOKEN;
    if (!apiToken) {
      return res.status(500).json({ success: false, error: 'Thiếu NODE_QUEUE_API_TOKEN trong .env' });
    }

    const url = `https://api.shuzuko.id.vn/api/devices/${nodeId}/queue`;
    const response = await axios.post(url, payload, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiToken}`
      }
    });

    if (response.status >= 200 && response.status < 300) {
      return res.json({ success: true, message: 'Gửi lệnh hiệu chuẩn ban đầu nước thành công!' });
    } else {
      return res.status(response.status).json({ success: false, error: 'Gửi thất bại', data: response.data });
    }
  } catch (error) {
    console.error('Error setting water initial calibration:', error);
    return res.status(500).json({ success: false, error: 'Lỗi server: ' + error.message });
  }
};

module.exports = {
  getSettings,
  updateCalibration,
  updateWaterCalibration,
  updatePricing,
  getRoomCalibrationData,
  setNodePeriod,
  setWaterInitialCalibration
}; 