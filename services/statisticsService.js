// Helper function to calculate monthly usage
function calculateMonthlyUsageByType(historyData, month, year, roomId, dataType) {
  try {
    const monthStr = month.toString().padStart(2, "0");
    const yearStr = year.toString();
    
    console.log(`📅 Calculating ${dataType} usage for room ${roomId} for ${monthStr}/${yearStr}`);
    
    // Get all dates in current month
    const monthDates = [];
    const daysInMonth = new Date(year, month, 0).getDate();
    
    for (let day = 1; day <= daysInMonth; day++) {
      const dayStr = day.toString().padStart(2, "0");
      const dateStr = `${yearStr}-${monthStr}-${dayStr}`;
      if (historyData[dateStr] && historyData[dateStr][dataType] !== undefined) {
        monthDates.push({
          date: dateStr,
          value: historyData[dateStr][dataType] || 0
        });
      }
    }
    
    console.log(`📊 Found ${monthDates.length} days of ${dataType} data for room ${roomId}`);
    
    if (monthDates.length < 2) {
      console.log(`⚠️ Not enough ${dataType} data for room ${roomId} (need at least 2 days)`);
      return 0;
    }
    
    // Sort by date
    monthDates.sort((a, b) => a.date.localeCompare(b.date));
    
    // Get first and last readings of the month
    const firstValue = monthDates[0].value;
    const lastValue = monthDates[monthDates.length - 1].value;
    
    console.log(`🔍 Room ${roomId} ${dataType}: ${firstValue} -> ${lastValue} (${monthDates[0].date} to ${monthDates[monthDates.length - 1].date})`);
    
    // Calculate usage (ensure non-negative)
    const usage = Math.max(0, lastValue - firstValue);
    
    console.log(`✅ Room ${roomId} ${dataType} usage: ${usage}`);
    return usage;
    
  } catch (error) {
    console.error(`❌ Error calculating ${dataType} usage for room ${roomId}:`, error);
    return 0;
  }
}

// Utility function to get last N days
function getLastNDays(n) {
  const arr = [];
  const today = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const yyyy = d.getFullYear();
    const mm = (d.getMonth() + 1).toString().padStart(2, '0');
    const dd = d.getDate().toString().padStart(2, '0');
    arr.push(`${yyyy}-${mm}-${dd}`);
  }
  return arr;
}

// Utility function to get date range
function getDateRange(from, to) {
  const arr = [];
  if (!from || !to) return arr;
  const d1 = new Date(from);
  const d2 = new Date(to);
  while (d1 <= d2) {
    const yyyy = d1.getFullYear();
    const mm = (d1.getMonth() + 1).toString().padStart(2, '0');
    const dd = d1.getDate().toString().padStart(2, '0');
    arr.push(`${yyyy}-${mm}-${dd}`);
    d1.setDate(d1.getDate() + 1);
  }
  return arr;
}

// Process history data for charts
function processHistoryData(history, fromDate, toDate, dataType) {
  const result = {};
  const dateRange = getDateRange(fromDate, toDate);
  
  for (let i = 0; i < dateRange.length - 1; i++) {
    const d1 = dateRange[i];
    const d2 = dateRange[i + 1];
    const label = `${d2.slice(8,10)}/${d2.slice(5,7)}/${d2.slice(2,4)}`;
    
    let value = 0;
    if (history[d1] && history[d2]) {
      const v1 = history[d1][dataType] || 0;
      const v2 = history[d2][dataType] || 0;
      value = Math.max(0, v2 - v1); // Đảm bảo không âm
    }
    
    result[label] = value;
  }
  
  return result;
}

module.exports = {
  calculateMonthlyUsageByType,
  getLastNDays,
  getDateRange,
  processHistoryData
};