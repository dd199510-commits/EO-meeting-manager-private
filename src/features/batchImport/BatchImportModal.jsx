import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { parseBatchImportText } from './batchImportUtils'

export function BatchImportModal({ open, meetings, onClose, onConfirm }) {
  const [rawText, setRawText] = useState('')
  const [manualMap, setManualMap] = useState({})

  function handleClose() {
    setRawText('')
    setManualMap({})
    onClose()
  }

  const parseResult = useMemo(() => {
    if (!rawText.trim()) return { rows: [], error: '' }
    try {
      return { rows: parseBatchImportText(rawText, meetings), error: '' }
    } catch (currentError) {
      return { rows: [], error: currentError.message }
    }
  }, [meetings, rawText])

  const parsedRows = parseResult.rows
  const error = parseResult.error

  if (!open) return null

  const rowsWithManualMatch = parsedRows.map((row) => {
    const manualMeetingId = manualMap[row.id]
    const manualMeeting = meetings.find((meeting) => meeting.id === manualMeetingId) ?? null

    if (manualMeeting) {
      return {
        ...row,
        matchedMeeting: manualMeeting,
        valid: true,
        manuallyMatched: true,
        isDuplicate: Boolean(manualMeeting.history?.includes(row.date)),
      }
    }

    return row
  })

  const matchedRows = rowsWithManualMatch.filter((row) => row.valid)
  const unmatchedRows = rowsWithManualMatch.filter((row) => !row.valid)

  return (
    <div className="modal-backdrop">
      <div className="modal-card modal-wide">
        <div className="modal-header">
          <h2>批量导入历史记录</h2>
          <button className="icon-button" onClick={handleClose}>
            <X size={18} />
          </button>
        </div>
        <label className="field">
          <span>粘贴制表符分隔数据</span>
          <div className="info-note">
            建议直接粘贴从表格复制的三列数据：会议主题、开始日期、开始时间。系统会先自动匹配，再让你手动补齐未识别项。
          </div>
          <textarea
            rows="10"
            value={rawText}
            onChange={(event) => setRawText(event.target.value)}
            placeholder={'主题\t开始日期\t开始时间\n【常规会议】示例会议\t2026/03/12\t09:00:00'}
          />
        </label>
        {error ? <p className="error-text">{error}</p> : null}
        {parsedRows.length > 0 ? (
          <div className="batch-grid">
            <div className="panel">
              <h3>可导入 ({matchedRows.length})</h3>
              <div className="log-list">
                {matchedRows.map((row) => (
                  <div key={row.id} className="log-item">
                    <div>
                      <strong>{row.originalName}</strong>
                      <p>
                        匹配到：{row.matchedMeeting.name} · {row.date}
                        {row.manuallyMatched ? ' · 手动改绑' : ''}
                      </p>
                      {row.isDuplicate ? <p className="warning-text">该日期已存在于历史记录中</p> : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="panel">
              <h3>未匹配 ({unmatchedRows.length})</h3>
              <div className="log-list">
                {unmatchedRows.map((row) => (
                  <div key={row.id} className="log-item">
                    <div>
                      <strong>{row.originalName}</strong>
                      <p>{row.date || '日期无效或未匹配到会议'}</p>
                    </div>
                    <div className="manual-map-box">
                      <select
                        value={manualMap[row.id] ?? ''}
                        onChange={(event) =>
                          setManualMap((current) => ({
                            ...current,
                            [row.id]: event.target.value,
                          }))
                        }
                      >
                        <option value="">手动指定会议</option>
                        {meetings
                          .filter((meeting) => meeting.status === 'active')
                          .map((meeting) => (
                            <option key={meeting.id} value={meeting.id}>
                              {meeting.name}
                            </option>
                          ))}
                      </select>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}
        <div className="panel-actions">
          <button className="ghost-button" onClick={handleClose}>
            取消
          </button>
          <button
            className="primary-button"
            onClick={() => {
              onConfirm(matchedRows)
              setRawText('')
              setManualMap({})
            }}
            disabled={matchedRows.length === 0}
          >
            导入 {matchedRows.length} 条
          </button>
        </div>
      </div>
    </div>
  )
}
