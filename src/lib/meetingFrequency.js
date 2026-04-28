import { formatDate, addWeeks, addMonths, addYears } from './date'
import { getMeetingFrequencyType, normalizeMeeting } from '../data/meetingData'

export function parseDateInput(value) {
  if (value instanceof Date) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate())
  }

  if (!value) {
    return null
  }

  const [year, month, day] = String(value).split('-').map(Number)
  if (!year || !month || !day) {
    return null
  }

  return new Date(year, month - 1, day)
}

export function getLastDayOfMonth(year, month) {
  return new Date(year, month + 1, 0).getDate()
}

export function setWeekday(date, weekday) {
  const result = parseDateInput(date)
  const currentDay = result.getDay()
  const diff = weekday - currentDay
  result.setDate(result.getDate() + diff)
  return result
}

export function setSafeDayOfMonth(date, targetDay) {
  const result = parseDateInput(date)
  const year = result.getFullYear()
  const month = result.getMonth()
  const lastDay = getLastDayOfMonth(year, month)
  result.setDate(Math.min(targetDay, lastDay))
  return result
}

export function isBefore(date1, date2) {
  return parseDateInput(date1) < parseDateInput(date2)
}

export function isAfter(date1, date2) {
  return parseDateInput(date1) > parseDateInput(date2)
}

function buildYearlyCandidate(year, month, daySpec) {
  const candidate = new Date(year, month - 1, 1)
  candidate.setDate(Math.min(daySpec, getLastDayOfMonth(year, month - 1)))
  return candidate
}

function getYearlyOccurrences(frequency, rangeStart, rangeEnd, anchorDate) {
  const months = [...new Set(Array.isArray(frequency.monthSpec) ? frequency.monthSpec : [frequency.monthSpec || 1])]
    .filter((month) => Number.isInteger(month) && month >= 1 && month <= 12)
    .sort((a, b) => a - b)

  const anchor = parseDateInput(anchorDate)
  const start = parseDateInput(rangeStart)
  const end = parseDateInput(rangeEnd)
  const instances = []
  const interval = Math.max(1, Number(frequency.interval) || 1)

  if (!anchor || !start || !end || months.length === 0) {
    return instances
  }

  let year = anchor.getFullYear()
  let guard = 0

  while (year <= end.getFullYear() && guard < 500) {
    guard += 1

    months.forEach((month) => {
      const candidate = buildYearlyCandidate(year, month, frequency.daySpec)
      if (candidate < anchor || candidate < start || candidate > end) {
        return
      }

      instances.push(formatDate(candidate))
    })

    year += interval
  }

  return instances
}

export function syncMeetingAnchorDate(meeting) {
  const normalized = normalizeMeeting(meeting)
  const history = normalized.history ?? []
  const lastHistoryDate = history.length > 0 ? history[history.length - 1] : null

  if (!lastHistoryDate || getMeetingFrequencyType(normalized) === 'adhoc') {
    return normalized
  }

  if (!normalized.frequency.anchorDate || normalized.frequency.anchorDate < lastHistoryDate) {
    return {
      ...normalized,
      frequency: {
        ...normalized.frequency,
        anchorDate: lastHistoryDate,
      },
    }
  }

  return normalized
}

export function calculateNextOccurrence(meeting, referenceDate = new Date()) {
  const normalized = syncMeetingAnchorDate(meeting)
  const frequency = normalized.frequency
  const { type, interval, monthSpec, daySpec, anchorDate } = frequency
  const today = formatDate(parseDateInput(referenceDate))

  if (type === 'adhoc' || !anchorDate) {
    return normalized.nextDate || null
  }

  const todayDate = parseDateInput(today)

  if (type === 'yearly') {
    const candidates = []
    const searchEnd = addYears(todayDate, Math.max(interval, 1) * 5)

    getYearlyOccurrences(
      { interval, monthSpec, daySpec },
      today,
      formatDate(searchEnd),
      anchorDate,
    ).forEach((date) => {
      if (date !== anchorDate) {
        candidates.push(parseDateInput(date))
      }
    })

    if (candidates.length === 0) {
      return null
    }

    candidates.sort((a, b) => a - b)
    return formatDate(candidates[0])
  }

  let current = parseDateInput(anchorDate)
  let guard = 0
  let firstIteration = true

  while (guard < 500) {
    guard += 1

    let candidate = parseDateInput(current)
    if (type === 'weekly') {
      candidate = setWeekday(candidate, daySpec)
    } else if (type === 'monthly') {
      candidate = setSafeDayOfMonth(candidate, daySpec)
    }

    if (firstIteration && isBefore(candidate, anchorDate)) {
      current = type === 'weekly' ? addWeeks(current, interval) : addMonths(current, interval)
      firstIteration = false
      continue
    }

    firstIteration = false
    const candidateString = formatDate(candidate)

    if (!(candidate < todayDate)) {
      if (candidateString !== anchorDate) {
        return candidateString
      }
    }

    current = type === 'weekly' ? addWeeks(current, interval) : addMonths(current, interval)
  }

  return null
}

export function formatNextDateInfo(dateValue, referenceDate = new Date()) {
  if (!dateValue) {
    return { prefix: null, date: '待定' }
  }

  const date = parseDateInput(dateValue)
  const now = parseDateInput(referenceDate)
  const currentYear = now.getFullYear()
  const dateYear = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const weekdays = ['日', '一', '二', '三', '四', '五', '六']
  const weekday = weekdays[date.getDay()]

  if (dateYear === currentYear) {
    return {
      prefix: null,
      date: `${month}-${day} 周${weekday}`,
    }
  }

  if (dateYear === currentYear + 1) {
    return {
      prefix: '明年',
      date: `${month}-${day} 周${weekday}`,
    }
  }

  return {
    prefix: `${dateYear}年`,
    date: `${month}-${day} 周${weekday}`,
  }
}

export function generateOccurrencesInRange(meeting, startDate, endDate) {
  const normalized = syncMeetingAnchorDate(meeting)
  const frequency = normalized.frequency
  const type = frequency.type

  if (normalized.status !== 'active' || type === 'adhoc' || !frequency.anchorDate) {
    return []
  }

  const start = parseDateInput(startDate)
  const end = parseDateInput(endDate)
  const instances = []

  if (type === 'yearly') {
    return [...new Set(getYearlyOccurrences(frequency, start, end, frequency.anchorDate))].sort()
  }

  let current = parseDateInput(frequency.anchorDate)
  let guard = 0
  let firstIteration = true

  while (guard < 500) {
    guard += 1

    let candidate = parseDateInput(current)
    if (type === 'weekly') {
      candidate = setWeekday(candidate, frequency.daySpec)
    } else if (type === 'monthly') {
      candidate = setSafeDayOfMonth(candidate, frequency.daySpec)
    }

    if (firstIteration && isBefore(candidate, frequency.anchorDate)) {
      current = type === 'weekly' ? addWeeks(current, frequency.interval) : addMonths(current, frequency.interval)
      firstIteration = false
      continue
    }

    firstIteration = false

    if (isAfter(candidate, end)) {
      break
    }

    if (!isBefore(candidate, start) && !isAfter(candidate, end)) {
      instances.push(formatDate(candidate))
    }

    current = type === 'weekly' ? addWeeks(current, frequency.interval) : addMonths(current, frequency.interval)
  }

  return instances
}
