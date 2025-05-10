const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const admin = require('firebase-admin');
const path = require('path');

const app = express();
const PORT = 3000;

const serviceAccount = require('./firebase-admin.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://building-managerment-firebase-default-rtdb.asia-southeast1.firebasedatabase.app"
});

app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
  secret: 'secret-key',
  resave: false,
  saveUninitialized: true
}));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'admin';

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
    res.send('Sai tài khoản hoặc mật khẩu. <a href="/">Thử lại</a>');
  }
});

app.get('/dashboard', async (req, res) => {
  if (!req.session.loggedIn) return res.redirect('/');

  try {
    const usersResult = await admin.auth().listUsers(1000);
    const roomSnap = await admin.database().ref("rooms").once("value");
    const roomData = roomSnap.val() || {};

    const users = usersResult.users.map(user => {
      const phone = user.phoneNumber || '';
      let roomFound = '';
      let nodes = [];

      for (const [roomName, info] of Object.entries(roomData)) {
        if (info.phone === phone) {
          roomFound = roomName;
          if (info.nodes) {
            nodes = Object.keys(info.nodes);
          }
          break;
        }
      }

      return {
        phone,
        room: roomFound,
        nodes
      };
    });

    res.render('dashboard', { users, waterHistory: {}, electricHistory: {} });
  } catch (err) {
    res.send('Lỗi khi tải dữ liệu: ' + err.message);
  }
});

app.post('/set-room', async (req, res) => {
    const { room, phone } = req.body;
    if (!req.session.loggedIn) return res.redirect('/');
  
    try {
      const db = admin.database();
      const roomsRef = db.ref("rooms");
  
      const snapshot = await roomsRef.once("value");
      const rooms = snapshot.val() || {};
  
      for (const [roomName, data] of Object.entries(rooms)) {
        if (data.phone === phone && roomName !== room) {
          await roomsRef.child(room).set({
            ...data,
            phone,
          });
  
          await roomsRef.child(roomName).remove();
  
          return res.redirect('/dashboard');
        }
      }
  
      await roomsRef.child(room).update({ phone });
  
      res.redirect('/dashboard');
    } catch (err) {
      res.send('Lỗi khi lưu dữ liệu: ' + err.message);
    }
  });

