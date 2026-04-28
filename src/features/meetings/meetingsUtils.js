import {
  FREQUENCY_LABELS,
  getMeetingFrequencyType,
  getMeetingInterval,
  getMeetingYearlyMonthCount,
} from '../../data/meetingData'
import { calculateNextOccurrence } from '../../lib/meetingFrequency'
import { addDays, addMonths, formatDate } from '../../lib/date'

export const FREQUENCY_ORDER = {
  weekly: 1,
  monthly: 2,
  yearly: 3,
  adhoc: 4,
}

export function filterMeetings(meetings, filters) {
  const today = formatDate(new Date())

  return meetings.filter((meeting) => {
    if (filters.frequency !== 'all' && filters.frequency !== getMeetingFrequencyType(meeting)) {
      return false
    }

    if (filters.frequencyTypes?.length > 0 && !filters.frequencyTypes.includes(getMeetingFrequencyType(meeting))) {
      return false
    }

    if (!filters.search.trim()) {
      if (!passesAdditionalFilters(meeting, filters, today)) {
        return false
      }
    } else {
      const keyword = filters.search.toLowerCase()
      const matchesKeyword =
        meeting.name.toLowerCase().includes(keyword) ||
        meeting.attendees.toLowerCase().includes(keyword)

      if (!matchesKeyword) {
        return false
      }
    }

    return passesAdditionalFilters(meeting, filters, today)
  })
}

function passesAdditionalFilters(meeting, filters, today) {
  if (filters.attendee?.trim()) {
    const attendeeKeyword = filters.attendee.toLowerCase()
    if (!meeting.attendees.toLowerCase().includes(attendeeKeyword)) {
      return false
    }
  }

  if (filters.historyStatus === 'has' && (meeting.history?.length ?? 0) === 0) {
    return false
  }

  if (filters.historyStatus === 'none' && (meeting.history?.length ?? 0) > 0) {
    return false
  }

  if (filters.timeRange && filters.timeRange !== 'all') {
    const nextOccurrence = calculateNextOccurrence(meeting)
    if (!nextOccurrence) {
      return false
    }

    if (filters.timeRange === 'week') {
      if (nextOccurrence > formatDate(addDays(new Date(today), 7))) {
        return false
      }
    } else if (filters.timeRange === 'month') {
      if (nextOccurrence > formatDate(addMonths(new Date(today), 1))) {
        return false
      }
    } else if (filters.timeRange === '30days') {
      if (nextOccurrence > formatDate(addDays(new Date(today), 30))) {
        return false
      }
    }
  }

  return true
}

export function sortMeetings(meetings, sortBy) {
  const next = [...meetings]

  if (sortBy === 'nextDate') {
    return next.sort((a, b) =>
      (calculateNextOccurrence(a) || '9999-99-99').localeCompare(calculateNextOccurrence(b) || '9999-99-99'),
    )
  }

  if (sortBy === 'lastDate') {
    return next.sort((a, b) => {
      const lastA = a.history?.[a.history.length - 1] || ''
      const lastB = b.history?.[b.history.length - 1] || ''
      return lastB.localeCompare(lastA)
    })
  }

  if (sortBy === 'name') {
    return next.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  }

  if (sortBy === 'custom') {
    return next.sort((a, b) => (a.customOrder ?? 0) - (b.customOrder ?? 0))
  }

  return next.sort((a, b) => {
    const typeA = getMeetingFrequencyType(a)
    const typeB = getMeetingFrequencyType(b)
    const orderDiff = FREQUENCY_ORDER[typeA] - FREQUENCY_ORDER[typeB]
    if (orderDiff !== 0) return orderDiff
    if (typeA === 'weekly' || typeA === 'monthly') {
      const intervalDiff = getMeetingInterval(a) - getMeetingInterval(b)
      if (intervalDiff !== 0) return intervalDiff
    }
    if (typeA === 'yearly' && typeB === 'yearly') {
      const yearCountDiff = getMeetingYearlyMonthCount(a) - getMeetingYearlyMonthCount(b)
      if (yearCountDiff !== 0) return yearCountDiff
    }
    return (calculateNextOccurrence(a) || '9999-99-99').localeCompare(
      calculateNextOccurrence(b) || '9999-99-99',
    )
  })
}

export function hasActiveFilters(filters) {
  return (
    Boolean(filters.search.trim()) ||
    filters.frequency !== 'all' ||
    (filters.frequencyTypes?.length ?? 0) > 0 ||
    Boolean(filters.attendee?.trim()) ||
    filters.timeRange !== 'all' ||
    filters.historyStatus !== 'all'
  )
}

