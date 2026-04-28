import { INITIAL_MEETINGS, INITIAL_SCHEDULED, normalizeMeeting, STORAGE_KEY } from '../data/meetingData'
import { normalizeNoticeTemplates } from '../features/reserveNotice/notificationTemplates'

export function readStorage() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return {
        meetings: INITIAL_MEETINGS.map(normalizeMeeting),
        scheduled: INITIAL_SCHEDULED,
        noticeTemplates: [],
        disabledNoticeTemplateKeys: [],
      }
    }
    const parsed = JSON.parse(raw)
    return {
      ...parsed,
      meetings: (parsed.meetings ?? []).map(normalizeMeeting),
      noticeTemplates: normalizeNoticeTemplates(parsed.noticeTemplates),
      disabledNoticeTemplateKeys: Array.isArray(parsed.disabledNoticeTemplateKeys)
        ? parsed.disabledNoticeTemplateKeys
        : [],
    }
  } catch {
    return {
      meetings: INITIAL_MEETINGS.map(normalizeMeeting),
      scheduled: INITIAL_SCHEDULED,
      noticeTemplates: [],
      disabledNoticeTemplateKeys: [],
    }
  }
}

export function persistStorage(data) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}
