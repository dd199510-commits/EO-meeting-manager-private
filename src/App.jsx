import { useEffect, useMemo, useState } from 'react'
import './App.css'
import { AppSidebar } from './components/AppSidebar'
import {
  AI_STORAGE_KEY,
  createEmptyMeeting,
  LOG_STORAGE_KEY,
  normalizeMeeting,
  REVIEW_STORAGE_KEY,
} from './data/meetingData'
import { BatchImportModal } from './features/batchImport/BatchImportModal'
import { LogsView } from './features/logs/LogsView'
import { createLog, persistLogs, readLogs } from './features/logs/logUtils'
import { MeetingsView } from './features/meetings/MeetingsView'
import { EditModal } from './features/meetings/EditModal'
import { PlanningWorkbench } from './features/planner/PlanningWorkbench'
import { ReviewBoard } from './features/review/ReviewBoard'
import { ReserveNoticeBoard } from './features/reserveNotice/ReserveNoticeBoard'
import { normalizeNoticeTemplates } from './features/reserveNotice/notificationTemplates'
import {
  DEFAULT_REVIEW_STATE,
  normalizeReviewState,
  importAiScheduleToReview,
  persistReviewState,
  readReviewState,
} from './features/review/reviewUtils'
import { TrashView } from './features/trash/TrashView'
import { detectConflicts } from './lib/conflicts'
import { calculateNextOccurrence, syncMeetingAnchorDate } from './lib/meetingFrequency'
import { persistStorage, readStorage } from './lib/storage'
import {
  DEFAULT_AI_STATE,
  normalizeAiState,
  persistAiState,
  readAiState,
} from './features/aiScheduler/aiSchedulerUtils'

