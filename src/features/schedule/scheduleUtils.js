import { getMeetingFrequencyType } from '../../data/meetingData'
import { generateOccurrencesInRange } from '../../lib/meetingFrequency'

export function generateScheduleInstances(meetings, range, deletedInstances = []) {
  const instances = []

  meetings
    .filter((meeting) => meeting.status === 'active')
    .forEach((meeting) => {
      const frequencyType = getMeetingFrequencyType(meeting)

      if (frequencyType === 'adhoc') {
        return
      }

      generateOccurrencesInRange(meeting, range.start, range.end).forEach((date) => {
        const deleted = deletedInstances.some(
          (item) => item.meetingId === meeting.id && item.date === date,
        )
        if (deleted) {
          return
        }

        instances.push({
          id: `inst-${meeting.id}-${date}`,
          meetingId: meeting.id,
          sourceMeetingId: meeting.id,
          name: meeting.name,
          date,
          attendees: meeting.attendees,
          notes: meeting.notes,
          noteMentions: meeting.noteMentions ?? [],
          duration: meeting.duration,
          frequency: frequencyType,
          sourceFrequency: meeting.frequency,
          sourceAnchorDate: meeting.frequency?.anchorDate || '',
        })
      })
    })

  return instances.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name))
}
