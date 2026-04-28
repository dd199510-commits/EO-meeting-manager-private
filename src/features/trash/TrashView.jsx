import { RotateCcw, Trash2 } from 'lucide-react'

export function TrashView({ deletedMeetings, onRestore, onDeleteForever }) {
  return (
    <section className="trash-section">
      <div className="section-title trash-section-title">
        <span className="section-glyph section-glyph-amber" aria-hidden="true">
          <span className="section-glyph-core" />
        </span>
        <Trash2 size={18} />
        <h2>回收站</h2>
      </div>
      {deletedMeetings.length === 0 ? (
        <div className="empty-state trash-empty-state">
          <span className="trash-empty-icon" aria-hidden="true">
            <Trash2 size={18} />
          </span>
          回收站为空。
        </div>
      ) : (
        <div className="trash-grid">
          {deletedMeetings.map((meeting) => (
            <article key={meeting.id} className="trash-card">
              <div className="trash-card-head">
                <div className="trash-card-title">
                  <strong>{meeting.name}</strong>
                  <span className="trash-card-status">已删除</span>
                </div>
              </div>
              <div className="trash-card-body">
                <div className="trash-card-meta">
                  {meeting.attendees ? <p><span>参会人</span>{meeting.attendees}</p> : null}
                  <p><span>备注</span>{meeting.notes || '无备注'}</p>
                </div>
              </div>
              <div className="trash-card-actions">
                <button className="ghost-button" onClick={() => onRestore(meeting.id)}>
                  <RotateCcw size={16} />
                  恢复
                </button>
                <button className="ghost-button danger" onClick={() => onDeleteForever(meeting.id)}>
                  <Trash2 size={16} />
                  彻底删除
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
