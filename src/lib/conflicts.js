export function detectConflicts(scheduledMeetings) {
  const byDate = new Map()

  for (const meeting of scheduledMeetings) {
    const current = byDate.get(meeting.date) ?? []
    current.push(meeting)
    byDate.set(meeting.date, current)
  }

  const conflicts = []

  for (const [date, list] of byDate.entries()) {
    const sorted = [...list].sort((a, b) => a.startTime.localeCompare(b.startTime))

    for (let index = 0; index < sorted.length - 1; index += 1) {
      const current = sorted[index]
      const next = sorted[index + 1]

      if (current.endTime > next.startTime) {
        conflicts.push({
          id: `${current.id}-${next.id}`,
          date,
          description: `${current.name} 与 ${next.name} 时间重叠`,
          meetingIds: [current.id, next.id],
        })
      }
    }
  }

  return conflicts
}
