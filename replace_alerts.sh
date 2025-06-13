#!/bin/bash

# Replace the old alert system with hidden inputs for toast
sed -i '1362,1372c\
    <!-- Hidden data for toast notifications -->\
    <% if (typeof success !== "undefined" && success) { %>\
      <input type="hidden" id="successMessage" value="<%= success %>">\
    <% } %>\
\
    <% if (typeof error !== "undefined" && error) { %>\
      <input type="hidden" id="errorMessage" value="<%= error %>">\
    <% } %>' views/dashboard.ejs

echo "✅ Đã thay thế alert cũ bằng hidden inputs cho toast system" 