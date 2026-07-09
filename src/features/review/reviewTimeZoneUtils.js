export const SOURCE_REVIEW_TIME_ZONE = 'Asia/Shanghai'
export const DEFAULT_REVIEW_TIME_ZONE = SOURCE_REVIEW_TIME_ZONE

export const REVIEW_TIME_ZONE_OPTIONS = [
  { value: 'Asia/Shanghai', label: '北京时间', shortLabel: '北京' },
  { value: 'America/New_York', label: '美东时间', shortLabel: '美东' },
  { value: 'America/Los_Angeles', label: '美西时间', shortLabel: '美西' },
  { value: 'America/Denver', label: '美国山地时间', shortLabel: '山地' },
]

const formatterCache = new Map()

function getFormatter(timeZone) {
  if (!formatterCache.has(timeZone)) {
    formatterCache.set(
      timeZone,
      new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }),
    )
  }
  return formatterCache.get(timeZone)
}

function parseDateTime(date, time) {
  const [year, month, day] = String(date || '').split('-').map(Number)
  const [hour, minute] = String(time || '').split(':').map(Number)
  if (!year || !month || !day || Number.isNaN(hour) || Number.isNaN(minute)) return null
  return { year, month, day, hour, minute }
}

function getZonedParts(date, timeZone) {
  const parts = getFormatter(timeZone).formatToParts(date)
  const values = {}
  parts.forEach((part) => {
    if (part.type !== 'literal') values[part.type] = part.value
  })
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
  }
}

function formatParts(parts) {
  return {
    date: `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`,
    time: `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`,
  }
}

function getReferenceInstant(referenceDate) {
  if (referenceDate instanceof Date) return referenceDate
  if (typeof referenceDate === 'string' && referenceDate) {
    return new Date(`${referenceDate}T12:00:00Z`)
  }
  return new Date()
}

function getUtcOffsetMinutes(instant, timeZone) {
  const parts = getZonedParts(instant, timeZone)
  const zonedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute)
  return Math.round((zonedAsUtc - instant.getTime()) / 60000)
}

function formatDuration(minutes) {
  const absoluteMinutes = Math.abs(minutes)
  const hours = Math.floor(absoluteMinutes / 60)
  const remainingMinutes = absoluteMinutes % 60
  if (!remainingMinutes) return `${hours} 小时`
  return `${hours} 小时 ${remainingMinutes} 分钟`
}

function formatUtcOffset(offsetMinutes) {
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const absoluteMinutes = Math.abs(offsetMinutes)
  const hours = Math.floor(absoluteMinutes / 60)
  const minutes = absoluteMinutes % 60
  return `UTC${sign}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

export function formatInstantInTimeZone(instant, timeZone) {
  return formatParts(getZonedParts(instant, timeZone))
}

export function getTimeZoneDifferenceInfo(timeZone, referenceDate) {
  if (timeZone === SOURCE_REVIEW_TIME_ZONE) return null

  const referenceInstant = getReferenceInstant(referenceDate)
  const selectedOffset = getUtcOffsetMinutes(referenceInstant, timeZone)
  const sourceOffset = getUtcOffsetMinutes(referenceInstant, SOURCE_REVIEW_TIME_ZONE)
  const diffMinutes = selectedOffset - sourceOffset
  const relation = diffMinutes >= 0 ? '快' : '慢'
  const utcOffset = formatUtcOffset(selectedOffset)

  return {
    text: `比北京${relation} ${formatDuration(diffMinutes)} · ${utcOffset}`,
    title: `按 ${formatInstantInTimeZone(referenceInstant, SOURCE_REVIEW_TIME_ZONE).date} 计算，已考虑冬夏令时`,
  }
}

export function zonedDateTimeToInstant(date, time, timeZone) {
  const target = parseDateTime(date, time)
  if (!target) return null

  let guess = new Date(Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute))

  for (let index = 0; index < 4; index += 1) {
    const actual = getZonedParts(guess, timeZone)
    const targetUtc = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute)
    const actualUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute)
    const deltaMinutes = (targetUtc - actualUtc) / 60000
    if (deltaMinutes === 0) break
    guess = new Date(guess.getTime() + deltaMinutes * 60000)
  }

  return guess
}

export function convertScheduleSlot(date, startTime, endTime, fromTimeZone, toTimeZone) {
  const startInstant = zonedDateTimeToInstant(date, startTime, fromTimeZone)
  const endInstantBase = zonedDateTimeToInstant(date, endTime, fromTimeZone)
  if (!startInstant || !endInstantBase) return { date, startTime, endTime }

  let endInstant = endInstantBase
  if (endInstant <= startInstant) {
    endInstant = new Date(endInstant.getTime() + 24 * 60 * 60000)
  }

  const convertedStart = formatInstantInTimeZone(startInstant, toTimeZone)
  const convertedEnd = formatInstantInTimeZone(endInstant, toTimeZone)

  return {
    date: convertedStart.date,
    startTime: convertedStart.time,
    endDate: convertedEnd.date,
    endTime: convertedEnd.time,
  }
}

export function convertMeetingToTimeZone(meeting, timeZone, sourceTimeZone = SOURCE_REVIEW_TIME_ZONE) {
  if (!meeting?.date || !meeting?.startTime || !meeting?.endTime || timeZone === sourceTimeZone) {
    return meeting
  }

  const converted = convertScheduleSlot(
    meeting.date,
    meeting.startTime,
    meeting.endTime,
    sourceTimeZone,
    timeZone,
  )

  return {
    ...meeting,
    sourceDate: meeting.date,
    sourceStartTime: meeting.startTime,
    sourceEndTime: meeting.endTime,
    date: converted.date,
    startTime: converted.startTime,
    endDate: converted.endDate,
    endTime: converted.endTime,
    displayTimeZone: timeZone,
  }
}

export function convertDisplaySlotToSource(date, startTime, endTime, displayTimeZone) {
  if (displayTimeZone === SOURCE_REVIEW_TIME_ZONE) {
    return { date, startTime, endTime }
  }

  const converted = convertScheduleSlot(
    date,
    startTime,
    endTime,
    displayTimeZone,
    SOURCE_REVIEW_TIME_ZONE,
  )

  return {
    date: converted.date,
    startTime: converted.startTime,
    endTime: converted.endTime,
  }
}