app.post('/add-node', async (req, res) => {
  const { room, nodeId } = req.body;
  if (!req.session.loggedIn) return res.redirect('/');

  console.log('DEBUG /add-node:', { room, nodeId });

  if (!room || !nodeId) {
    console.log('Thiếu thông tin phòng hoặc nodeId!');
    return res.send('Thiếu thông tin phòng hoặc nodeId!');
  }

  try {
    const db = admin.database();
    const roomRef = db.ref(`rooms/${room}`);
    const roomSnap = await roomRef.once('value');
    console.log('DEBUG roomSnap.exists:', roomSnap.exists());
    if (!roomSnap.exists()) {
      console.log('Phòng không tồn tại!');
      return res.send('Phòng không tồn tại!');
    }
    const nodeRef = db.ref(`rooms/${room}/nodes/${nodeId}`);
    await nodeRef.set({
      history: {},
      lastData: {
        alerts: 0,
        batt: 0,
        water: 0
      }
    });
    console.log('Đã thêm node thành công');
    res.redirect('/dashboard');
  } catch (err) {
    console.log('Lỗi khi thêm node:', err);
    res.send('Lỗi khi thêm node: ' + err.message);
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

app.get('/statistic', async (req, res) => {
  if (!req.session.loggedIn) return res.redirect('/');
  let { phone, fromElectric, toElectric, fromWater, toWater, viewTypeElectric = 'day', viewTypeWater = 'day', fromMonthElectric, fromYearElectric, toMonthElectric, toYearElectric, fromMonthWater, fromYearWater, toMonthWater, toYearWater } = req.query;
  console.log('fromElectric:', fromElectric, 'toElectric:', toElectric, 'fromWater:', fromWater, 'toWater:', toWater);
  const now = new Date();
  const minYear = now.getFullYear() - 5;
  const maxYear = now.getFullYear() + 1;
  const roomSnap = await admin.database().ref("rooms").once("value");
  const roomData = roomSnap.val() || {};
  const phoneList = Object.values(roomData).map(r => r.phone).filter(Boolean);

  let waterHistory = {};
  let electricHistory = {};
  let selectedPhone = phone;

  // Khai báo tất cả các biến tháng/năm và mảng tháng ở đầu hàm để tránh ReferenceError
  let fromMonthElectricValue = fromMonthElectric;
  let fromYearElectricValue = fromYearElectric;
  let toMonthElectricValue = toMonthElectric;
  let toYearElectricValue = toYearElectric;
  let fromMonthWaterValue = fromMonthWater;
  let fromYearWaterValue = fromYearWater;
  let toMonthWaterValue = toMonthWater;
  let toYearWaterValue = toYearWater;
  let monthRangeElectric = [];
  let monthRangeWater = [];

  // Đảm bảo luôn gán giá trị cho monthRangeElectric và monthRangeWater ở đầu hàm khi ở chế độ tháng
  if (viewTypeElectric === 'month' && monthRangeElectric.length === 0) {
    if (fromMonthElectric && toMonthElectric && fromYearElectric && toYearElectric) {
      let from = new Date(`${fromYearElectric}-${fromMonthElectric}-01`);
      let to = new Date(`${toYearElectric}-${toMonthElectric}-01`);
      while (from <= to) {
        let yyyy = from.getFullYear();
        let mm = (from.getMonth() + 1).toString().padStart(2, '0');
        monthRangeElectric.push(`${yyyy}-${mm}`);
        from.setMonth(from.getMonth() + 1);
      }
    } else {
      monthRangeElectric = getLastNMonths(10);
      fromMonthElectricValue = monthRangeElectric[0].slice(5,7);
      fromYearElectricValue = monthRangeElectric[0].slice(0,4);
      toMonthElectricValue = monthRangeElectric[monthRangeElectric.length-1].slice(5,7);
      toYearElectricValue = monthRangeElectric[monthRangeElectric.length-1].slice(0,4);
    }
  }
  if (viewTypeWater === 'month' && monthRangeWater.length === 0) {
    if (fromMonthWater && toMonthWater && fromYearWater && toYearWater) {
      let from = new Date(`${fromYearWater}-${fromMonthWater}-01`);
      let to = new Date(`${toYearWater}-${toMonthWater}-01`);
      while (from <= to) {
        let yyyy = from.getFullYear();
        let mm = (from.getMonth() + 1).toString().padStart(2, '0');
        monthRangeWater.push(`${yyyy}-${mm}`);
        from.setMonth(from.getMonth() + 1);
      }
    } else {
      monthRangeWater = getLastNMonths(10);
      fromMonthWaterValue = monthRangeWater[0].slice(5,7);
      fromYearWaterValue = monthRangeWater[0].slice(0,4);
      toMonthWaterValue = monthRangeWater[monthRangeWater.length-1].slice(5,7);
      toYearWaterValue = monthRangeWater[monthRangeWater.length-1].slice(0,4);
    }
  }

  function isInRange(date, from, to) {
    if (!from && !to) return true;
    if (from && date < from) return false;
    if (to && date > to) return false;
    return true;
  }

  let _fromElectric = fromElectric;
  let _toElectric = toElectric;
  let _fromWater = fromWater;
  let _toWater = toWater;
  if (viewTypeElectric === 'day' && (!_fromElectric || !_toElectric)) {
    let last10 = getLastNDays(10);
    _fromElectric = last10[0];
    _toElectric = last10[last10.length - 1];
  }
  if (viewTypeWater === 'day' && (!_fromWater || !_toWater)) {
    let last10 = getLastNDays(10);
    _fromWater = last10[0];
    _toWater = last10[last10.length - 1];
  }

  // Nếu có phone mà thiếu fromWater/toWater thì tự động lấy 10 ngày gần nhất cho nước
  if (phone && (!fromWater || !toWater)) {
    let last10 = getLastNDays(10);
    _fromWater = last10[0];
    _toWater = last10[last10.length - 1];
    fromWater = last10[0];
    toWater = last10[last10.length - 1];
  }
  if (phone && (!fromElectric || !toElectric)) {
    let last10 = getLastNDays(10);
    _fromElectric = last10[0];
    _toElectric = last10[last10.length - 1];
    fromElectric = last10[0];
    toElectric = last10[last10.length - 1];
  }

  function getLastNMonths(n) {
    let arr = [];
    let d = new Date();
    for (let i = n - 1; i >= 0; i--) {
      let year = d.getFullYear();
      let month = d.getMonth() + 1 - i;
      while (month <= 0) {
        month += 12;
        year--;
      }
      arr.push(`${year}-${month.toString().padStart(2, '0')}`);
    }
    return arr;
  }

  function getLastNDays(n) {
    let arr = [];
    // Lấy thời gian hiện tại theo múi giờ Việt Nam
    let today = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));
    for (let i = n - 1; i >= 0; i--) {
      let d = new Date(today);
      d.setDate(d.getDate() - i);
      let yyyy = d.getFullYear();
      let mm = (d.getMonth() + 1).toString().padStart(2, '0');
      let dd = d.getDate().toString().padStart(2, '0');
      arr.push(`${yyyy}-${mm}-${dd}`);
    }
    return arr;
  }

  function getDateRange(from, to) {
    let arr = [];
    if (!from || !to) return arr;
    let d1 = new Date(from);
    let d2 = new Date(to);
    while (d1 <= d2) {
      let yyyy = d1.getFullYear();
      let mm = (d1.getMonth() + 1).toString().padStart(2, '0');
      let dd = d1.getDate().toString().padStart(2, '0');
      arr.push(`${yyyy}-${mm}-${dd}`);
      d1.setDate(d1.getDate() + 1);
    }
    return arr;
  }

  // Hàm tổng hợp dữ liệu theo tháng, trả về nhãn 'mm/yy' và giá trị là chênh lệch chỉ số đầu-cuối tháng (hoặc 0 nếu không có dữ liệu)
  function calcMonthDiffs(history, monthRange) {
    let result = {};
    for (let m of monthRange) {
      let label = m.slice(5,7) + '/' + m.slice(2,4); // mm/yy
      let daysInMonth = Object.keys(history || {}).filter(d => d.startsWith(m));
      if (daysInMonth.length >= 2) {
        // Tìm giá trị lớn nhất và nhỏ nhất trong tháng
        let electricValues = daysInMonth.map(d => history[d].electric).filter(v => v !== undefined);
        let waterValues = daysInMonth.map(d => history[d].water).filter(v => v !== undefined);
        let diffElectric = 0;
        let diffWater = 0;
        if (electricValues.length >= 2) {
          diffElectric = Math.max(...electricValues) - Math.min(...electricValues);
        }
        if (waterValues.length >= 2) {
          diffWater = Math.max(...waterValues) - Math.min(...waterValues);
        }
        result[label] = { electric: diffElectric, water: diffWater };
      } else if (daysInMonth.length === 1) {
        let only = daysInMonth[0];
        let vOnly = history[only];
        result[label] = {
          electric: vOnly.electric !== undefined ? vOnly.electric : 0,
          water: vOnly.water !== undefined ? vOnly.water : 0
        };
      } else {
        result[label] = { electric: 0, water: 0 };
      }
    }
    return result;
  }

  if (phone) {
    // Tìm room chứa phone này
    let foundRoom = null;
    for (const [roomName, info] of Object.entries(roomData)) {
      if (info.phone === phone) {
        foundRoom = info;
        break;
      }
    }
    if (foundRoom && foundRoom.nodes) {
      // Lấy nodeId đầu tiên (hoặc node bất kỳ)
      const nodeIds = Object.keys(foundRoom.nodes);
      if (nodeIds.length > 0) {
        const nodeData = foundRoom.nodes[nodeIds[0]];
        if (nodeData.history) {
          // Lấy tất cả ngày có trong history
          const allDates = Object.keys(nodeData.history).sort();
          // Xử lý cho biểu đồ điện
          if (viewTypeElectric === 'day') {
            if (_fromElectric && _toElectric) {
              let range = getDateRange(_fromElectric, _toElectric);
              electricHistory = {};
              // Thêm nhãn ngày đầu với giá trị 0
              if (range.length > 0) {
                const label = range[0] ? `${range[0].slice(8,10)}/${range[0].slice(5,7)}/${range[0].slice(2,4)}` : '';
                electricHistory[label] = 0;
              }
              for (let i = 0; i < range.length - 1; i++) {
                const d1 = range[i];
                const d2 = range[i + 1];
                const label = d2 ? `${d2.slice(8,10)}/${d2.slice(5,7)}/${d2.slice(2,4)}` : '';
                let value = 0;
                if (nodeData.history && nodeData.history[d1] && nodeData.history[d2]) {
                  const v1 = nodeData.history[d1];
                  const v2 = nodeData.history[d2];
                  if (v1.electric !== undefined && v2.electric !== undefined) {
                    value = v2.electric - v1.electric;
                  }
                }
                electricHistory[label] = value;
              }
              Object.keys(electricHistory).forEach(label => {
                if (!range.some(d => `${d.slice(8,10)}/${d.slice(5,7)}/${d.slice(2,4)}` === label)) {
                  delete electricHistory[label];
                }
              });
            }
          } else if (viewTypeElectric === 'month') {
            // SỬA: Dùng duy nhất hàm calcMonthDiffs cho điện
            let monthDiffs = calcMonthDiffs(nodeData.history, monthRangeElectric);
            electricHistory = {};
            for (let m of monthRangeElectric) {
              let label = m.slice(5,7) + '/' + m.slice(2,4);
              electricHistory[label] = monthDiffs[label] ? monthDiffs[label].electric : 0;
            }
          }
          // Xử lý cho biểu đồ nước
          if (viewTypeWater === 'day') {
            if (fromWater && toWater) {
              let range = getDateRange(fromWater, toWater);
              waterHistory = {};
              // Thêm nhãn ngày đầu với giá trị 0
              if (range.length > 0) {
                const label = range[0] ? `${range[0].slice(8,10)}/${range[0].slice(5,7)}/${range[0].slice(2,4)}` : '';
                waterHistory[label] = 0;
              }
              for (let i = 0; i < range.length - 1; i++) {
                const d1 = range[i];
                const d2 = range[i + 1];
                const label = d2 ? `${d2.slice(8,10)}/${d2.slice(5,7)}/${d2.slice(2,4)}` : '';
                let value = 0;
                if (nodeData.history && nodeData.history[d1] && nodeData.history[d2]) {
                  const v1 = nodeData.history[d1];
                  const v2 = nodeData.history[d2];
                  if (v1.water !== undefined && v2.water !== undefined) {
                    value = v2.water - v1.water;
                  }
                }
                waterHistory[label] = value;
              }
              Object.keys(waterHistory).forEach(label => {
                if (!range.some(d => `${d.slice(8,10)}/${d.slice(5,7)}/${d.slice(2,4)}` === label)) {
                  delete waterHistory[label];
                }
              });
            }
          } else if (viewTypeWater === 'month') {
            // SỬA: Dùng duy nhất hàm calcMonthDiffs cho nước
            let monthDiffs = calcMonthDiffs(nodeData.history, monthRangeWater);
            waterHistory = {};
            for (let m of monthRangeWater) {
              let label = m.slice(5,7) + '/' + m.slice(2,4);
              waterHistory[label] = monthDiffs[label] ? monthDiffs[label].water : 0;
            }
          }
        }
      }
    }
  } else {
    // Tổng hợp tất cả các phòng, node
    let nodeDayDiffs = {};
    let nodeMonthDiffs = {};
    let dayRangeElectric = [];
    let dayRangeWater = [];
    if (fromElectric && toElectric) {
      dayRangeElectric = getDateRange(fromElectric, toElectric);
    } else {
      dayRangeElectric = getLastNDays(10);
    }
    if (fromWater && toWater) {
      dayRangeWater = getDateRange(fromWater, toWater);
    } else {
      dayRangeWater = getLastNDays(10);
    }
    // Duyệt qua tất cả các phòng
    for (const [roomName, info] of Object.entries(roomData)) {
      if (info.nodes) {
        for (const nodeId of Object.keys(info.nodes)) {
          const nodeData = info.nodes[nodeId];
          if (nodeData.history) {
            // Theo ngày điện
            for (let i = 0; i < dayRangeElectric.length - 1; i++) {
              const d1 = dayRangeElectric[i];
              const d2 = dayRangeElectric[i + 1];
              const label = d1 ? `${d1.slice(8,10)}/${d1.slice(5,7)}/${d1.slice(2,4)}` : '';
              let valueElectric = 0;
              if (nodeData.history[d1] && nodeData.history[d2]) {
                const v1 = nodeData.history[d1];
                const v2 = nodeData.history[d2];
                if (v1.electric !== undefined && v2.electric !== undefined) {
                  valueElectric = v2.electric - v1.electric;
                }
              }
              if (!nodeDayDiffs[label]) nodeDayDiffs[label] = { water: 0, electric: 0 };
              nodeDayDiffs[label].electric += valueElectric;
            }
            // Theo ngày nước
            for (let i = 0; i < dayRangeWater.length - 1; i++) {
              const d1 = dayRangeWater[i];
              const d2 = dayRangeWater[i + 1];
              const label = d1 ? `${d1.slice(8,10)}/${d1.slice(5,7)}/${d1.slice(2,4)}` : '';
              let valueWater = 0;
              if (nodeData.history[d1] && nodeData.history[d2]) {
                const v1 = nodeData.history[d1];
                const v2 = nodeData.history[d2];
                if (v1.water !== undefined && v2.water !== undefined) {
                  valueWater = v2.water - v1.water;
                }
              }
              if (!nodeDayDiffs[label]) nodeDayDiffs[label] = { water: 0, electric: 0 };
              nodeDayDiffs[label].water += valueWater;
            }
            // Theo tháng: SỬA - chỉ dùng calcMonthDiffs
            let monthDiffsElectric = calcMonthDiffs(nodeData.history, monthRangeElectric);
            let monthDiffsWater = calcMonthDiffs(nodeData.history, monthRangeWater);
            for (let m of monthRangeElectric) {
              let label = m.slice(5,7) + '/' + m.slice(2,4);
              if (!nodeMonthDiffs[label]) nodeMonthDiffs[label] = { electric: 0, water: 0 };
              nodeMonthDiffs[label].electric += monthDiffsElectric[label] ? monthDiffsElectric[label].electric : 0;
            }
            for (let m of monthRangeWater) {
              let label = m.slice(5,7) + '/' + m.slice(2,4);
              if (!nodeMonthDiffs[label]) nodeMonthDiffs[label] = { electric: 0, water: 0 };
              nodeMonthDiffs[label].water += monthDiffsWater[label] ? monthDiffsWater[label].water : 0;
            }
          }
        }
      }
    }
    if (viewTypeElectric === 'day' || viewTypeWater === 'day') {
      waterHistory = {};
      electricHistory = {};
      // Thêm nhãn ngày đầu với giá trị 0
      if (dayRangeWater.length > 0) {
        const label = dayRangeWater[0] ? `${dayRangeWater[0].slice(8,10)}/${dayRangeWater[0].slice(5,7)}/${dayRangeWater[0].slice(2,4)}` : '';
        waterHistory[label] = 0;
      }
      if (dayRangeElectric.length > 0) {
        const label = dayRangeElectric[0] ? `${dayRangeElectric[0].slice(8,10)}/${dayRangeElectric[0].slice(5,7)}/${dayRangeElectric[0].slice(2,4)}` : '';
        electricHistory[label] = 0;
      }
      for (let i = 0; i < dayRangeWater.length - 1; i++) {
        const d1 = dayRangeWater[i];
        const d2 = dayRangeWater[i + 1];
        const label = d2 ? `${d2.slice(8,10)}/${d2.slice(5,7)}/${d2.slice(2,4)}` : '';
        waterHistory[label] = nodeDayDiffs[label] ? nodeDayDiffs[label].water : 0;
      }
      for (let i = 0; i < dayRangeElectric.length - 1; i++) {
        const d1 = dayRangeElectric[i];
        const d2 = dayRangeElectric[i + 1];
        const label = d2 ? `${d2.slice(8,10)}/${d2.slice(5,7)}/${d2.slice(2,4)}` : '';
        electricHistory[label] = nodeDayDiffs[label] ? nodeDayDiffs[label].electric : 0;
      }
      _fromElectric = _fromWater = dayRangeElectric[0];
      _toElectric = _toWater = dayRangeElectric[dayRangeElectric.length - 1];
    }
    if (viewTypeElectric === 'month' || viewTypeWater === 'month') {
      let electricHistoryTemp = {};
      let waterHistoryTemp = {};
      for (let m of monthRangeElectric) {
        let label = m.slice(5,7) + '/' + m.slice(2,4);
        electricHistoryTemp[label] = nodeMonthDiffs[label] ? nodeMonthDiffs[label].electric : 0;
      }
      for (let m of monthRangeWater) {
        let label = m.slice(5,7) + '/' + m.slice(2,4);
        waterHistoryTemp[label] = nodeMonthDiffs[label] ? nodeMonthDiffs[label].water : 0;
      }
      if (viewTypeElectric === 'month') {
        electricHistory = electricHistoryTemp;
        _fromElectric = monthRangeElectric[0];
        _toElectric = monthRangeElectric[monthRangeElectric.length - 1];
      }
      if (viewTypeWater === 'month') {
        waterHistory = waterHistoryTemp;
        _fromWater = monthRangeWater[0];
        _toWater = monthRangeWater[monthRangeWater.length - 1];
      }
    }
  }

  console.log('electricHistory:', electricHistory);
  console.log('waterHistory:', waterHistory);
  res.render('statistic', {
    waterHistory, electricHistory, phoneList, selectedPhone,
    fromElectric: _fromElectric, toElectric: _toElectric, fromWater: _fromWater, toWater: _toWater, viewTypeElectric, viewTypeWater,
    fromMonthElectric: fromMonthElectricValue || (now.getMonth() + 1).toString().padStart(2, '0'),
    fromYearElectric: fromYearElectricValue || now.getFullYear(),
    toMonthElectric: toMonthElectricValue || (now.getMonth() + 1).toString().padStart(2, '0'),
    toYearElectric: toYearElectricValue || now.getFullYear(),
    fromMonthWater: fromMonthWaterValue || (now.getMonth() + 1).toString().padStart(2, '0'),
    fromYearWater: fromYearWaterValue || now.getFullYear(),
    toMonthWater: toMonthWaterValue || (now.getMonth() + 1).toString().padStart(2, '0'),
    toYearWater: toYearWaterValue || now.getFullYear(),
    minYear, maxYear
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Admin site is running at http://localhost:${PORT}`);
});