function App() {
  const PAGE_META = {
    meetings: {
      title: '会议库',
      description: '会议资料、回收站与排程准备',
    },
    planner: {
      title: '排程',
      description: '生成、审核、检查与通知',
    },
    logs: {
      title: '记录',
      description: '会议与排程操作记录',
    },
  }
  const MEETING_TAB_META = {
    active: '会议列表',
    trash: '回收站',
  }
  const PLANNING_TAB_META = {
    planner: '生成清单',
    review: '排程调整',
    'reserve-notice': '预留通知',
  }
  const LOG_TAB_META = {
    meetings: '会议记录',
    planning: '排程记录',
  }

  const defaultFilters = {
    search: '',
    frequency: 'all',
    frequencyTypes: [],
    attendee: '',
    timeRange: 'all',
    historyStatus: 'all',
  }

  const initialData = useMemo(() => readStorage(), [])
  const [activeTab, setActiveTab] = useState('meetings')
  const [meetings, setMeetings] = useState(initialData.meetings)
  const [scheduledMeetings, setScheduledMeetings] = useState(initialData.scheduled)
  const [noticeTemplates, setNoticeTemplates] = useState(
    normalizeNoticeTemplates(initialData.noticeTemplates),
  )
  const [disabledNoticeTemplateKeys, setDisabledNoticeTemplateKeys] = useState(
    initialData.disabledNoticeTemplateKeys ?? [],
  )
  const [aiState, setAiState] = useState(() => readAiState(AI_STORAGE_KEY) ?? DEFAULT_AI_STATE)
  const [reviewState, setReviewState] = useState(
    () => readReviewState(REVIEW_STORAGE_KEY) ?? DEFAULT_REVIEW_STATE,
  )
  const [logs, setLogs] = useState(() => readLogs(LOG_STORAGE_KEY))
  const [filters, setFilters] = useState(defaultFilters)
  const [showFilters, setShowFilters] = useState(false)
  const [planningTab, setPlanningTab] = useState('planner')
  const [meetingTab, setMeetingTab] = useState('active')
  const [logsTab, setLogsTab] = useState('meetings')
  const [editingMeeting, setEditingMeeting] = useState(null)
  const [isEditModalClosing, setIsEditModalClosing] = useState(false)
  const [showBatchImport, setShowBatchImport] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true)

  useEffect(() => {
    persistStorage({
      meetings,
      scheduled: scheduledMeetings,
      noticeTemplates,
      disabledNoticeTemplateKeys,
    })
  }, [meetings, scheduledMeetings, noticeTemplates, disabledNoticeTemplateKeys])

  useEffect(() => {
    persistAiState(AI_STORAGE_KEY, aiState)
  }, [aiState])

  useEffect(() => {
    persistReviewState(REVIEW_STORAGE_KEY, reviewState)
  }, [reviewState])

  useEffect(() => {
    persistLogs(LOG_STORAGE_KEY, logs)
  }, [logs])

  useEffect(() => {
    if (planningTab === 'final-check') {
      setPlanningTab('review')
    }
  }, [planningTab])

  const activeMeetings = useMemo(
    () =>
      meetings
        .filter((meeting) => meeting.status === 'active')
        .map((meeting) => {
          const syncedMeeting = syncMeetingAnchorDate(normalizeMeeting(meeting))
          return {
            ...syncedMeeting,
            nextDate: calculateNextOccurrence(syncedMeeting) || '',
          }
        }),
    [meetings],
  )

  const reviewConflicts = useMemo(
    () => detectConflicts(reviewState.scheduledMeetings),
    [reviewState.scheduledMeetings],
  )
  const deletedMeetings = useMemo(
    () => meetings.filter((meeting) => meeting.status === 'deleted'),
    [meetings],
  )
  const pageTabs = useMemo(() => {
    if (activeTab === 'meetings') {
      return Object.entries(MEETING_TAB_META).map(([id, label]) => ({
        id,
        label: id === 'trash' && deletedMeetings.length > 0 ? `${label} (${deletedMeetings.length})` : label,
      }))
    }

    if (activeTab === 'planner') {
      return Object.entries(PLANNING_TAB_META).map(([id, label]) => ({ id, label }))
    }

    if (activeTab === 'logs') {
      return Object.entries(LOG_TAB_META).map(([id, label]) => ({ id, label }))
    }

    return []
  }, [activeTab, deletedMeetings.length])

  const activePageTab =
    activeTab === 'meetings' ? meetingTab : activeTab === 'planner' ? planningTab : logsTab

  useEffect(() => {
    const scrollToTop = () => {
      document.documentElement.scrollTop = 0
      document.body.scrollTop = 0
      window.scrollTo({ top: 0, left: 0 })
    }
    scrollToTop()
    const frameId = window.requestAnimationFrame(scrollToTop)
    const timeoutId = window.setTimeout(scrollToTop, 0)

    return () => {
      window.cancelAnimationFrame(frameId)
      window.clearTimeout(timeoutId)
    }
  }, [activeTab, activePageTab])

  function buildImportedQueueJobPayload(reviewPlan) {
    const scheduledList = Array.isArray(reviewPlan?.scheduledMeetings) ? reviewPlan.scheduledMeetings : []
    const unscheduledDetails = Array.isArray(reviewPlan?.aiSummary?.unscheduledMeetingDetails)
      ? reviewPlan.aiSummary.unscheduledMeetingDetails
      : []
    const exportTaskMap = [
      ...scheduledList
        .filter((meeting) => meeting.taskId)
        .map((meeting) => ({
          taskId: meeting.taskId,
          instanceId: meeting.id ?? '',
          meetingId: meeting.meetingId ?? '',
          date: meeting.date ?? '',
        })),
      ...unscheduledDetails
        .filter((meeting) => meeting?.taskId)
        .map((meeting) => ({
          taskId: meeting.taskId,
          instanceId: meeting.instanceId ?? '',
          meetingId: meeting.meetingId ?? '',
          date: meeting.date ?? '',
        })),
    ]

    const dedupedTaskMap = exportTaskMap.filter(
      (item, index, items) => item.taskId && items.findIndex((candidate) => candidate.taskId === item.taskId) === index,
    )

    const importedResult = {
      scheduledMeetings: scheduledList
        .filter((meeting) => meeting.taskId)
        .map((meeting) => ({
          taskId: meeting.taskId,
          date: meeting.date ?? '',
          startTime: meeting.startTime ?? '',
          endTime: meeting.endTime ?? '',
          duration: Number(meeting.duration ?? 0),
          frequency: meeting.frequency ?? 'adhoc',
          ...(meeting.notes ? { notes: meeting.notes } : {}),
          aiReason: meeting.aiReason ?? '导入排程方案',
        })),
      unscheduledMeetings: unscheduledDetails
        .filter((meeting) => meeting?.taskId)
        .map((meeting) => ({
          taskId: meeting.taskId,
          reason: meeting.reason ?? '无',
          ...(meeting.type ? { type: meeting.type } : {}),
        })),
      summary: {
        unscheduledMeetings: reviewPlan?.aiSummary?.unscheduledMeetings ?? unscheduledDetails.length,
      },
    }

    if (!reviewPlan?.sourceInputMeetings?.timeRange || dedupedTaskMap.length === 0) {
      return null
    }

    return {
      provider: 'imported',
      model: '导入方案',
      inputMeetings: reviewPlan.sourceInputMeetings,
      exportBatch: {
        batchId: `imported-${reviewPlan.importedAt ?? Date.now()}`,
        taskMap: dedupedTaskMap,
      },
      result: importedResult,
    }
  }

  function appendLog(actionType, targetName, detail) {
    setLogs((current) => [createLog(actionType, targetName, detail), ...current])
  }

  function openEditMeeting(meeting) {
    setIsEditModalClosing(false)
    setEditingMeeting(meeting)
  }

  function closeEditMeeting() {
    setIsEditModalClosing(true)
    window.setTimeout(() => {
      setEditingMeeting(null)
      setIsEditModalClosing(false)
    }, 220)
  }

  function updateReviewMeetings(updater) {
    setReviewState((current) => ({
      ...current,
      scheduledMeetings:
        typeof updater === 'function' ? updater(current.scheduledMeetings) : updater,
    }))
  }

  function toggleFinalCheckLinkage(currentState, meetingId) {
    const nextChecked = !currentState.finalCheckStatus?.[meetingId]

    return {
      ...currentState,
      finalCheckStatus: {
        ...(currentState.finalCheckStatus ?? {}),
        [meetingId]: nextChecked,
      },
      scheduledMeetings: currentState.scheduledMeetings.map((meeting) =>
        meeting.meetingId === meetingId ? { ...meeting, locked: nextChecked } : meeting,
      ),
    }
  }

  function toggleReserveNoticeLinkage(currentState, noticeId) {
    const nextSent = !currentState.reserveNoticeStatus?.[noticeId]
    const [scope, scopedId] = String(noticeId).split(':')

    return {
      ...currentState,
      reserveNoticeStatus: {
        ...(currentState.reserveNoticeStatus ?? {}),
        [noticeId]: nextSent,
      },
      scheduledMeetings: currentState.scheduledMeetings.map((meeting) => {
        if (scope === 'meeting' && meeting.meetingId === scopedId) {
          return { ...meeting, reserved: nextSent }
        }

        if (scope === 'adhoc' && meeting.id === scopedId) {
          return { ...meeting, reserved: nextSent }
        }

        return meeting
      }),
    }
  }

  function handleSaveMeeting(nextMeeting) {
    const isNew = !nextMeeting.id
    const syncedMeeting = syncMeetingAnchorDate({
      ...nextMeeting,
      noteMentions: Array.isArray(nextMeeting.noteMentions) ? nextMeeting.noteMentions : [],
    })
    const persistedMeeting = {
      ...syncedMeeting,
      nextDate: calculateNextOccurrence(syncedMeeting) || syncedMeeting.nextDate || '',
    }

    setMeetings((current) => {
      if (!persistedMeeting.id) {
        const maxOrder = Math.max(-1, ...current.map((meeting) => meeting.customOrder ?? 0))
        return [
          ...current,
          {
            ...persistedMeeting,
            id: `m${crypto.randomUUID()}`,
            customOrder: maxOrder + 1,
          },
        ]
      }

      return current.map((meeting) => (meeting.id === persistedMeeting.id ? persistedMeeting : meeting))
    })
    appendLog(
      isNew ? 'create' : 'update',
      persistedMeeting.name || '未命名会议',
      isNew ? '新建会议' : '编辑会议',
    )
    closeEditMeeting()
  }

  function handleDeleteMeeting(id) {
    const target = meetings.find((meeting) => meeting.id === id)
    setMeetings((current) =>
      current.map((meeting) => (meeting.id === id ? { ...meeting, status: 'deleted' } : meeting)),
    )
    if (target) {
      appendLog('delete', target.name, '移入回收站')
    }
  }

  function handleExport() {
    const exportPayload = {
      version: '2.0',
      exportedAt: new Date().toISOString(),
      meetings,
      scheduled: scheduledMeetings,
      noticeTemplates,
      disabledNoticeTemplateKeys,
      logs,
      aiState,
      reviewState,
    }

    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'meeting-manager-export.json'
    link.click()
    URL.revokeObjectURL(url)
  }

  function handleImportData() {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'

    input.onchange = async (event) => {
      const file = event.target.files?.[0]
      if (!file) return

      try {
        const text = await file.text()
        const parsed = JSON.parse(text)

        const importedMeetings = Array.isArray(parsed)
          ? parsed
          : Array.isArray(parsed.meetings)
            ? parsed.meetings
            : null

        if (!importedMeetings) {
          window.alert('导入失败：文件中未找到 meetings 数据。')
          return
        }

        const normalizedMeetings = importedMeetings.map(normalizeMeeting)

        const overwriteConfirmed = window.confirm(
          `检测到 ${normalizedMeetings.length} 条会议记录。\n\n恢复系统备份会使用备份内容覆盖当前系统数据。\n点击“确定”继续恢复，点击“取消”放弃导入。`,
        )

        if (!overwriteConfirmed) return

        setMeetings(normalizedMeetings)
        setScheduledMeetings(Array.isArray(parsed.scheduled) ? parsed.scheduled : [])
        setNoticeTemplates(normalizeNoticeTemplates(parsed.noticeTemplates))
        setDisabledNoticeTemplateKeys(
          Array.isArray(parsed.disabledNoticeTemplateKeys) ? parsed.disabledNoticeTemplateKeys : [],
        )
        setLogs(Array.isArray(parsed.logs) ? parsed.logs : [])
        setAiState(parsed.aiState ? normalizeAiState(parsed.aiState) : DEFAULT_AI_STATE)
        setReviewState(parsed.reviewState ? normalizeReviewState(parsed.reviewState) : DEFAULT_REVIEW_STATE)
        appendLog('import', '系统备份', `恢复系统备份，覆盖 ${normalizedMeetings.length} 条会议`)
        window.alert('系统备份恢复完成。')
      } catch (error) {
        window.alert(`导入失败：${error.message}`)
      }
    }

    input.click()
  }

  function handleExportReviewPlan() {
    const exportPayload = {
      version: '2.0',
      exportedAt: new Date().toISOString(),
      reviewState,
    }

    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'review-schedule-plan.json'
    link.click()
    URL.revokeObjectURL(url)
  }

  function handleImportReviewPlan() {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'

    input.onchange = async (event) => {
      const file = event.target.files?.[0]
      if (!file) return

      try {
        const text = await file.text()
        const parsed = JSON.parse(text)
        const importedReview = parsed.reviewState ?? parsed
        const normalized = normalizeReviewState(importedReview)

        if (!normalized?.scheduledMeetings || !Array.isArray(normalized.scheduledMeetings)) {
          window.alert('导入失败：文件中未找到有效的审核排程数据。')
          return
        }

        setReviewState(normalized)
        if (typeof window !== 'undefined' && typeof window.aiScheduler?.registerImportedJob === 'function') {
          const importedJobPayload = buildImportedQueueJobPayload(normalized)
          if (importedJobPayload) {
            try {
              await window.aiScheduler.registerImportedJob(importedJobPayload)
            } catch (queueError) {
              console.error('register imported review plan failed', queueError)
            }
          }
        }
        appendLog('review_import', '审核排程', `导入 ${normalized.scheduledMeetings.length} 条排程方案`)
        window.alert('审核排程方案导入完成。')
      } catch (error) {
        window.alert(`导入失败：${error.message}`)
      }
    }

    input.click()
  }

  function importAiStateToReview(nextAiState, options = {}) {
    const nextReview = importAiScheduleToReview(nextAiState)
    setReviewState(nextReview)
    appendLog(
      'review_import',
      '审核排程',
      `导入 ${nextReview.scheduledMeetings.length} 条 AI 排程结果`,
    )

    if (options.openReview !== false) {
      setPlanningTab('review')
    }
  }

  return (
    <main className={sidebarCollapsed ? 'app-shell app-frame app-frame-sidebar-collapsed' : 'app-shell app-frame'}>
      <AppSidebar
        activeTab={activeTab}
        collapsed={sidebarCollapsed}
        onTabChange={setActiveTab}
        onToggleCollapse={() => setSidebarCollapsed((current) => !current)}
        onImportData={handleImportData}
        onExport={handleExport}
      />
      <div className="app-main">
        <header className="app-page-header">
          <div className="app-page-header-main">
            <span className="app-page-kicker">会议管理系统</span>
            <div className="app-page-copy">
              <div className="app-page-title-row">
                <h1>{PAGE_META[activeTab].title}</h1>
                {pageTabs.length > 0 ? (
                  <div
                    className="app-page-tabs"
                    role="tablist"
                    aria-label={`${PAGE_META[activeTab].title}模块导航`}
                  >
                    {pageTabs.map(({ id, label }) => (
                      <button
                        key={id}
                        className={activePageTab === id ? 'tab-button tab-active' : 'tab-button'}
                        onClick={() => {
                          if (activeTab === 'meetings') setMeetingTab(id)
                          if (activeTab === 'planner') setPlanningTab(id)
                          if (activeTab === 'logs') setLogsTab(id)
                        }}
                        type="button"
                        role="tab"
                        aria-selected={activePageTab === id}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <p>{PAGE_META[activeTab].description}</p>
            </div>
          </div>
          <div className="app-page-status" aria-label="系统状态">
            <span>
              会议库
              <strong>{activeMeetings.length}</strong>
            </span>
            <span className={reviewConflicts.length > 0 ? 'app-page-status-warning' : ''}>
              冲突
              <strong>{reviewConflicts.length}</strong>
            </span>
            <span>
              Version
              <strong>2.0</strong>
            </span>
          </div>
        </header>

        <div className="app-page-content">
          {activeTab === 'meetings' ? (
            <MeetingsView
              contentTab={meetingTab}
              meetings={activeMeetings}
              deletedMeetings={deletedMeetings}
              filters={filters}
              setFilters={setFilters}
              defaultFilters={defaultFilters}
              showFilters={showFilters}
              setShowFilters={setShowFilters}
              onEditMeeting={openEditMeeting}
              onCreateMeeting={() => openEditMeeting(createEmptyMeeting())}
              onDeleteMeeting={handleDeleteMeeting}
              onSaveMeeting={handleSaveMeeting}
              onRestoreMeeting={(id) => {
                const target = meetings.find((meeting) => meeting.id === id)
                setMeetings((current) =>
                  current.map((meeting) =>
                    meeting.id === id ? { ...meeting, status: 'active' } : meeting,
                  ),
                )
                if (target) appendLog('restore', target.name, '从回收站恢复')
              }}
              onDeleteMeetingForever={(id) => {
                const target = meetings.find((meeting) => meeting.id === id)
                setMeetings((current) => current.filter((meeting) => meeting.id !== id))
                if (target) appendLog('hard_delete', target.name, '从回收站彻底删除')
              }}
              onBatchImport={() => setShowBatchImport(true)}
              onGoToPlanner={() => {
                setActiveTab('planner')
                setPlanningTab('planner')
              }}
              onReorderMeetings={(orderedIds) => {
                setMeetings((current) =>
                  current.map((meeting) => ({
                    ...meeting,
                    customOrder:
                      orderedIds.indexOf(meeting.id) >= 0
                        ? orderedIds.indexOf(meeting.id)
                        : meeting.customOrder ?? 0,
                  })),
                )
                appendLog('reorder', '会议列表', '调整自定义排序')
              }}
            />
          ) : activeTab === 'planner' ? (
            planningTab === 'planner' ? (
              <PlanningWorkbench
                meetings={meetings}
                aiState={aiState}
                setAiState={setAiState}
                onOpenReview={() => setPlanningTab('review')}
                onImportToReview={() => importAiStateToReview(aiState)}
                onApplyAiSchedule={(nextAiState, options) => {
                  setAiState(nextAiState)
                  appendLog(
                    'ai_schedule',
                    'AI 排程',
                    `接收 ${nextAiState.scheduledMeetings?.scheduledMeetings?.length ?? 0} 条后台结果`,
                  )
                  if (options?.importToReview) {
                    importAiStateToReview(nextAiState, { openReview: true })
                  }
                }}
              />
            ) : planningTab === 'reserve-notice' ? (
            <ReserveNoticeBoard
              meetings={meetings}
              scheduledMeetings={reviewState.scheduledMeetings}
              noticeTemplates={noticeTemplates}
              disabledNoticeTemplateKeys={disabledNoticeTemplateKeys}
              reserveNoticeStatus={reviewState.reserveNoticeStatus}
              onUpdateMeeting={(meetingId, patch) => {
                setMeetings((current) =>
                  current.map((meeting) =>
                    meeting.id === meetingId
                      ? {
                          ...meeting,
                          ...patch,
                          notificationConfig: patch.notificationConfig ?? meeting.notificationConfig ?? {},
                        }
                      : meeting,
                  ),
                )
                const target = meetings.find((meeting) => meeting.id === meetingId)
                if (target) {
                  appendLog('update', target.name, '更新通知设置')
                }
              }}
              onSaveTemplates={({ templates, disabledBuiltInKeys }) => {
                setNoticeTemplates(templates)
                setDisabledNoticeTemplateKeys(disabledBuiltInKeys)
                appendLog(
                  'update',
                  '通知模板库',
                  `保存 ${templates.length} 个自定义通知模板，隐藏 ${disabledBuiltInKeys.length} 个内置模板`,
                )
              }}
              onToggleSent={(scheduledMeetingId) => {
                const [scope, scopedId] = String(scheduledMeetingId).split(':')
                const target =
                  scope === 'meeting'
                    ? meetings.find((meeting) => meeting.id === scopedId)
                    : reviewState.scheduledMeetings.find((meeting) => meeting.id === scopedId)
                const nextSent = !reviewState.reserveNoticeStatus?.[scheduledMeetingId]

                setReviewState((current) => toggleReserveNoticeLinkage(current, scheduledMeetingId))

                if (target) {
                  appendLog(
                    'review',
                    target.name,
                    nextSent ? '预留通知已发送，审核排程自动标记预留' : '取消预留通知已发送，审核排程自动取消预留',
                  )
                }
              }}
            />
            ) : (
              <ReviewBoard
                meetings={meetings}
                scheduledMeetings={reviewState.scheduledMeetings}
                reviewState={reviewState}
                conflicts={reviewConflicts}
                aiConflicts={reviewState.aiConflicts}
                aiSummary={reviewState.aiSummary}
                onGoToPlannerStep={() => setPlanningTab('planner')}
                onToggleLocked={(id) => {
                  const target = reviewState.scheduledMeetings.find((meeting) => meeting.id === id)
                  updateReviewMeetings((meetingsList) =>
                    meetingsList.map((meeting) =>
                      meeting.id === id ? { ...meeting, locked: !meeting.locked } : meeting,
                    ),
                  )
                  if (target) appendLog('review', target.name, '切换锁定状态')
                }}
                onToggleReserved={(id) => {
                  const target = reviewState.scheduledMeetings.find((meeting) => meeting.id === id)
                  updateReviewMeetings((meetingsList) =>
                    meetingsList.map((meeting) =>
                      meeting.id === id ? { ...meeting, reserved: !meeting.reserved } : meeting,
                    ),
                  )
                  if (target) appendLog('review', target.name, '切换预留状态')
                }}
                onDeleteMeeting={(id) => {
                  const target = reviewState.scheduledMeetings.find((meeting) => meeting.id === id)
                  updateReviewMeetings((meetingsList) => meetingsList.filter((meeting) => meeting.id !== id))
                  if (target) appendLog('review_delete', target.name, '从审核区删除')
                }}
                onMoveMeeting={(id, date, startTime, endTime) => {
                  const target = reviewState.scheduledMeetings.find((meeting) => meeting.id === id)
                  updateReviewMeetings((meetingsList) =>
                    meetingsList.map((meeting) =>
                      meeting.id === id ? { ...meeting, date, startTime, endTime } : meeting,
                    ),
                  )
                  if (target) {
                    appendLog('review_move', target.name, `调整到 ${date} ${startTime}-${endTime}`)
                  }
                }}
                onLockAll={() => {
                  updateReviewMeetings((meetingsList) => meetingsList.map((meeting) => ({ ...meeting, locked: true })))
                  appendLog('review', '审核区', '全部锁定')
                }}
                onUnlockAll={() => {
                  updateReviewMeetings((meetingsList) => meetingsList.map((meeting) => ({ ...meeting, locked: false })))
                  appendLog('review', '审核区', '全部解锁')
                }}
                onReserveAll={() => {
                  updateReviewMeetings((meetingsList) => meetingsList.map((meeting) => ({ ...meeting, reserved: true })))
                  appendLog('review', '审核区', '全部预留')
                }}
                onUnreserveAll={() => {
                  updateReviewMeetings((meetingsList) => meetingsList.map((meeting) => ({ ...meeting, reserved: false })))
                  appendLog('review', '审核区', '取消全部预留')
                }}
                onAddMeeting={(meeting) => {
                  updateReviewMeetings((meetingsList) => [...meetingsList, meeting])
                  const actionLabel =
                    meeting.addSource === 'linked'
                      ? '从会议列表补进'
                      : meeting.addSource === 'review-checklist' || meeting.addSource === 'final-check'
                        ? '检查清单补进'
                        : '新增临时日程'
                  appendLog('review', meeting.name, `${actionLabel} ${meeting.date} ${meeting.startTime}-${meeting.endTime}`)
                }}
                onExportPlan={handleExportReviewPlan}
                onImportPlan={handleImportReviewPlan}
                onToggleChecked={(meetingId) => {
                  const target = meetings.find((meeting) => meeting.id === meetingId)
                  const nextChecked = !reviewState.finalCheckStatus?.[meetingId]

                  setReviewState((current) => toggleFinalCheckLinkage(current, meetingId))

                  if (target) {
                    appendLog(
                      'review',
                      target.name,
                      nextChecked ? '检查清单已确认，审核排程自动锁定' : '取消检查确认，审核排程自动解锁',
                    )
                  }
                }}
                onRestoreMissingInstance={({ meeting, date, startTime, endTime }) => {
                  const restoredMeeting = {
                    id: `review-restored-${crypto.randomUUID()}`,
                    taskId: '',
                    meetingId: meeting.id,
                    name: meeting.name,
                    date,
                    startTime,
                    endTime,
                    duration: meeting.duration,
                    attendees: meeting.attendees ?? '',
                    notes: meeting.notes ?? '',
                    noteMentions: meeting.noteMentions ?? [],
                    frequency: meeting.frequency?.type ?? 'adhoc',
                    sourceFrequency: meeting.frequency ?? null,
                    sourceAnchorDate: meeting.frequency?.anchorDate ?? '',
                    aiReason: '检查清单补进',
                    locked: false,
                    reserved: false,
                    manuallyAdded: false,
                    restoredFromFinalCheck: true,
                    addSource: 'review-checklist',
                  }

                  updateReviewMeetings((meetingsList) => [...meetingsList, restoredMeeting])
                  appendLog(
                    'review',
                    meeting.name,
                    `检查清单补进方案 ${date} ${startTime}-${endTime}`,
                  )
                }}
              />
            )
          ) : (
            <LogsView
              activeSection={logsTab}
              logs={logs}
              onClear={() => setLogs([])}
              onDelete={(id) => setLogs((current) => current.filter((log) => log.id !== id))}
            />
          )}
        </div>
      </div>

      {editingMeeting ? (
        <EditModal
          meeting={editingMeeting}
          meetings={meetings}
          open={Boolean(editingMeeting) && !isEditModalClosing}
          isClosing={isEditModalClosing}
          onClose={closeEditMeeting}
          onSave={handleSaveMeeting}
        />
      ) : null}
      <BatchImportModal
        open={showBatchImport}
        meetings={meetings}
        onClose={() => setShowBatchImport(false)}
        onConfirm={(rows) => {
          const grouped = rows.reduce((accumulator, row) => {
            const meetingId = row.matchedMeeting.id
            const current = accumulator.get(meetingId) ?? []
            current.push(row.date)
            accumulator.set(meetingId, current)
            return accumulator
          }, new Map())

          setMeetings((current) =>
            current.map((meeting) => {
              const importedDates = grouped.get(meeting.id)
              if (!importedDates) return meeting

              const history = [...new Set([...(meeting.history ?? []), ...importedDates])].sort()
              const syncedMeeting = syncMeetingAnchorDate({
                ...meeting,
                history,
              })

              return {
                ...syncedMeeting,
                nextDate: calculateNextOccurrence(syncedMeeting) || meeting.nextDate || '',
              }
            }),
          )

          const duplicateCount = rows.filter((row) => row.isDuplicate).length
          appendLog(
            'batch_import',
            '会议历史记录',
            `批量导入 ${rows.length} 条历史记录${duplicateCount > 0 ? `，其中 ${duplicateCount} 条为重复日期` : ''}`,
          )
          setShowBatchImport(false)
        }}
      />
    </main>
  )
}

export default App
