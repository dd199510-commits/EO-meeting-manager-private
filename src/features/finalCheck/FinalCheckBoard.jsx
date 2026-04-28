import { useMemo, useRef, useState } from 'react'
import { CheckCircle2, Filter, Search, X } from 'lucide-react'
import { FREQUENCY_LABELS } from '../../data/meetingData'
import { getCalendarDays } from '../../lib/date'
import { generateOccurrencesInRange } from '../../lib/meetingFrequency'

function getMonthsInRange(range) {
  if (!range?.start || !range?.end) return []

  const current = new Date(range.start)
  current.setDate(1)
  const end = new Date(range.end)
  const months = []

  while (current <= end) {
    months.push({
      key: `${current.getFullYear()}-${current.getMonth() + 1}`,
      year: current.getFullYear(),
      month: current.getMonth(),
    })
    current.setMonth(current.getMonth() + 1)
  }

  return months
}

function summarizeText(value, fallback = '未填写') {
  if (!value) return fallback
  const normalized = String(value).replace(/\s+/g, ' ').trim()
  if (!normalized) return fallback
  return normalized
}

function getFrequencyTone(type) {
  if (type === 'weekly') return 'blue'
  if (type === 'monthly') return 'green'
  if (type === 'yearly') return 'orange'
  return 'gray'
}

function getCheckStatus(row, checked) {
  if (row.expectedCount === 0 && row.actualCount > 0) {
    return { code: 'warning', label: '疑似误排' }
  }

  if (row.expectedCount > row.actualCount) {
    return { code: 'warning', label: '疑似遗漏' }
  }

  if (row.expectedCount < row.actualCount) {
    return { code: 'warning', label: '次数异常' }
  }

  if (row.noteMentionCount > 0) {
    return { code: 'attention', label: '需核验关联约束' }
  }

  if (checked) {
    return { code: 'ok', label: '已确认' }
  }

  return { code: 'default', label: row.expectedCount === 0 ? '不在本时间段' : '待检查' }
}

function timeToMinutes(time) {
  const [hours, minutes] = String(time || '09:00').split(':').map(Number)
  return hours * 60 + minutes
}

