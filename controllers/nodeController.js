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

// Helper function for default last data
function getDefaultLastData(nodeType) {
  switch (nodeType) {
    case "electricity":
      return { electric: 0, batt: 0, current: 0 };
    case "water":
      return { water: 0, batt: 0 };
    case "custom":
      return { value: 0, batt: 0, alerts: 0 };
    default:
      return {};
  }
}

// Add new node
const addNode = async (req, res) => {
  try {
    const { roomId, nodeId, nodeType, customNodeType } = req.body;
    const targetBuildingId = getTargetBuildingId(req);

    if (!roomId || !nodeId || !nodeType) {
      return res.redirect("/dashboard?error=Thiếu thông tin cần thiết");
    }

    // Kiểm tra phòng tồn tại
    const roomSnapshot = await db.ref(`buildings/${targetBuildingId}/rooms/${roomId}`).once("value");
    if (!roomSnapshot.exists()) {
      return res.redirect("/dashboard?error=Phòng không tồn tại");
    }

    // Kiểm tra node đã tồn tại
    const existingNodeSnapshot = await db.ref(`buildings/${targetBuildingId}/rooms/${roomId}/nodes/${nodeId}`).once("value");
    if (existingNodeSnapshot.exists()) {
      return res.redirect("/dashboard?error=Node đã tồn tại");
    }

    // Xử lý node type
    let finalNodeType = nodeType;
    let customName = null;
    
    if (nodeType === "custom") {
      if (!customNodeType || !customNodeType.trim()) {
        return res.redirect("/dashboard?error=Vui lòng nhập tên loại node tùy chỉnh");
      }
      customName = customNodeType.trim();
    }

    // Tạo dữ liệu node
    const nodeData = {
      type: finalNodeType,
      customName: customName,
      lastData: getDefaultLastData(finalNodeType),
      history: {}
    };

    await db.ref(`buildings/${targetBuildingId}/rooms/${roomId}/nodes/${nodeId}`).set(nodeData);
    res.redirect("/dashboard?success=Thêm node thành công");
  } catch (error) {
    console.error("Lỗi khi thêm node:", error);
    res.redirect("/dashboard?error=Lỗi khi thêm node: " + error.message);
  }
};

// Delete node
const deleteNode = async (req, res) => {
  try {
    const { roomId, nodeId } = req.body;
    const targetBuildingId = getTargetBuildingId(req);

    if (!roomId || !nodeId) {
      return res.redirect("/dashboard?error=Thiếu thông tin cần thiết");
    }

    // Kiểm tra phòng tồn tại
    const roomSnapshot = await db.ref(`buildings/${targetBuildingId}/rooms/${roomId}`).once("value");
    if (!roomSnapshot.exists()) {
      return res.redirect("/dashboard?error=Phòng không tồn tại");
    }

    // Kiểm tra node tồn tại
    const nodeSnapshot = await db.ref(`buildings/${targetBuildingId}/rooms/${roomId}/nodes/${nodeId}`).once("value");
    if (!nodeSnapshot.exists()) {
      return res.redirect("/dashboard?error=Node không tồn tại");
    }

    // Xóa node và history
    await db.ref(`buildings/${targetBuildingId}/rooms/${roomId}/nodes/${nodeId}`).remove();
    await db.ref(`buildings/${targetBuildingId}/rooms/${roomId}/history/${nodeId}`).remove();
    
    res.redirect("/dashboard?success=Xóa node thành công");
  } catch (error) {
    console.error("Lỗi khi xóa node:", error);
    res.redirect("/dashboard?error=Lỗi khi xóa node: " + error.message);
  }
};

// Edit node
const editNode = async (req, res) => {
  try {
    const { roomId, oldNodeId, newNodeId, nodeType, customNodeType } = req.body;
    const targetBuildingId = getTargetBuildingId(req);

    if (!roomId || !oldNodeId || !newNodeId || !nodeType) {
      return res.redirect("/dashboard?error=Thiếu thông tin cần thiết");
    }

    // Kiểm tra phòng tồn tại
    const roomSnapshot = await db.ref(`buildings/${targetBuildingId}/rooms/${roomId}`).once("value");
    if (!roomSnapshot.exists()) {
      return res.redirect("/dashboard?error=Phòng không tồn tại");
    }

    // Kiểm tra node cũ tồn tại
    const oldNodeSnapshot = await db.ref(`buildings/${targetBuildingId}/rooms/${roomId}/nodes/${oldNodeId}`).once("value");
    if (!oldNodeSnapshot.exists()) {
      return res.redirect("/dashboard?error=Node cũ không tồn tại");
    }

    // Nếu đổi tên node, kiểm tra tên mới không trùng (trừ khi giữ nguyên tên)
    if (oldNodeId !== newNodeId) {
      const newNodeSnapshot = await db.ref(`buildings/${targetBuildingId}/rooms/${roomId}/nodes/${newNodeId}`).once("value");
      if (newNodeSnapshot.exists()) {
        return res.redirect("/dashboard?error=Tên node mới đã tồn tại");
      }
    }

    // Xử lý node type và custom name
    let finalNodeType = nodeType;
    let customName = null;
    
    if (nodeType === "custom") {
      if (!customNodeType || !customNodeType.trim()) {
        return res.redirect("/dashboard?error=Vui lòng nhập tên loại node tùy chỉnh");
      }
      customName = customNodeType.trim();
    }

    // Lấy dữ liệu node cũ và cập nhật
    const oldNodeData = oldNodeSnapshot.val();
    const updatedNodeData = {
      ...oldNodeData,
      type: finalNodeType,
      customName: customName,
      lastData: oldNodeData.lastData || getDefaultLastData(finalNodeType)
    };

    // Nếu đổi tên node
    if (oldNodeId !== newNodeId) {
      // Tạo node mới với dữ liệu cập nhật
      await db.ref(`buildings/${targetBuildingId}/rooms/${roomId}/nodes/${newNodeId}`).set(updatedNodeData);
      
      // Copy history nếu có
      const historySnapshot = await db.ref(`buildings/${targetBuildingId}/rooms/${roomId}/history/${oldNodeId}`).once("value");
      if (historySnapshot.exists()) {
        await db.ref(`buildings/${targetBuildingId}/rooms/${roomId}/history/${newNodeId}`).set(historySnapshot.val());
        await db.ref(`buildings/${targetBuildingId}/rooms/${roomId}/history/${oldNodeId}`).remove();
      }
      
      // Xóa node cũ
      await db.ref(`buildings/${targetBuildingId}/rooms/${roomId}/nodes/${oldNodeId}`).remove();
    } else {
      // Chỉ cập nhật thông tin node
      const updateData = {
        type: finalNodeType,
        customName: customName
      };
      await db.ref(`buildings/${targetBuildingId}/rooms/${roomId}/nodes/${oldNodeId}`).update(updateData);
    }

    res.redirect("/dashboard?success=Cập nhật node thành công");
  } catch (error) {
    console.error("Lỗi khi cập nhật node:", error);
    res.redirect("/dashboard?error=Lỗi khi cập nhật node: " + error.message);
  }
};

module.exports = {
  addNode,
  deleteNode,
  editNode
};