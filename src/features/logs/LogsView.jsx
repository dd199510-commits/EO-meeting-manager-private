import { Trash2 } from 'lucide-react'
import { formatTimestamp, getActionLabel } from './logUtils'

function formatChangeLine(change) {
  if (typeof change === 'string') return change

  if (change && typeof change === 'object') {
    const parts = []

    if (change.field) parts.push(`${change.field}`)
    if (change.old !== undefined || change.new !== undefined) {
      parts.push(`${change.old ?? '-'} → ${change.new ?? '-'}`)
    }
    if (change.detail) parts.push(`${change.detail}`)

    return parts.join(' · ') || JSON.stringify(change)
  }

  return String(change ?? '')
}

export function LogsView({ activeSection, logs, onClear, onDelete }) {
  const safeLogs = Array.isArray(logs) ? logs.filter(Boolean) : []

  const planningActionTypes = new Set(['review', 'review_import', 'review_delete', 'review_move'])
  const planningTargets = new Set(['审核区', '审核排程'])

  const meetingLogs = safeLogs.filter(
    (log) => !planningActionTypes.has(log.actionType) && !planningTargets.has(log.targetName),
  )
  const planningLogs = safeLogs.filter(
    (log) => planningActionTypes.has(log.actionType) || planningTargets.has(log.targetName),
  )
  const visibleLogs = activeSection === 'meetings' ? meetingLogs : planningLogs

  return (
    <section className="panel">
      <div className="section-title">
        <span className="section-glyph section-glyph-slate" aria-hidden="true">
          <span className="section-glyph-core" />
        </span>
        <h2>操作审计</h2>
      </div>
      <div className="logs-topbar">
        <span className="meetings-secondary-label">
          {activeSection === 'meetings' ? `${meetingLogs.length} 条会议记录` : `${planningLogs.length} 条排程记录`}
        </span>
        <button className="ghost-button danger-button" onClick={onClear} type="button">
          清空日志
        </button>
      </div>
      {visibleLogs.length === 0 ? (
        <div className="empty-state">暂无操作记录。</div>
      ) : (
        <div className="log-list">
          {visibleLogs.map((log) => (
            <div key={log.id} className="log-item">
              <div className="log-main">
                <span className={`log-badge log-badge-${log.actionType}`} aria-hidden="true">
                  <span className="log-badge-core" />
                </span>
                <div className="log-content">
                  <div className="log-line">
                    <strong>{log.targetName || '未命名对象'}</strong>
                    <span className="log-action-text">{getActionLabel(log.actionType)}</span>
                    <span className="log-detail">{log.detail || '无变更摘要'}</span>
                  </div>
                  {activeSection === 'meetings' && Array.isArray(log.changes) && log.changes.length ? (
                    <div className="log-changes">
                      {log.changes.map((change, index) => (
                        <div key={`${log.id}-${index}`} className="log-change-line">
                          {formatChangeLine(change)}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="log-meta">
                <span>{formatTimestamp(log.timestamp)}</span>
                <button className="icon-button danger log-delete-button" onClick={() => onDelete(log.id)} type="button">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
