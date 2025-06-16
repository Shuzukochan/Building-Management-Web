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
    const { roomId, nodeId, nodeType, customNodeType } = req.body;

    if (!roomId || !nodeId || !nodeType) {
      return res.redirect("/dashboard?error=Thiếu thông tin cần thiết");
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

    // Xử lý node type
    let finalNodeType = nodeType;
    let customName = null;
    
    if (nodeType === "custom") {
      if (!customNodeType || !customNodeType.trim()) {
        return res.redirect("/dashboard?error=Vui lòng nhập tên loại node tùy chỉnh");
      }
      customName = customNodeType.trim();
    }

    // Cập nhật node data
    const updateData = {
      type: finalNodeType,
      customName: customName
    };

    await db.ref(`rooms/${roomId}/nodes/${nodeId}`).update(updateData);
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