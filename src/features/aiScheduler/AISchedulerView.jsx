import { useMemo, useState } from 'react'
import { Copy, Download, Sparkles, Upload } from 'lucide-react'
import { FREQUENCY_COLORS, FREQUENCY_LABELS } from '../../data/meetingData'
import {
  buildAIPrompt,
  detectAIScheduleConflicts,
  optimizeInputForAI,
  validateImportedInput,
  validateImportedSchedule,
} from './aiSchedulerUtils'

function copyText(text) {
  return navigator.clipboard.writeText(text)
}

function formatSourceFrequency(sourceFrequency) {
  if (!sourceFrequency) return '未携带原频率配置'

  if (sourceFrequency.type === 'weekly') {
    return `每 ${sourceFrequency.interval} 周 / 周${['日', '一', '二', '三', '四', '五', '六'][sourceFrequency.daySpec]}`
  }

  if (sourceFrequency.type === 'monthly') {
    return `每 ${sourceFrequency.interval} 月 / ${sourceFrequency.daySpec} 号`
  }

  if (sourceFrequency.type === 'yearly') {
    const months = Array.isArray(sourceFrequency.monthSpec)
      ? sourceFrequency.monthSpec.join(',')
      : sourceFrequency.monthSpec
    return `每 ${sourceFrequency.interval} 年 / ${months} 月 / ${sourceFrequency.daySpec} 号`
  }

  return '不定期'
}

