# 🏢 Building Management System

A smart building management system with real-time electricity/water consumption monitoring, room management, payment processing, and automated notifications.

## ✨ Key Features

### 🏠 Room Management
- Add, edit, delete rooms
- Assign phone numbers to rooms
- Real-time room status monitoring
- Tenant information management

### 📊 Consumption Monitoring
- **Electricity**: Monitor power, voltage, current
- **Water**: Measure flow rate, detect leaks
- **Custom nodes**: Support custom sensors
- **Real-time**: Live data updates
- **Charts**: Daily/monthly/yearly statistics

### 💰 Payment Management
- Automatic monthly billing
- Payment status tracking
- Tiered pricing calculation
- Outstanding balance reports

### 🔔 Notification System
- **FCM**: Push notifications to devices
- **Broadcast**: Building-wide announcements
- **Alerts**: Water leaks, electrical overload
- **Feedback**: Real-time feedback system

### ⚙️ System Settings
- **Calibration**: Sensor calibration
- **Pricing**: Electricity/water pricing
- **Gateway**: Gateway device management
- **Admin**: Role-based administration

## 🛠️ Technology Stack

### Backend
- **Node.js** - Runtime environment
- **Express.js** - Web framework
- **EJS** - Template engine
- **Firebase Admin SDK** - Database & FCM
- **Express Session** - Authentication

### Frontend
- **Bootstrap 5** - UI framework
- **Chart.js** - Statistics charts
- **Font Awesome** - Icons
- **jQuery** - DOM manipulation

### Database & Services
- **Firebase Realtime Database** - Main database
- **Firebase Cloud Messaging** - Push notifications
- **Firebase Authentication** - Authentication

## 📦 Installation

### Prerequisites
- Node.js >= 14.0.0
- npm >= 6.0.0
- Firebase project

### Step 1: Clone repository
```bash
git clone https://github.com/Shuzukochan/building-management-web.git
cd building-management-web
```

### Step 2: Install dependencies
```bash
npm install
```

### Step 3: Environment setup
Create `.env` file from `.env.example` and fill in your Firebase credentials.

### Step 4: Run application
```bash
# Development mode
npm run dev

# Production mode
npm start
```

Application will run at: `http://localhost:3000`

## 🔧 Firebase Setup

### 1. Create Firebase Project
1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create new project
3. Enable Realtime Database
4. Enable Cloud Messaging

### 2. Create Service Account
1. Go to Project Settings > Service Accounts
2. Generate service account key
3. Download JSON file
4. Copy credentials to `.env` file

## 🚀 Deployment

### VPS/Dedicated Server
```bash
# Install PM2
npm install -g pm2

# Start application
pm2 start app.js --name "building-management"

# Save PM2 configuration
pm2 save
pm2 startup
```

## 📱 Screenshots

### Login Page

<img width="1914" height="941" alt="image" src="https://github.com/user-attachments/assets/48d9fb6b-a3aa-49ff-b783-c6f29080e100" />

### Dashboard 
<img width="1914" height="939" alt="image" src="https://github.com/user-attachments/assets/69c038b0-435f-44f4-8d11-70cb26ca6cf2" />

### Statistics
<img width="1913" height="939" alt="image" src="https://github.com/user-attachments/assets/23a8bd06-83df-492c-992a-18af21a081f8" />

### Payment Tracking
<img width="1913" height="936" alt="image" src="https://github.com/user-attachments/assets/8fc628e4-f8ff-4700-9174-921850ed2ad5" />

### Calibration
<img width="1915" height="938" alt="image" src="https://github.com/user-attachments/assets/7d83d879-3431-467e-84c3-ef5e3ca94101" />

### Admin Management
<img width="1914" height="937" alt="image" src="https://github.com/user-attachments/assets/7c5933dd-b4f7-4e00-8c1f-b7a431efdd23" />

## 🤝 Contributing

1. Fork the project
2. Create feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to branch (`git push origin feature/AmazingFeature`)
5. Open Pull Request

## 📝 License

This project is distributed under the ISC license. See `LICENSE` file for details.

## 📞 Support

- **Email**: shuzukochan@gmail.com
- **Issues**: [GitHub Issues](https://github.com/Shuzukochan/building-management-web/issues)

## 🙏 Acknowledgments

Thank you for using Building Management System! If this project is helpful, please give us a ⭐ on GitHub.

---

**Note**: This is a demo project. Please configure appropriate security measures before using in production environment.
