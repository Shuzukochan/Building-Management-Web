# Shared Toast System

## Sử dụng
Shared toast system đã được tích hợp vào cả dashboard và payments pages.

### Cách include trong một page mới:

1. Include container:
```html
<%- include('partials/shared/components/toast-container') %>
```

2. Include styles và scripts:
```html
<%- include('partials/shared/styles/toast-styles') %>
<%- include('partials/shared/scripts/toast-manager') %>
```

### Cách sử dụng trong code:

#### Basic usage:
```javascript
toastManager.success('Thông báo thành công');
toastManager.error('Thông báo lỗi');
toastManager.warning('Thông báo cảnh báo');
toastManager.info('Thông báo thông tin');
```

#### Advanced usage with custom duration:
```javascript
toastManager.success('Thông báo', 3000); // 3 seconds
```

#### Helper functions để tương thích với code cũ:
```javascript
showSuccessToast('Thành công');
showErrorToast('Lỗi');
showWarningToast('Cảnh báo');
showInfoToast('Thông tin');
```

#### Với custom title:
```javascript
showToast('warning', 'Custom Title', 'Custom message', 5000);
```

### Auto-detect server messages:
Hệ thống tự động hiển thị toast từ server qua hidden inputs:
```html
<input type="hidden" id="successMessage" value="<%= success %>">
<input type="hidden" id="errorMessage" value="<%= error %>">
```

### Files structure:
- `views/partials/shared/components/toast-container.ejs` - HTML container
- `views/partials/shared/styles/toast-styles.ejs` - CSS styles  
- `views/partials/shared/scripts/toast-manager.ejs` - JavaScript logic 