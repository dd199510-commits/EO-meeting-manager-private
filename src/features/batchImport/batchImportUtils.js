function normalizeMeetingName(name) {
  return name.replace(/【.*?】|\[.*?\]|\(.*?\)|^\s*常规会议\s*[:：]?\s*/g, '').trim()
}

function parseDateValue(value) {
  const text = value.trim()
  const matchers = [
    /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/,
    /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/,
    /^(\d{4})(\d{2})(\d{2})$/,
  ]

  for (const matcher of matchers) {
    const match = text.match(matcher)
    if (!match) continue

    if (matcher === matchers[0]) {
      return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
    }
    if (matcher === matchers[1]) {
      return `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`
    }
    return `${match[1]}-${match[2]}-${match[3]}`
  }

  return null
}

function findMeetingMatch(name, meetings) {
  const normalized = normalizeMeetingName(name)
  const activeMeetings = meetings.filter((meeting) => meeting.status === 'active')

  return (
    activeMeetings.find((meeting) => meeting.name === name) ||
    activeMeetings.find((meeting) => meeting.name === normalized) ||
    activeMeetings.find((meeting) => meeting.name.includes(normalized)) ||
    activeMeetings.find((meeting) => normalized.includes(meeting.name)) ||
    null
  )
}

export function parseBatchImportText(text, meetings) {
  const lines = text
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length < 2) {
    throw new Error('至少需要表头和一行数据')
  }

  const headers = lines[0].split('\t')
  const nameIndex = headers.findIndex((header) =>
    ['主题', '名称', '标题', 'subject'].some((keyword) =>
      header.toLowerCase().includes(keyword.toLowerCase()),
    ),
  )
  const dateIndex = headers.findIndex((header) =>
    ['开始日期', '日期', 'start date'].some((keyword) =>
      header.toLowerCase().includes(keyword.toLowerCase()),
    ),
  )

  if (nameIndex === -1 || dateIndex === -1) {
    throw new Error('未找到“主题/名称”和“日期”列')
  }

  return lines.slice(1).map((line, index) => {
    const columns = line.split('\t')
    const originalName = columns[nameIndex]?.trim()
    const date = parseDateValue(columns[dateIndex] ?? '')

    if (!originalName || !date) {
      return {
        id: `row-${index}`,
        originalName: originalName || '(空)',
        date: date || '',
        matchedMeeting: null,
        valid: false,
      }
    }

    const matchedMeeting = findMeetingMatch(originalName, meetings)
    return {
      id: `row-${index}`,
      originalName,
      date,
      matchedMeeting,
      valid: Boolean(matchedMeeting),
      isDuplicate: Boolean(matchedMeeting?.history?.includes(date)),
    }
  })
}
