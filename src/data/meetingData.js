export const STORAGE_KEY = 'meeting-manager:optimized-demo:v1'
export const AI_STORAGE_KEY = 'meeting-manager:ai-scheduler:v1'
export const REVIEW_STORAGE_KEY = 'meeting-manager:review:v1'
export const LOG_STORAGE_KEY = 'meeting-manager:logs:v1'
export const DEFAULT_MEETING_PREFIX = '【常规会议】'
export { INITIAL_CONTACTS, INITIAL_MEETINGS, INITIAL_SCHEDULED } from '@seedData'

export const FREQUENCY_LABELS = {
  weekly: '周会',
  monthly: '月会',
  yearly: '年会',
  adhoc: '不定期',
}

export const FREQUENCY_COLORS = {
  weekly: 'pill pill-blue',
  monthly: 'pill pill-green',
  yearly: 'pill pill-orange',
  adhoc: 'pill pill-gray',
}

export const WEEKDAYS = [
  { val: 1, label: '周一' },
  { val: 2, label: '周二' },
  { val: 3, label: '周三' },
  { val: 4, label: '周四' },
  { val: 5, label: '周五' },
  { val: 6, label: '周六' },
  { val: 0, label: '周日' },
]

export const MONTHS = [
  { val: 1, label: '1月' },
  { val: 2, label: '2月' },
  { val: 3, label: '3月' },
  { val: 4, label: '4月' },
  { val: 5, label: '5月' },
  { val: 6, label: '6月' },
  { val: 7, label: '7月' },
  { val: 8, label: '8月' },
  { val: 9, label: '9月' },
  { val: 10, label: '10月' },
  { val: 11, label: '11月' },
  { val: 12, label: '12月' },
]

export function createEmptyMeeting() {
  const today = new Date().toISOString().split('T')[0]

  return {
    id: '',
    meetingPrefix: DEFAULT_MEETING_PREFIX,
    name: '',
    attendees: '',
    duration: 60,
    frequency: {
      type: 'weekly',
      interval: 1,
      monthSpec: 1,
      daySpec: 1,
      anchorDate: today,
    },
    notes: '',
    noteMentions: [],
    attendeeRefs: [],
    extraInvitees: '',
    extraInviteeRefs: [],
    secretaryInviteContactIds: [],
    notificationTemplateKey: '',
    notificationConfig: {},
    nextDate: '',
    history: [],
    status: 'active',
    customOrder: 0,
  }
}

export function getMeetingFrequencyType(meeting) {
  return typeof meeting.frequency === 'string' ? meeting.frequency : meeting.frequency?.type || 'weekly'
}

export function getMeetingInterval(meeting) {
  if (typeof meeting.frequency === 'string') {
    return meeting.interval ?? 1
  }
  return meeting.frequency?.interval ?? 1
}

export function getMeetingYearlyMonthCount(meeting) {
  if (typeof meeting.frequency === 'string') {
    return meeting.yearlyMonthCount ?? 1
  }

  const monthSpec = meeting.frequency?.monthSpec
  if (Array.isArray(monthSpec)) return monthSpec.length
  return monthSpec ? 1 : 1
}

export function groupMeetingHistory(meeting) {
  const history = [...(meeting.history ?? [])].sort().reverse()
  const frequencyType = getMeetingFrequencyType(meeting)
  const useYearGrouping = frequencyType === 'monthly' || frequencyType === 'yearly'
  const groups = new Map()

  history.forEach((date) => {
    const [year, month, day] = date.split('-')
    const key = useYearGrouping ? year : `${year}-${month}`
    const label = useYearGrouping ? `${year}年` : `${year}年${month}月`
    const itemLabel = useYearGrouping ? `${month}-${day}` : `${day}日`

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        label,
        items: [],
      })
    }

    groups.get(key).items.push({
      value: date,
      label: itemLabel,
    })
  })

  return Array.from(groups.values())
}

export function updateMeetingFrequency(meeting, patch) {
  const current =
    typeof meeting.frequency === 'string'
      ? {
          type: meeting.frequency,
          interval: meeting.interval ?? 1,
          monthSpec: meeting.yearlyMonthCount === 4 ? [1, 4, 7, 10] : 1,
          daySpec: 1,
          anchorDate: meeting.nextDate ?? '',
        }
      : meeting.frequency

  return {
    ...meeting,
    frequency: {
      ...current,
      ...patch,
    },
  }
}

export function normalizeMeeting(meeting) {
  const baseMeeting = {
    ...meeting,
    meetingPrefix: meeting.meetingPrefix ?? DEFAULT_MEETING_PREFIX,
    attendees: meeting.attendees ?? '',
    attendeeRefs: Array.isArray(meeting.attendeeRefs) ? meeting.attendeeRefs : [],
    extraInvitees: meeting.extraInvitees ?? '',
    extraInviteeRefs: Array.isArray(meeting.extraInviteeRefs) ? meeting.extraInviteeRefs : [],
    secretaryInviteContactIds: Array.isArray(meeting.secretaryInviteContactIds) ? meeting.secretaryInviteContactIds : [],
    noteMentions: Array.isArray(meeting.noteMentions) ? meeting.noteMentions : [],
    notificationTemplateKey: meeting.notificationTemplateKey ?? '',
    notificationConfig:
      meeting.notificationConfig && typeof meeting.notificationConfig === 'object'
        ? meeting.notificationConfig
        : {},
  }

  if (typeof meeting.frequency !== 'string') {
    return {
      ...baseMeeting,
      frequency: {
        interval: 1,
        monthSpec: 1,
        daySpec: 1,
        anchorDate: '',
        ...meeting.frequency,
      },
    }
  }

  return {
    ...baseMeeting,
    frequency: {
      type: meeting.frequency,
      interval: meeting.interval ?? 1,
      monthSpec:
        meeting.frequency === 'yearly'
          ? meeting.yearlyMonthCount === 4
            ? [1, 4, 7, 10]
            : meeting.yearlyMonthCount === 2
              ? [1, 7]
              : 1
          : 1,
      daySpec: 1,
      anchorDate: meeting.nextDate ?? '',
    },
  }
}
