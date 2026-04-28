import { useMemo, useState } from 'react'
import { CalendarDays, Download, Sparkles, Trash2, X } from 'lucide-react'
import { FREQUENCY_COLORS, FREQUENCY_LABELS } from '../../data/meetingData'
import { getCalendarDays, getNextMonthRange } from '../../lib/date'
import { generateScheduleInstances } from './scheduleUtils'

function exportInstances(range, instances) {
  return {
    timeRange: range,
    meetings: instances.map((item) => ({
      id: item.id,
      meetingId: item.meetingId,
      name: item.name,
      date: item.date,
      duration: item.duration,
      attendees: item.attendees,
      notes: item.notes,
      noteMentions: item.noteMentions ?? [],
      frequency: item.frequency,
      sourceMeetingId: item.sourceMeetingId,
      sourceFrequency: item.sourceFrequency,
      sourceAnchorDate: item.sourceAnchorDate,
    })),
    metadata: {
      totalCount: instances.length,
      exportTime: new Date().toISOString(),
    },
  }
}

function getViewType(range) {
  const start = new Date(range.start)
  const end = new Date(range.end)
  const days = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1

  if (days <= 7) return 'week'
  if (days <= 31) return 'month'
  if (days <= 93) return 'multi-month'
  return 'list'
}

function getMonthsInRange(range) {
  const current = new Date(range.start)
  current.setDate(1)
  const end = new Date(range.end)
  const months = []

  while (current <= end) {
    months.push({
      year: current.getFullYear(),
      month: current.getMonth(),
    })
    current.setMonth(current.getMonth() + 1)
  }

  return months
}