export function AISchedulerView({ aiState, setAiState, onImportToReview }) {
  const [inputText, setInputText] = useState('')
  const [scheduleText, setScheduleText] = useState('')
  const [ruleInput, setRuleInput] = useState('')
  const [slotInput, setSlotInput] = useState({ start: '', end: '', reason: '' })
  const [inputError, setInputError] = useState('')
  const [scheduleError, setScheduleError] = useState('')
  const [showInputPreview, setShowInputPreview] = useState(false)

  const optimizedInput = useMemo(() => {
    if (!aiState.inputMeetings) return null
    return optimizeInputForAI(aiState.inputMeetings)
  }, [aiState.inputMeetings])

  const prompt = useMemo(() => {
    if (!aiState.inputMeetings) return ''
    return buildAIPrompt(aiState.inputMeetings, aiState.preferences)
  }, [aiState.inputMeetings, aiState.preferences])
  const scheduleConflicts = useMemo(
    () =>
      aiState.scheduledMeetings?.scheduledMeetings
        ? detectAIScheduleConflicts(aiState.scheduledMeetings.scheduledMeetings)
        : [],
    [aiState.scheduledMeetings],
  )

  function updatePreferences(nextPreferences) {
    setAiState((current) => ({ ...current, preferences: nextPreferences }))
  }

  function handleImportInput() {
    try {
      const parsed = validateImportedInput(inputText)
      setAiState((current) => ({ ...current, inputMeetings: parsed }))
      setInputText('')
      setInputError('')
    } catch (error) {
      setInputError(error.message)
    }
  }

  function handleImportSchedule() {
    try {
      const parsed = validateImportedSchedule(scheduleText)
      setAiState((current) => ({ ...current, scheduledMeetings: parsed }))
      setScheduleText('')
      setScheduleError('')
    } catch (error) {
      setScheduleError(error.message)
    }
  }

  return (
    <div className="schedule-layout">
      <section className="panel">
        <div className="section-title">
          <Upload size={18} />
          <h2>导入会议方案</h2>
        </div>
        <label className="field">
          <span>从“会议安排”粘贴导出的 JSON</span>
          <textarea
            rows="8"
            value={inputText}
            onChange={(event) => setInputText(event.target.value)}
            placeholder='{"timeRange": {...}, "meetings": [...]}'
          />
        </label>
        {inputError ? <p className="error-text">{inputError}</p> : null}
        <div className="panel-actions">
          <button className="primary-button" onClick={handleImportInput}>
            导入会议方案
          </button>
          {aiState.inputMeetings ? (
            <button className="ghost-button" onClick={() => setShowInputPreview((current) => !current)}>
              {showInputPreview ? '收起预览' : '预览输入'}
            </button>
          ) : null}
        </div>
        {aiState.inputMeetings ? (
          <div className="info-note">
            已导入 {aiState.inputMeetings.meetings.length} 个会议实例，时间范围为{' '}
            {aiState.inputMeetings.timeRange.start} 至 {aiState.inputMeetings.timeRange.end}
          </div>
        ) : null}
        {showInputPreview && optimizedInput ? (
          <pre className="code-block">{JSON.stringify(optimizedInput, null, 2)}</pre>
        ) : null}
      </section>

      <section className="panel">
        <div className="section-title">
          <Sparkles size={18} />
          <h2>排程偏好</h2>
        </div>
        <div className="panel-grid">
          <div className="field field-span-2">
            <span>排程规则</span>
            <div className="stack-list">
              {aiState.preferences.rules.map((rule, index) => (
                <div key={`${rule}-${index}`} className="simple-row">
                  <span>{rule}</span>
                  <button
                    className="icon-button danger"
                    onClick={() =>
                      updatePreferences({
                        ...aiState.preferences,
                        rules: aiState.preferences.rules.filter((_, ruleIndex) => ruleIndex !== index),
                      })
                    }
                  >
                    删除
                  </button>
                </div>
              ))}
            </div>
            <div className="simple-form">
              <input value={ruleInput} onChange={(event) => setRuleInput(event.target.value)} />
              <button
                className="ghost-button"
                onClick={() => {
                  if (!ruleInput.trim()) return
                  updatePreferences({
                    ...aiState.preferences,
                    rules: [...aiState.preferences.rules, ruleInput.trim()],
                  })
                  setRuleInput('')
                }}
              >
                添加规则
              </button>
            </div>
          </div>

          <div className="field field-span-2">
            <span>避免时段</span>
            <div className="stack-list">
              {aiState.preferences.avoidTimeSlots.map((slot, index) => (
                <div key={`${slot.start}-${slot.end}-${index}`} className="simple-row">
                  <span>
                    {slot.start} - {slot.end} {slot.reason ? `(${slot.reason})` : ''}
                  </span>
                  <button
                    className="icon-button danger"
                    onClick={() =>
                      updatePreferences({
                        ...aiState.preferences,
                        avoidTimeSlots: aiState.preferences.avoidTimeSlots.filter(
                          (_, slotIndex) => slotIndex !== index,
                        ),
                      })
                    }
                  >
                    删除
                  </button>
                </div>
              ))}
            </div>
            <div className="simple-form">
              <input
                type="time"
                value={slotInput.start}
                onChange={(event) => setSlotInput({ ...slotInput, start: event.target.value })}
              />
              <input
                type="time"
                value={slotInput.end}
                onChange={(event) => setSlotInput({ ...slotInput, end: event.target.value })}
              />
              <input
                placeholder="原因"
                value={slotInput.reason}
                onChange={(event) => setSlotInput({ ...slotInput, reason: event.target.value })}
              />
              <button
                className="ghost-button"
                onClick={() => {
                  if (!slotInput.start || !slotInput.end) return
                  updatePreferences({
                    ...aiState.preferences,
                    avoidTimeSlots: [...aiState.preferences.avoidTimeSlots, slotInput],
                  })
                  setSlotInput({ start: '', end: '', reason: '' })
                }}
              >
                添加时段
              </button>
            </div>
          </div>
        </div>
      </section>

      {optimizedInput ? (
        <section className="panel">
          <div className="section-title">
            <Copy size={18} />
            <h2>复制 AI 输入</h2>
          </div>
          <div className="panel-actions">
            <button className="ghost-button" onClick={() => copyText(JSON.stringify(optimizedInput, null, 2))}>
              复制优化后的 JSON
            </button>
            <button className="primary-button" onClick={() => copyText(prompt)}>
              复制完整 Prompt
            </button>
          </div>
          <pre className="code-block">{JSON.stringify(optimizedInput, null, 2)}</pre>
        </section>
      ) : null}

      <section className="panel">
        <div className="section-title">
          <Download size={18} />
          <h2>导入 AI 结果</h2>
        </div>
        <label className="field">
          <span>粘贴 AI 返回的排程 JSON</span>
          <textarea
            rows="8"
            value={scheduleText}
            onChange={(event) => setScheduleText(event.target.value)}
            placeholder='{"scheduledMeetings": [...]}'
          />
        </label>
        {scheduleError ? <p className="error-text">{scheduleError}</p> : null}
        <div className="panel-actions">
          <button className="primary-button" onClick={handleImportSchedule}>
            导入排程结果
          </button>
        </div>
      </section>

      {aiState.scheduledMeetings ? (
        <section className="panel">
          <div className="section-title">
            <Sparkles size={18} />
            <h2>AI 排程结果</h2>
          </div>
          <div className="panel-actions">
            <button className="primary-button" onClick={onImportToReview}>
              导入到审核区
            </button>
          </div>
          <div className="summary-row">
            <div className="summary-card">
              <span>排程数</span>
              <strong>{aiState.scheduledMeetings.scheduledMeetings.length}</strong>
            </div>
            <div className="summary-card">
              <span>冲突数</span>
              <strong>{scheduleConflicts.length}</strong>
            </div>
          </div>
          {scheduleConflicts.length > 0 ? (
            <div className="stack-list">
              {scheduleConflicts.map((conflict) => (
                <div key={conflict.id} className="conflict-note">
                  <strong>{conflict.date}</strong>
                  <p>{conflict.description}</p>
                </div>
              ))}
            </div>
          ) : null}
          <div className="schedule-list">
            {aiState.scheduledMeetings.scheduledMeetings.map((item) => (
              <div key={item.id} className="schedule-item">
                <div>
                  <strong>{item.name}</strong>
                  <p>
                    {item.date} · {item.startTime} - {item.endTime}
                  </p>
                  {item.sourceFrequency ? <p>{formatSourceFrequency(item.sourceFrequency)}</p> : null}
                  {item.aiReason ? <p>{item.aiReason}</p> : null}
                </div>
                <span className={FREQUENCY_COLORS[item.frequency]}>
                  {FREQUENCY_LABELS[item.frequency]}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}
