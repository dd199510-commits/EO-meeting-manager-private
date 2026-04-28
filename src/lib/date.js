export function formatDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function addDays(date, days) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

export function addWeeks(date, weeks) {
  return addDays(date, weeks * 7)
}

export function addMonths(date, months) {
  const next = new Date(date)
  const originalDay = next.getDate()
  next.setMonth(next.getMonth() + months)
  if (next.getDate() !== originalDay) {
    next.setDate(0)
  }
  return next
}

export function addYears(date, years) {
  const next = new Date(date)
  next.setFullYear(next.getFullYear() + years)
  return next
}

export function getNextMonthRange() {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  const end = new Date(now.getFullYear(), now.getMonth() + 2, 0)
  return {
    start: formatDate(start),
    end: formatDate(end),
  }
}

export function getCalendarDays(year, month) {
  const firstDay = new Date(year, month, 1)
  const firstWeekday = firstDay.getDay()
  const daysToMonday = firstWeekday === 0 ? 6 : firstWeekday - 1
  const start = addDays(firstDay, -daysToMonday)

  return Array.from({ length: 42 }, (_, index) => {
    const current = addDays(start, index)
    return {
      date: formatDate(current),
      day: current.getDate(),
      isCurrentMonth: current.getMonth() === month,
    }
  })
}
