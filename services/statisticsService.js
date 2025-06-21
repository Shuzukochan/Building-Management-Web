// Helper function to calculate monthly usage
function calculateMonthlyUsageByType(historyData, month, year, roomId, dataType) {
  try {
    const monthStr = month.toString().padStart(2, "0");
    const yearStr = year.toString();
    
    console.log(`📅 Calculating ${dataType} usage for room ${roomId} for ${monthStr}/${yearStr}`);
    
    // Get latest date of current month (search backward from end of month)
    const daysInMonth = new Date(year, month, 0).getDate();
    let currentMonthLatestValue = null;
    let currentMonthLatestDate = null;
    
    for (let day = daysInMonth; day >= 1; day--) {
      const dayStr = day.toString().padStart(2, "0");
      const dateStr = `${yearStr}-${monthStr}-${dayStr}`;
      if (historyData[dateStr] && historyData[dateStr][dataType] !== undefined) {
        currentMonthLatestValue = historyData[dateStr][dataType] || 0;
        currentMonthLatestDate = dateStr;
        break;
      }
    }
    
    if (currentMonthLatestValue === null) {
      console.log(`⚠️ No ${dataType} data found for room ${roomId} in ${monthStr}/${yearStr}`);
      return 0;
    }
    
    console.log(`📊 Latest ${dataType} reading in ${monthStr}/${yearStr}: ${currentMonthLatestValue} on ${currentMonthLatestDate}`);
    
    // Get latest date of previous month (search backward from end of previous month)
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    const prevMonthStr = prevMonth.toString().padStart(2, "0");
    const prevYearStr = prevYear.toString();
    
    const daysInPrevMonth = new Date(prevYear, prevMonth, 0).getDate();
    let prevMonthLatestValue = null;
    let prevMonthLatestDate = null;
    
    for (let day = daysInPrevMonth; day >= 1; day--) {
      const dayStr = day.toString().padStart(2, "0");
      const dateStr = `${prevYearStr}-${prevMonthStr}-${dayStr}`;
      if (historyData[dateStr] && historyData[dateStr][dataType] !== undefined) {
        prevMonthLatestValue = historyData[dateStr][dataType] || 0;
        prevMonthLatestDate = dateStr;
        break;
      }
    }
    
    let usage = 0;
    
    if (prevMonthLatestValue !== null) {
      // Case 1: Has previous month data - calculate difference
      usage = Math.max(0, currentMonthLatestValue - prevMonthLatestValue);
      console.log(`🔍 Room ${roomId} ${dataType}: ${prevMonthLatestValue} (${prevMonthLatestDate}) -> ${currentMonthLatestValue} (${currentMonthLatestDate})`);
      console.log(`✅ Room ${roomId} ${dataType} usage: ${usage} (current - previous month)`);
    } else {
      // Case 2: No previous month data - calculate from earliest date in current month
      let currentMonthEarliestValue = null;
      let currentMonthEarliestDate = null;
      
      for (let day = 1; day <= daysInMonth; day++) {
        const dayStr = day.toString().padStart(2, "0");
        const dateStr = `${yearStr}-${monthStr}-${dayStr}`;
        if (historyData[dateStr] && historyData[dateStr][dataType] !== undefined) {
          currentMonthEarliestValue = historyData[dateStr][dataType] || 0;
          currentMonthEarliestDate = dateStr;
          break;
        }
      }
      
      if (currentMonthEarliestValue !== null && currentMonthEarliestDate !== currentMonthLatestDate) {
        usage = Math.max(0, currentMonthLatestValue - currentMonthEarliestValue);
        console.log(`🔍 Room ${roomId} ${dataType}: ${currentMonthEarliestValue} (${currentMonthEarliestDate}) -> ${currentMonthLatestValue} (${currentMonthLatestDate})`);
        console.log(`✅ Room ${roomId} ${dataType} usage: ${usage} (latest - earliest in current month)`);
      } else {
        console.log(`⚠️ Not enough ${dataType} data for room ${roomId} in ${monthStr}/${yearStr}`);
        usage = 0;
      }
    }
    
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

// Process monthly history data for charts
function processMonthlyHistoryData(history, fromMonth, fromYear, toMonth, toYear, dataType) {
  const result = {};
  
  // Generate month range
  const months = [];
  let currentYear = parseInt(fromYear);
  let currentMonth = parseInt(fromMonth);
  const endYear = parseInt(toYear);
  const endMonth = parseInt(toMonth);
  
  while (currentYear < endYear || (currentYear === endYear && currentMonth <= endMonth)) {
    months.push({
      year: currentYear,
      month: currentMonth,
      key: `${currentYear}-${currentMonth.toString().padStart(2, '0')}`
    });
    
    currentMonth++;
    if (currentMonth > 12) {
      currentMonth = 1;
      currentYear++;
    }
  }
  
  console.log(`📅 Processing monthly data for ${dataType} from ${fromMonth}/${fromYear} to ${toMonth}/${toYear}`);
  console.log(`📊 Month range:`, months.map(m => m.key));
  
  // Calculate usage for each month
  for (const monthInfo of months) {
    const usage = calculateMonthlyUsageByType(history, monthInfo.month, monthInfo.year, 'room', dataType);
    const label = `${monthInfo.month}/${monthInfo.year}`;
    result[label] = usage;
    console.log(`📈 ${dataType} usage for ${label}: ${usage}`);
  }
  
  return result;
}

module.exports = {
  calculateMonthlyUsageByType,
  getLastNDays,
  getDateRange,
  processHistoryData,
  processMonthlyHistoryData
};