function minutesToTime(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

export function FinalCheckBoard({
  meetings,
  scheduledMeetings,
  reviewState,
  onToggleChecked,
  onRestoreMissingInstance,
}) {
  const [selectedMeetingId, setSelectedMeetingId] = useState('')
  const [filterType, setFilterType] = useState('all')
  const [searchText, setSearchText] = useState('')
  const [restoreDraft, setRestoreDraft] = useState(null)
  const rowRefs = useRef(new Map())
  const sourceRange = reviewState?.sourceInputMeetings?.timeRange ?? null
  const checkStatusMap = useMemo(() => reviewState?.finalCheckStatus ?? {}, [reviewState])

  const activeMeetings = useMemo(
    () => (Array.isArray(meetings) ? meetings.filter((meeting) => meeting.status === 'active') : []),
    [meetings],
  )

  const scheduledByMeetingId = useMemo(() => {
    return scheduledMeetings.reduce((accumulator, meeting) => {
      if (!meeting.meetingId) return accumulator
      const current = accumulator.get(meeting.meetingId) ?? []
      current.push(meeting)
      accumulator.set(meeting.meetingId, current)
      return accumulator
    }, new Map())
  }, [scheduledMeetings])

  const aiUnscheduledNames = useMemo(() => {
    return new Set(
      Array.isArray(reviewState?.aiSummary?.unscheduledMeetingNames)
        ? reviewState.aiSummary.unscheduledMeetingNames
        : [],
    )
  }, [reviewState])

  const rows = useMemo(() => {
    return activeMeetings
      .map((meeting) => {
        const expectedDates =
          sourceRange?.start && sourceRange?.end
            ? generateOccurrencesInRange(meeting, sourceRange.start, sourceRange.end)
            : []
        const actualInstances = scheduledByMeetingId.get(meeting.id) ?? []
        const actualDateSet = new Set(actualInstances.map((instance) => instance.date))
        const missingDates = expectedDates.filter((date) => !actualDateSet.has(date))
        const checked = Boolean(checkStatusMap[meeting.id])
        const status = getCheckStatus(
          {
            expectedCount: expectedDates.length,
            actualCount: actualInstances.length,
            noteMentionCount: Array.isArray(meeting.noteMentions) ? meeting.noteMentions.length : 0,
          },
          checked,
        )

        return {
          id: meeting.id,
          meeting,
          checked,
          status,
          expectedDates,
          expectedCount: expectedDates.length,
          actualCount: actualInstances.length,
          actualInstances,
          missingDates,
          noteMentionCount: Array.isArray(meeting.noteMentions) ? meeting.noteMentions.length : 0,
          inAIAttention: aiUnscheduledNames.has(meeting.name),
        }
      })
      .sort((left, right) => {
        if (left.status.code !== right.status.code) {
          const order = { warning: 0, attention: 1, default: 2, ok: 3 }
          return order[left.status.code] - order[right.status.code]
        }
        return left.meeting.name.localeCompare(right.meeting.name, 'zh-CN')
      })
  }, [activeMeetings, aiUnscheduledNames, checkStatusMap, scheduledByMeetingId, sourceRange])

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      const search = searchText.trim().toLowerCase()
      if (search) {
        const haystack = `${row.meeting.name} ${row.meeting.attendees ?? ''} ${row.meeting.notes ?? ''}`.toLowerCase()
        if (!haystack.includes(search)) return false
      }

      if (filterType === 'unchecked') return !row.checked
      if (filterType === 'warning') return row.status.code === 'warning'
      if (filterType === 'checked') return row.checked
      return true
    })
  }, [filterType, rows, searchText])

  const selectedMeeting = useMemo(
    () => filteredRows.find((row) => row.id === selectedMeetingId) ?? rows.find((row) => row.id === selectedMeetingId) ?? null,
    [filteredRows, rows, selectedMeetingId],
  )
  const checkedCount = useMemo(() => rows.filter((row) => row.checked).length, [rows])
  const restoreRow = useMemo(
    () => (restoreDraft ? rows.find((item) => item.id === restoreDraft.rowId) ?? null : null),
    [restoreDraft, rows],
  )

  const months = useMemo(() => getMonthsInRange(sourceRange), [sourceRange])

  function handleSelectMeeting(meetingId) {
    setSelectedMeetingId(meetingId)
  }

  function handleSelectFromCalendar(meetingId) {
    setSelectedMeetingId(meetingId)
    const element = rowRefs.current.get(meetingId)
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }

  function openRestoreModal(row, event) {
    event.stopPropagation()
    const referenceInstance = row.actualInstances[0] ?? null
    const defaultStartTime = referenceInstance?.startTime ?? '09:00'
    const defaultDate = row.missingDates[0] ?? row.expectedDates[0] ?? sourceRange?.start ?? ''
    setRestoreDraft({
      rowId: row.id,
      date: defaultDate,
      startTime: defaultStartTime,
    })
  }

  function closeRestoreModal() {
    setRestoreDraft(null)
  }

  function handleRestoreSubmit() {
    if (!restoreDraft) return
    const row = restoreRow
    if (!row || !restoreDraft.date || !restoreDraft.startTime) return

    const endTime = minutesToTime(timeToMinutes(restoreDraft.startTime) + row.meeting.duration)
    onRestoreMissingInstance({
      meeting: row.meeting,
      date: restoreDraft.date,
      startTime: restoreDraft.startTime,
      endTime,
    })
    setSelectedMeetingId(row.id)
    closeRestoreModal()
  }

  return (
    <section className="panel final-check-shell">
      <div className="final-check-topbar">
        <div className="final-check-range">
          {sourceRange?.start && sourceRange?.end
            ? `${sourceRange.start} 至 ${sourceRange.end}`
            : '暂无范围'}
        </div>
        <div className="final-check-progress">
          <div className="final-check-progress-label">
            <CheckCircle2 size={15} />
            <span>检查进度</span>
          </div>
          <strong>
            {checkedCount} / {rows.length}
          </strong>
        </div>
      </div>

      <div className="final-check-layout">
        <div className="final-check-list-panel">
          <div className="final-check-toolbar">
            <label className="final-check-search">
              <Search size={15} />
              <input
                type="text"
                placeholder="搜索会议名称、参会人或备注"
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
              />
            </label>
            <div className="final-check-filters">
              <Filter size={15} />
              <button
                type="button"
                className={filterType === 'all' ? 'final-check-filter final-check-filter-active' : 'final-check-filter'}
                onClick={() => setFilterType('all')}
              >
                全部
              </button>
              <button
                type="button"
                className={filterType === 'unchecked' ? 'final-check-filter final-check-filter-active' : 'final-check-filter'}
                onClick={() => setFilterType('unchecked')}
              >
                未检查
              </button>
              <button
                type="button"
                className={filterType === 'warning' ? 'final-check-filter final-check-filter-active' : 'final-check-filter'}
                onClick={() => setFilterType('warning')}
              >
                疑似遗漏
              </button>
              <button
                type="button"
                className={filterType === 'checked' ? 'final-check-filter final-check-filter-active' : 'final-check-filter'}
                onClick={() => setFilterType('checked')}
              >
                已确认
              </button>
            </div>
          </div>

          <div className="final-check-list">
            {filteredRows.map((row) => (
              <article
                key={row.id}
                ref={(element) => {
                  if (element) {
                    rowRefs.current.set(row.id, element)
                  } else {
                    rowRefs.current.delete(row.id)
                  }
                }}
                className={
                  row.id === selectedMeetingId
                    ? 'final-check-item final-check-item-active'
                    : 'final-check-item'
                }
                onClick={() => handleSelectMeeting(row.id)}
              >
                <div className="final-check-item-head">
                  <div className="final-check-item-head-main">
                    <span className={`final-check-frequency-mark final-check-frequency-mark-${getFrequencyTone(row.meeting.frequency.type)}`}>
                      {FREQUENCY_LABELS[row.meeting.frequency.type] ?? '不定期'}
                    </span>
                    <strong>{row.meeting.name}</strong>
                    <span className={`final-check-status final-check-status-${row.status.code}`}>
                      {row.status.label}
                    </span>
                    {row.inAIAttention ? (
                      <span className="final-check-flag">注意事项涉及</span>
                    ) : null}
                  </div>
                  <label
                    className="final-check-checkbox"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={row.checked}
                      onChange={() => onToggleChecked(row.id)}
                    />
                    <span>{row.checked ? '已检查' : '待检查'}</span>
                  </label>
                </div>

                <div className="final-check-item-meta">
                  <span>{row.meeting.duration} 分钟</span>
                  <span>
                    最近发生 {row.meeting.history?.length ? row.meeting.history[row.meeting.history.length - 1] : '无'}
                  </span>
                  <span>应发生 {row.expectedCount} 次</span>
                  <span>已排入 {row.actualCount} 次</span>
                  {row.missingDates.length > 0 ? (
                    <button
                      type="button"
                      className="final-check-restore-button"
                      onClick={(event) => openRestoreModal(row, event)}
                    >
                      补进方案
                    </button>
                  ) : null}
                </div>

                <div className="final-check-item-detail">
                  <div className="final-check-item-detail-block">
                    <span className="final-check-item-label">本时间段</span>
                    <p>
                      {row.expectedCount > 0
                        ? row.expectedDates.join('、')
                        : '不在此时间段发生'}
                    </p>
                  </div>
                  <div className="final-check-item-detail-block">
                    <span className="final-check-item-label">参会人</span>
                    <p>{summarizeText(row.meeting.attendees, '未填写参会人')}</p>
                  </div>
                  <div className="final-check-item-detail-block final-check-item-detail-block-wide">
                    <span className="final-check-item-label">备注</span>
                    <p>{summarizeText(row.meeting.notes, '未填写备注')}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="final-check-calendar-panel">
          <div className="final-check-calendar-head">
            <strong>方案对照月视图</strong>
            <div className="final-check-calendar-caption">
              {selectedMeeting ? `当前：${selectedMeeting.meeting.name}` : '选择会议查看'}
            </div>
          </div>

          <div className="final-check-calendar-stack">
            {months.map((monthItem) => {
              const days = getCalendarDays(monthItem.year, monthItem.month)
              return (
                <div key={monthItem.key} className="final-check-month">
                  <div className="final-check-month-title">
                    {monthItem.year} 年 {monthItem.month + 1} 月
                  </div>
                  <div className="final-check-month-grid final-check-month-grid-head">
                    {['周一', '周二', '周三', '周四', '周五', '周六', '周日'].map((label) => (
                      <div key={label} className="final-check-month-head-cell">
                        {label}
                      </div>
                    ))}
                  </div>
                  <div className="final-check-month-grid">
                    {days.map((day) => {
                      const dayMeetings = scheduledMeetings
                        .filter((meeting) => meeting.date === day.date)
                        .sort((left, right) => left.startTime.localeCompare(right.startTime))
                      return (
                        <div
                          key={day.date}
                          className={day.isCurrentMonth ? 'final-check-day' : 'final-check-day final-check-day-muted'}
                        >
                          <div className="final-check-day-label">{day.day}</div>
                          <div className="final-check-day-items">
                            {dayMeetings.length === 0 ? (
                              <div className="final-check-day-empty">—</div>
                            ) : (
                              dayMeetings.map((meeting) => (
                                <button
                                  key={meeting.id}
                                  type="button"
                                  className={
                                    meeting.meetingId === selectedMeetingId
                                      ? 'final-check-chip final-check-chip-active'
                                      : selectedMeetingId
                                        ? 'final-check-chip final-check-chip-muted'
                                        : 'final-check-chip'
                                  }
                                  onClick={() => handleSelectFromCalendar(meeting.meetingId)}
                                >
                                  <strong>{meeting.name}</strong>
                                  <span>
                                    {meeting.startTime} - {meeting.endTime}
                                  </span>
                                </button>
                              ))
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {restoreDraft && restoreRow ? (
        <div className="modal-backdrop modal-open" onClick={closeRestoreModal}>
          <div className="modal-card modal-card-open final-check-restore-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2>补进方案</h2>
                <p className="meeting-notes">{restoreRow.meeting.name}</p>
              </div>
              <button className="icon-button" onClick={closeRestoreModal}>
                <X size={16} />
              </button>
            </div>

            <div className="final-check-restore-content">
              <div className="final-check-restore-summary">
                <span>{FREQUENCY_LABELS[restoreRow.meeting.frequency.type] ?? '不定期'}</span>
                <span>{restoreRow.meeting.duration} 分钟</span>
                <span>
                  推荐日期：
                  {restoreRow.missingDates.length > 0 ? restoreRow.missingDates.join('、') : '未识别缺失日期'}
                </span>
              </div>
              <div className="panel-grid">
                <label className="field">
                  <span>安排日期</span>
                  <input
                    type="date"
                    value={restoreDraft.date}
                    onChange={(event) =>
                      setRestoreDraft((current) => ({ ...current, date: event.target.value }))
                    }
                  />
                </label>
                <label className="field">
                  <span>开始时间</span>
                  <input
                    type="time"
                    step="900"
                    value={restoreDraft.startTime}
                    onChange={(event) =>
                      setRestoreDraft((current) => ({ ...current, startTime: event.target.value }))
                    }
                  />
                </label>
                <div className="field">
                  <span>结束时间</span>
                  <div className="field-static-value">
                    {minutesToTime(timeToMinutes(restoreDraft.startTime) + restoreRow.meeting.duration)}
                  </div>
                </div>
              </div>
              {restoreRow.missingDates.length > 0 ? (
                <div className="final-check-restore-suggestions">
                  <span className="final-check-item-label">推荐日期</span>
                  <div className="final-check-restore-suggestion-row">
                    {restoreRow.missingDates.map((date) => (
                      <button
                        key={date}
                        type="button"
                        className={
                          restoreDraft.date === date
                            ? 'final-check-restore-suggestion final-check-restore-suggestion-active'
                            : 'final-check-restore-suggestion'
                        }
                        onClick={() =>
                          setRestoreDraft((current) => ({ ...current, date }))
                        }
                      >
                        {date}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="final-check-restore-actions">
                <button className="ghost-button" onClick={closeRestoreModal}>
                  取消
                </button>
                <button className="primary-button" onClick={handleRestoreSubmit}>
                  补进审核方案
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