export function getSubGroupKey(meeting) {
  const type = getMeetingFrequencyType(meeting)

  if (type === 'weekly') {
    const interval = getMeetingInterval(meeting)
    if (interval === 1) return 'weekly-1'
    if (interval === 2) return 'weekly-2'
    if (interval === 3) return 'weekly-3'
    return 'weekly-other'
  }
  if (type === 'monthly') {
    const interval = getMeetingInterval(meeting)
    if (interval === 1) return 'monthly-1'
    if (interval === 2) return 'monthly-2'
    if (interval === 3) return 'monthly-3'
    if (interval === 6) return 'monthly-6'
    return 'monthly-other'
  }
  if (type === 'yearly') {
    const count = getMeetingYearlyMonthCount(meeting)
    if (count === 1) return 'yearly-1'
    if (count === 2) return 'yearly-2'
    if (count === 4) return 'yearly-4'
    return 'yearly-other'
  }
  return 'adhoc'
}

export function getSubGroupLabel(subGroupKey) {
  const labels = {
    'weekly-1': '周会 (每周)',
    'weekly-2': '双周会 (每2周)',
    'weekly-3': '三周会 (每3周)',
    'weekly-other': '其他周会',
    'monthly-1': '月会 (每月)',
    'monthly-2': '双月会 (每2月)',
    'monthly-3': '季度会 (每3月)',
    'monthly-6': '半年会 (每6月)',
    'monthly-other': '其他月会',
    'yearly-1': '年会 (1次/年)',
    'yearly-2': '半年会 (2次/年)',
    'yearly-4': '季度会 (4次/年)',
    'yearly-other': '其他年会',
    adhoc: '不定期',
  }
  return labels[subGroupKey] || subGroupKey
}

export function getCompactFrequencyLabel(meeting) {
  const subGroupKey = getSubGroupKey(meeting)
  const labels = {
    'weekly-1': '周会',
    'weekly-2': '双周会',
    'weekly-3': '三周会',
    'weekly-other': '周例会',
    'monthly-1': '月会',
    'monthly-2': '双月会',
    'monthly-3': '季度会',
    'monthly-6': '半年会',
    'monthly-other': '月度会',
    'yearly-1': '年会',
    'yearly-2': '半年会',
    'yearly-4': '季度会',
    'yearly-other': '年度会',
    adhoc: '不定期',
  }

  return labels[subGroupKey] || '会议'
}

export function getGroupTone(groupKey) {
  const tones = {
    weekly: 'blue',
    monthly: 'green',
    yearly: 'amber',
    adhoc: 'slate',
  }

  return tones[groupKey] || 'blue'
}

export function getSubGroupTone(subGroupKey) {
  if (subGroupKey.startsWith('weekly')) return 'blue'
  if (subGroupKey.startsWith('monthly')) return 'green'
  if (subGroupKey.startsWith('yearly')) return 'amber'
  return 'slate'
}

export function groupMeetingsByFrequency(meetings) {
  const groups = {
    weekly: {},
    monthly: {},
    yearly: {},
    adhoc: {},
  }

  meetings.forEach((meeting) => {
    const subKey = getSubGroupKey(meeting)
    const type = getMeetingFrequencyType(meeting)
    if (!groups[type][subKey]) {
      groups[type][subKey] = []
    }
    groups[type][subKey].push(meeting)
  })

  return groups
}

export function getGroupSummary(meetings) {
  return meetings.reduce((accumulator, meeting) => {
    const type = getMeetingFrequencyType(meeting)
    accumulator[type] = (accumulator[type] ?? 0) + 1
    return accumulator
  }, {})
}

export function getActiveFilterTags(filters) {
  const tags = []

  if (filters.search.trim()) {
    tags.push({ key: 'search', label: `搜索: ${filters.search}` })
  }

  if (filters.frequency !== 'all') {
    tags.push({ key: 'frequency', label: FREQUENCY_LABELS[filters.frequency] })
  }

  filters.frequencyTypes?.forEach((type) => {
    tags.push({ key: `frequency-type-${type}`, label: FREQUENCY_LABELS[type] })
  })

  if (filters.attendee?.trim()) {
    tags.push({ key: 'attendee', label: `参会人: ${filters.attendee}` })
  }

  if (filters.timeRange !== 'all') {
    const labels = { week: '本周', month: '本月', '30days': '30天内' }
    tags.push({ key: 'timeRange', label: labels[filters.timeRange] })
  }

  if (filters.historyStatus !== 'all') {
    const labels = { has: '有记录', none: '无记录' }
    tags.push({ key: 'historyStatus', label: labels[filters.historyStatus] })
  }

  return tags
}
