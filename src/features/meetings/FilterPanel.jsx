import { useEffect, useState } from 'react'
import { FREQUENCY_LABELS } from '../../data/meetingData'

export function FilterPanel({ open, filters, onChange, onReset }) {
  const [draft, setDraft] = useState(filters)

  useEffect(() => {
    setDraft(filters)
  }, [filters])

  if (!open) return null

  return (
    <div className="panel">
      <div className="panel-grid">
        <label className="field">
          <span className="field-label">
            <span className="field-glyph field-glyph-blue" aria-hidden="true">
              <span className="field-glyph-core" />
            </span>
            主频率
          </span>
          <select
            value={draft.frequency}
            onChange={(event) => setDraft({ ...draft, frequency: event.target.value })}
          >
            <option value="all">全部</option>
            {Object.entries(FREQUENCY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">
            <span className="field-glyph field-glyph-cyan" aria-hidden="true">
              <span className="field-glyph-core" />
            </span>
            搜索
          </span>
          <input
            value={draft.search}
            onChange={(event) => setDraft({ ...draft, search: event.target.value })}
            placeholder="会议名称或参会人"
          />
        </label>
        <label className="field">
          <span className="field-label">
            <span className="field-glyph field-glyph-green" aria-hidden="true">
              <span className="field-glyph-core" />
            </span>
            参会人
          </span>
          <input
            value={draft.attendee}
            onChange={(event) => setDraft({ ...draft, attendee: event.target.value })}
            placeholder="按参会人筛选"
          />
        </label>
        <label className="field">
          <span className="field-label">
            <span className="field-glyph field-glyph-violet" aria-hidden="true">
              <span className="field-glyph-core" />
            </span>
            下次会议
          </span>
          <select
            value={draft.timeRange}
            onChange={(event) => setDraft({ ...draft, timeRange: event.target.value })}
          >
            <option value="all">全部</option>
            <option value="week">本周</option>
            <option value="month">本月</option>
            <option value="30days">30天内</option>
          </select>
        </label>
        <label className="field">
          <span className="field-label">
            <span className="field-glyph field-glyph-amber" aria-hidden="true">
              <span className="field-glyph-core" />
            </span>
            历史状态
          </span>
          <select
            value={draft.historyStatus}
            onChange={(event) => setDraft({ ...draft, historyStatus: event.target.value })}
          >
            <option value="all">全部</option>
            <option value="has">有记录</option>
            <option value="none">无记录</option>
          </select>
        </label>
        <div className="field field-span-2">
          <span className="field-label">
            <span className="field-glyph field-glyph-slate" aria-hidden="true">
              <span className="field-glyph-core" />
            </span>
            频率类型
          </span>
          <div className="checkbox-row">
            {Object.entries(FREQUENCY_LABELS).map(([value, label]) => (
              <label key={value} className="checkbox-chip">
                <input
                  type="checkbox"
                  checked={draft.frequencyTypes.includes(value)}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      frequencyTypes: event.target.checked
                        ? [...current.frequencyTypes, value]
                        : current.frequencyTypes.filter((item) => item !== value),
                    }))
                  }
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
      <div className="panel-actions">
        <button className="ghost-button" onClick={onReset}>
          重置
        </button>
        <button className="primary-button" onClick={() => onChange(draft)}>
          应用筛选
        </button>
      </div>
    </div>
  )
}