export function ScheduleView({ meetings }) {
  const [range, setRange] = useState(getNextMonthRange())
  const [hasGenerated, setHasGenerated] = useState(false)
  const [instances, setInstances] = useState([])
  const [deletedInstances, setDeletedInstances] = useState([])
  const [selectedIds, setSelectedIds] = useState([])
  const [previewOpen, setPreviewOpen] = useState(false)
  const [dayDetail, setDayDetail] = useState(null)
  const [currentMonthIndex, setCurrentMonthIndex] = useState(0)

  const generatedInstances = useMemo(
    () => generateScheduleInstances(meetings, range, deletedInstances),
    [meetings, range, deletedInstances],
  )
  const summary = useMemo(() => {
    return instances.reduce((accumulator, item) => {
      accumulator[item.frequency] = (accumulator[item.frequency] ?? 0) + 1
      return accumulator
    }, {})
  }, [instances])
  const exportData = useMemo(() => exportInstances(range, instances), [instances, range])
  const viewType = useMemo(() => getViewType(range), [range])
  const months = useMemo(() => getMonthsInRange(range), [range])
  const meetingsByDate = useMemo(() => {
    return instances.reduce((accumulator, meeting) => {
      const current = accumulator.get(meeting.date) ?? []
      current.push(meeting)
      accumulator.set(meeting.date, current)
      return accumulator
    }, new Map())
  }, [instances])

  function handleGenerate() {
    setInstances(generatedInstances)
    setSelectedIds([])
    setHasGenerated(true)
  }

  function toggleSelected(id) {
    setSelectedIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
  }

  function deleteOne(id) {
    const target = instances.find((item) => item.id === id)
    if (target) {
      setDeletedInstances((current) => [...current, { meetingId: target.meetingId, date: target.date }])
    }
    setInstances((current) => current.filter((item) => item.id !== id))
    setSelectedIds((current) => current.filter((item) => item !== id))
  }

  function deleteSelected() {
    const deleted = instances
      .filter((item) => selectedIds.includes(item.id))
      .map((item) => ({ meetingId: item.meetingId, date: item.date }))
    setDeletedInstances((current) => [...current, ...deleted])
    setInstances((current) => current.filter((item) => !selectedIds.includes(item.id)))
    setSelectedIds([])
  }

  function clearAll() {
    setInstances([])
    setDeletedInstances([])
    setSelectedIds([])
    setHasGenerated(false)
  }

  function downloadExport() {
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `schedule-${range.start}-${range.end}.json`
    link.click()
    URL.revokeObjectURL(url)
    setPreviewOpen(false)
  }

  function renderCalendarMonth(year, month) {
    const days = getCalendarDays(year, month)
    return (
      <div className="schedule-calendar-block">
        <div className="month-grid month-grid-head">
          {['周一', '周二', '周三', '周四', '周五', '周六', '周日'].map((label) => (
            <div key={label} className="month-head-cell">
              {label}
            </div>
          ))}
        </div>
        <div className="month-grid">
          {days.map((day) => {
            const items = meetingsByDate.get(day.date) ?? []
            return (
              <div
                key={day.date}
                className={day.isCurrentMonth ? 'month-cell' : 'month-cell month-cell-muted'}
                onClick={() => setDayDetail({ date: day.date, meetings: items })}
              >
                <div className="month-cell-day">{day.day}</div>
                <div className="month-cell-items">
                  {items.slice(0, 4).map((item) => (
                    <div key={item.id} className="month-item">
                      <span className="truncate-line">{item.name}</span>
                    </div>
                  ))}
                  {items.length > 4 ? <div className="month-more">+{items.length - 4} 更多</div> : null}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="schedule-layout">
      <section className="panel">
        <div className="section-title">
          <CalendarDays size={18} />
          <h2>会议安排</h2>
        </div>
        <div className="panel-grid">
          <label className="field">
            <span>开始日期</span>
            <input
              type="date"
              value={range.start}
              onChange={(event) => setRange({ ...range, start: event.target.value })}
            />
          </label>
          <label className="field">
            <span>结束日期</span>
            <input
              type="date"
              value={range.end}
              onChange={(event) => setRange({ ...range, end: event.target.value })}
            />
          </label>
        </div>
        <div className="panel-actions">
          <button className="ghost-button" onClick={() => setRange(getNextMonthRange())}>
            恢复下月
          </button>
          <button className="primary-button" onClick={handleGenerate}>
            生成会议实例
          </button>
        </div>
      </section>

      {!hasGenerated || instances.length === 0 ? (
        <section className="panel empty-state">
          <p>设置时间范围后生成会议实例。</p>
        </section>
      ) : (
        <>
          <section className="panel">
            <div className="section-title">
              <Sparkles size={18} />
              <h2>导出摘要</h2>
            </div>
            <div className="summary-row">
              <div className="summary-card">
                <span>总实例数</span>
                <strong>{instances.length}</strong>
              </div>
              <div className="summary-card">
                <span>已取消</span>
                <strong>{deletedInstances.length}</strong>
              </div>
              {Object.entries(FREQUENCY_LABELS).map(([key, label]) => (
                <div key={key} className="summary-card">
                  <span>{label}</span>
                  <strong>{summary[key] ?? 0}</strong>
                </div>
              ))}
            </div>
            <div className="panel-actions">
              <button className="ghost-button" onClick={() => setPreviewOpen(true)}>
                <Download size={16} />
                导出预览
              </button>
              <button className="ghost-button" onClick={deleteSelected} disabled={selectedIds.length === 0}>
                <Trash2 size={16} />
                批量删除
              </button>
              <button className="ghost-button" onClick={clearAll}>
                清空实例
              </button>
            </div>
          </section>

          {viewType === 'month' || viewType === 'multi-month' ? (
            <section className="panel">
              <div className="section-title">
                <CalendarDays size={18} />
                <h2>{viewType === 'month' ? '月历视图' : '多月视图'}</h2>
              </div>
              {viewType === 'multi-month' && months.length > 1 ? (
                <div className="month-nav">
                  <button
                    className="ghost-button"
                    onClick={() => setCurrentMonthIndex((current) => Math.max(0, current - 1))}
                    disabled={currentMonthIndex === 0}
                  >
                    上月
                  </button>
                  <strong>
                    {months[currentMonthIndex].year} 年 {months[currentMonthIndex].month + 1} 月
                  </strong>
                  <button
                    className="ghost-button"
                    onClick={() =>
                      setCurrentMonthIndex((current) => Math.min(months.length - 1, current + 1))
                    }
                    disabled={currentMonthIndex === months.length - 1}
                  >
                    下月
                  </button>
                </div>
              ) : null}
              {viewType === 'month'
                ? renderCalendarMonth(new Date(range.start).getFullYear(), new Date(range.start).getMonth())
                : renderCalendarMonth(months[currentMonthIndex].year, months[currentMonthIndex].month)}
            </section>
          ) : null}

          <section className="panel">
            <div className="section-title">
              <CalendarDays size={18} />
              <h2>实例列表</h2>
            </div>
            <div className="schedule-list">
              {instances.map((item) => (
                <div key={item.id} className="schedule-item">
                  <div className="schedule-item-main">
                    <label className="checkbox-chip">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(item.id)}
                        onChange={() => toggleSelected(item.id)}
                      />
                      <span>选中</span>
                    </label>
                    <div>
                      <strong>{item.name}</strong>
                      <p>
                        {item.date} · {item.duration} 分钟
                      </p>
                      {item.attendees ? <p className="preserve-lines">{item.attendees}</p> : null}
                    </div>
                  </div>
                  <div className="review-actions">
                    <span className={FREQUENCY_COLORS[item.frequency]}>
                      {FREQUENCY_LABELS[item.frequency]}
                    </span>
                    <button className="icon-button danger" onClick={() => deleteOne(item.id)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      {previewOpen ? (
        <div className="modal-backdrop" onClick={() => setPreviewOpen(false)}>
          <div className="modal-card modal-wide" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h2>导出会议安排 JSON</h2>
              <button className="icon-button" onClick={() => setPreviewOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <pre className="code-block">{JSON.stringify(exportData, null, 2)}</pre>
            <div className="panel-actions">
              <button className="ghost-button" onClick={() => navigator.clipboard.writeText(JSON.stringify(exportData, null, 2))}>
                复制 JSON
              </button>
              <button className="primary-button" onClick={downloadExport}>
                下载 JSON
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {dayDetail ? (
        <div className="modal-backdrop" onClick={() => setDayDetail(null)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h2>{dayDetail.date} 会议实例</h2>
              <button className="icon-button" onClick={() => setDayDetail(null)}>
                <X size={18} />
              </button>
            </div>
            {dayDetail.meetings.length === 0 ? (
              <div className="empty-state">当天没有会议实例。</div>
            ) : (
              <div className="schedule-list">
                {dayDetail.meetings.map((item) => (
                  <div key={item.id} className="schedule-item">
                    <div>
                      <strong>{item.name}</strong>
                      <p>{item.duration} 分钟</p>
                    </div>
                    <span className={FREQUENCY_COLORS[item.frequency]}>
                      {FREQUENCY_LABELS[item.frequency]}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
