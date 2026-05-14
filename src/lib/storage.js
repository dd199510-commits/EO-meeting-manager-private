import { INITIAL_CONTACTS, INITIAL_MEETINGS, INITIAL_SCHEDULED, normalizeMeeting, STORAGE_KEY } from '../data/meetingData'
import { normalizeContact, resolveAttendeeRefs } from './contacts'
import { normalizeNoticeTemplates } from '../features/reserveNotice/notificationTemplates'
import { IS_PUBLIC_EMPTY_BUILD } from './publicBuild'

function createEmptyStorage() {
  return {
    meetings: [],
    scheduled: [],
    contacts: [],
    noticeTemplates: [],
    disabledNoticeTemplateKeys: [],
  }
}

export function readStorage() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      if (IS_PUBLIC_EMPTY_BUILD) return createEmptyStorage()

      const contacts = INITIAL_CONTACTS.map(normalizeContact)
      return {
        meetings: INITIAL_MEETINGS.map((meeting) => ({
          ...normalizeMeeting(meeting),
          attendeeRefs: resolveAttendeeRefs(meeting.attendees, contacts),
          extraInviteeRefs: resolveAttendeeRefs(meeting.extraInvitees, contacts),
        })),
        scheduled: INITIAL_SCHEDULED,
        contacts,
        noticeTemplates: [],
        disabledNoticeTemplateKeys: [],
      }
    }
    const parsed = JSON.parse(raw)
    const contacts = (parsed.contacts ?? INITIAL_CONTACTS).map(normalizeContact)
    return {
      ...parsed,
      meetings: (parsed.meetings ?? []).map((meeting) => {
        const normalizedMeeting = normalizeMeeting(meeting)
        return {
          ...normalizedMeeting,
          attendeeRefs: resolveAttendeeRefs(normalizedMeeting.attendees, contacts),
          extraInviteeRefs: resolveAttendeeRefs(normalizedMeeting.extraInvitees, contacts),
        }
      }),
      scheduled: Array.isArray(parsed.scheduled) ? parsed.scheduled : INITIAL_SCHEDULED,
      contacts,
      noticeTemplates: normalizeNoticeTemplates(parsed.noticeTemplates),
      disabledNoticeTemplateKeys: Array.isArray(parsed.disabledNoticeTemplateKeys)
        ? parsed.disabledNoticeTemplateKeys
        : [],
    }
  } catch {
    if (IS_PUBLIC_EMPTY_BUILD) return createEmptyStorage()

    const contacts = INITIAL_CONTACTS.map(normalizeContact)
    return {
      meetings: INITIAL_MEETINGS.map((meeting) => ({
        ...normalizeMeeting(meeting),
        attendeeRefs: resolveAttendeeRefs(meeting.attendees, contacts),
        extraInviteeRefs: resolveAttendeeRefs(meeting.extraInvitees, contacts),
      })),
      scheduled: INITIAL_SCHEDULED,
      contacts,
      noticeTemplates: [],
      disabledNoticeTemplateKeys: [],
    }
  }
}

export function persistStorage(data) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}
