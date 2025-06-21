const { db } = require("../config/database");

// Helper function for default last data
function getDefaultLastData(nodeType) {
  switch (nodeType) {
    case "electricity":
      return { electric: 0, batt: 0, alerts: 0 };
    case "water":
      return { water: 0, batt: 0, alerts: 0 };
    case "custom":
      return { value: 0, batt: 0, alerts: 0 };
    default:
      return { value: 0, batt: 0, alerts: 0 };
  }
}

// Add new node
const addNode = async (req, res) => {
  try {
    const { roomId, nodeId, nodeType, customNodeType } = req.body;

    if (!roomId || !nodeId || !nodeType) {
      return res.redirect("/dashboard?error=Thiếu thông tin cần thiết");
    }

    // Kiểm tra phòng tồn tại
    const roomSnapshot = await db.ref(`rooms/${roomId}`).once("value");
    if (!roomSnapshot.exists()) {
      return res.redirect("/dashboard?error=Phòng không tồn tại");
    }

    // Kiểm tra node đã tồn tại
    const existingNodeSnapshot = await db.ref(`rooms/${roomId}/nodes/${nodeId}`).once("value");
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

    await db.ref(`rooms/${roomId}/nodes/${nodeId}`).set(nodeData);
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

    if (!roomId || !nodeId) {
      return res.redirect("/dashboard?error=Thiếu thông tin roomId hoặc nodeId");
    }

    // Kiểm tra phòng tồn tại
    const roomSnapshot = await db.ref(`rooms/${roomId}`).once("value");
    if (!roomSnapshot.exists()) {
      return res.redirect("/dashboard?error=Phòng không tồn tại");
    }

    // Kiểm tra node tồn tại
    const nodeSnapshot = await db.ref(`rooms/${roomId}/nodes/${nodeId}`).once("value");
    if (!nodeSnapshot.exists()) {
      return res.redirect("/dashboard?error=Node không tồn tại");
    }

    // Xóa node và history
    await db.ref(`rooms/${roomId}/nodes/${nodeId}`).remove();
    await db.ref(`rooms/${roomId}/history/${nodeId}`).remove();

    res.redirect("/dashboard?success=Xóa node thành công");
  } catch (error) {
    console.error("Lỗi khi xóa node:", error);
    res.redirect("/dashboard?error=Lỗi khi xóa node: " + error.message);
  }
};

// Update node
const updateNode = async (req, res) => {
  try {
    const { roomId, oldNodeId, newNodeId, customName } = req.body;

    if (!roomId || !oldNodeId || !newNodeId) {
      return res.redirect("/dashboard?error=Thiếu thông tin cần thiết");
    }

    // Kiểm tra phòng tồn tại
    const roomSnapshot = await db.ref(`rooms/${roomId}`).once("value");
    if (!roomSnapshot.exists()) {
      return res.redirect("/dashboard?error=Phòng không tồn tại");
    }

    // Kiểm tra node cũ tồn tại
    const oldNodeSnapshot = await db.ref(`rooms/${roomId}/nodes/${oldNodeId}`).once("value");
    if (!oldNodeSnapshot.exists()) {
      return res.redirect("/dashboard?error=Node không tồn tại");
    }

    // Nếu node ID thay đổi, kiểm tra node ID mới chưa tồn tại
    if (oldNodeId !== newNodeId) {
      const newNodeSnapshot = await db.ref(`rooms/${roomId}/nodes/${newNodeId}`).once("value");
      if (newNodeSnapshot.exists()) {
        return res.redirect("/dashboard?error=Node ID mới đã tồn tại");
      }
    }

    // Lấy dữ liệu node cũ
    const oldNodeData = oldNodeSnapshot.val();

    // Nếu node ID thay đổi, cần move node
    if (oldNodeId !== newNodeId) {
      // Tạo node mới với dữ liệu cũ
      const updatedNodeData = { ...oldNodeData };
      
      // Cập nhật custom name nếu có
      if (customName !== undefined) {
        updatedNodeData.customName = customName || null;
      }

      // Tạo node mới
      await db.ref(`rooms/${roomId}/nodes/${newNodeId}`).set(updatedNodeData);

      // Move history nếu có
      const historySnapshot = await db.ref(`rooms/${roomId}/history/${oldNodeId}`).once("value");
      if (historySnapshot.exists()) {
        await db.ref(`rooms/${roomId}/history/${newNodeId}`).set(historySnapshot.val());
        await db.ref(`rooms/${roomId}/history/${oldNodeId}`).remove();
      }

      // Xóa node cũ
      await db.ref(`rooms/${roomId}/nodes/${oldNodeId}`).remove();
    } else {
      // Chỉ cập nhật custom name
      const updateData = {};
      if (customName !== undefined) {
        updateData.customName = customName || null;
      }

      if (Object.keys(updateData).length > 0) {
        await db.ref(`rooms/${roomId}/nodes/${oldNodeId}`).update(updateData);
      }
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
  updateNode
};