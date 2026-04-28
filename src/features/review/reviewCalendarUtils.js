import { addDays, formatDate, getCalendarDays } from '../../lib/date'

export function getWeekDays(anchorDate) {
  const start = new Date(anchorDate)
  const weekday = start.getDay()
  const daysToMonday = weekday === 0 ? 6 : weekday - 1
  const monday = addDays(start, -daysToMonday)

  return Array.from({ length: 7 }, (_, index) => {
    const current = addDays(monday, index)
    return {
      date: formatDate(current),
      day: current.getDate(),
      weekdayLabel: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'][index],
    }
  })
}

export function buildTimeSlots(startHour = 8, endHour = 20) {
  const slots = []

  for (let hour = startHour; hour < endHour; hour += 1) {
    for (let quarter = 0; quarter < 4; quarter += 1) {
      const minute = quarter * 15
      slots.push(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`)
    }
  }

  return slots
}

export function getCalendarHourRange(meetings = [], fallbackStartHour = 8, fallbackEndHour = 20) {
  if (!Array.isArray(meetings) || meetings.length === 0) {
    return { startHour: fallbackStartHour, endHour: fallbackEndHour }
  }

  let minMinutes = fallbackStartHour * 60
  let maxMinutes = fallbackEndHour * 60

  meetings.forEach((meeting) => {
    if (meeting?.startTime) {
      minMinutes = Math.min(minMinutes, timeToMinutes(meeting.startTime))
    }
    if (meeting?.endTime) {
      maxMinutes = Math.max(maxMinutes, timeToMinutes(meeting.endTime))
    }
  })

  const startHour = Math.max(0, Math.floor(minMinutes / 60))
  const endHour = Math.min(24, Math.ceil(maxMinutes / 60))

  return {
    startHour,
    endHour: Math.max(endHour, startHour + 1),
  }
}

export function timeToMinutes(time) {
  const [hour, minute] = time.split(':').map(Number)
  return hour * 60 + minute
}

export function minutesToTime(totalMinutes) {
  const hour = Math.floor(totalMinutes / 60)
  const minute = totalMinutes % 60
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

export function calculateCardStyle(meeting, startHour = 8, blockHeight = 16) {
  const start = timeToMinutes(meeting.startTime)
  const end = timeToMinutes(meeting.endTime)
  const base = startHour * 60
  const top = ((start - base) / 15) * blockHeight
  const height = Math.max(((end - start) / 15) * blockHeight, blockHeight)
  return { top, height }
}

export function getMonthView(anchorDate) {
  const current = new Date(anchorDate)
  return {
    year: current.getFullYear(),
    month: current.getMonth(),
    days: getCalendarDays(current.getFullYear(), current.getMonth()),
  }
}
