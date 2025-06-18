# Building Management Web Application

## 📁 Cấu trúc dự án

```
Building-Management-Web/
├── app.js                          # Main application file (Express server)
├── package.json                    # Dependencies và scripts
├── firebase-admin.json             # Firebase admin credentials
├── backup/                         # 📦 File gốc để tham khảo
│   ├── index.original.js           # File server gốc (78KB)
│   ├── dashboard.original.ejs      # Dashboard gốc (185KB)
│   ├── dashboard-scripts.original.ejs
│   └── all-modals.original.ejs
├── config/                         # ⚙️ Cấu hình
│   └── database.js                 # Firebase config
├── controllers/                    # 🎮 Controllers
│   ├── statisticsController.js
│   ├── paymentController.js
│   └── notificationController.js
├── routes/                         # 🛣️ API routes
│   ├── api.js                      # API endpoints
│   └── rooms.js                    # Room management routes
├── views/                          # 🎨 Templates
│   ├── dashboard.ejs               # Main dashboard (42 lines)
│   ├── payments.ejs                # Payment management
│   ├── statistic.ejs               # Statistics page
│   ├── login.ejs                   # Login page
│   └── partials/                   # 🧩 Page-based components
│       ├── layout/                 # 🏗️ Global layout
│       │   ├── head.ejs            # HTML head
│       │   └── sidebar.ejs         # Navigation sidebar
│       ├── dashboard/              # 📊 Dashboard-specific
│       │   ├── components/         # UI components
│       │   │   ├── left-column.ejs # Statistics & feedback
│       │   │   └── right-column.ejs# Rooms table
│       │   ├── modals/             # Modal dialogs
│       │   │   ├── add-room-modal.ejs
│       │   │   ├── manage-phone-modal.ejs
│       │   │   └── ...
│       │   ├── scripts/            # JavaScript modules
│       │   │   ├── global-variables.ejs
│       │   │   ├── feedback-functions.ejs
│       │   │   ├── phone-management.ejs
│       │   │   └── ...
│       │   ├── styles.ejs          # Dashboard styles
│       │   ├── modals.ejs          # Modal aggregator
│       │   └── scripts.ejs         # Script aggregator
│       └── shared/                 # 🔄 Shared across pages
│           ├── modals/             # Common modals
│           ├── scripts/            # Common scripts
│           │   └── firebase-config.ejs
│           └── styles/             # Common styles
└── public/                         # 📁 Static files
    ├── css/
    ├── js/
    └── images/
```

## 🚀 Khởi chạy

```bash
# Cài đặt dependencies
npm install

# Chạy server
node app.js
```

## 📋 Tính năng chính

- ✅ **Quản lý phòng**: Thêm, sửa, xóa phòng
- ✅ **Quản lý số điện thoại**: Gán/thay đổi SĐT cho phòng
- ✅ **Quản lý nodes**: Điện, nước, custom nodes
- ✅ **Thống kê**: Theo dõi tiêu thụ điện/nước
- ✅ **Thanh toán**: Quản lý hóa đơn hàng tháng
- ✅ **Thông báo**: Gửi FCM notifications
- ✅ **Feedback**: Hệ thống góp ý realtime

## 🔧 Kiến trúc

### Page-based Architecture
- **Page-specific**: Mỗi page có folder riêng (dashboard/, payments/, statistics/)
- **Components**: UI components được nhóm theo page
- **Scripts**: JavaScript modules được tổ chức theo chức năng
- **Modals**: Modal dialogs được nhóm theo page
- **Shared**: Components dùng chung giữa các pages

### API Structure
- **RESTful APIs**: `/api/feedback`, `/api/phone-numbers`, etc.
- **Firebase Integration**: Realtime database + FCM
- **Authentication**: Session-based auth

