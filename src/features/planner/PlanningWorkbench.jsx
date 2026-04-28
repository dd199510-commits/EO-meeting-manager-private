import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import {
  Bot,
  CalendarDays,
  Check,
  ChevronDown,
  Copy,
  Eye,
  List,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react'
import { FREQUENCY_LABELS } from '../../data/meetingData'
import { getCalendarDays, getNextMonthRange } from '../../lib/date'
import {
  buildAIPrompt,
  buildExportBatch,
  detectAIScheduleConflicts,
  optimizeInputForAI,
  validateImportedSchedule,
} from '../aiScheduler/aiSchedulerUtils'
import { generateScheduleInstances } from '../schedule/scheduleUtils'

function buildPlanningSourceSignature(meetings) {
  return JSON.stringify(
    meetings
      .map((meeting) => ({
        id: meeting.id,
        status: meeting.status,
        name: meeting.name,
        attendees: meeting.attendees,
        notes: meeting.notes,
        noteMentions: meeting.noteMentions ?? [],
        duration: meeting.duration,
        frequency: meeting.frequency,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  )
}

function exportInstances(range, instances, sourceSignature = '') {
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
      sourceSignature,
    },
  }
}

function copyText(text) {
  return navigator.clipboard.writeText(text)
}

function getFrequencyPillClass(frequency) {
  if (frequency === 'weekly') return 'pill pill-blue'
  if (frequency === 'monthly') return 'pill pill-green'
  if (frequency === 'yearly') return 'pill pill-orange'
  return 'pill pill-gray'
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

function replaceTaskIdsWithMeetingNames(text, taskNameMap) {
  if (!text) return ''

  return text.replace(/\bM-\d{3}\b/g, (taskId) => taskNameMap.get(taskId) ?? taskId)
}

const ACTIVE_JOB_STATUSES = new Set(['queued', 'submitting', 'submitted', 'polling', 'in_progress', 'retry_wait'])

const JOB_STATUS_LABELS = {
  queued: '排队中',
  submitting: '提交中',
  submitted: '已提交',
  polling: '等待结果',
  in_progress: '模型推理中',
  retry_wait: '网络波动，准备重试',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  expired: '已过期',
}

const JOB_PHASE_HINTS = {
  submitting: '正在创建 AI 任务并写入本地队列…',
  submitted: '任务已提交，正在等待模型开始处理…',
  polling: '正在同步最新结果，请稍候…',
  in_progress: '正在分析会议约束、计算排程组合…',
  retry_wait: '刚刚遇到网络波动，系统会继续重试…',
  completed: '结果已返回，可以确认后导入审核排程。',
  failed: '任务失败，请查看错误原因后重试。',
}

const UNSCHEDULED_TYPE_LABELS = {
  rule_conflict: '规则冲突',
  note_constraint: '备注约束',
  attendee_conflict: '参会人冲突',
  holiday_conflict: '节假日冲突',
  no_available_slot: '无可用时段',
  time_window_conflict: '时间窗口冲突',
  unknown: '未分类',
}

function getUnscheduledTypeLabel(type) {
  return UNSCHEDULED_TYPE_LABELS[type] ?? type ?? UNSCHEDULED_TYPE_LABELS.unknown
}

function getProviderLabel(provider) {
  if (provider === 'gemini') return 'Gemini'
  if (provider === 'deepseek') return 'DeepSeek'
  if (provider === 'imported') return '导入方案'
  return 'OpenAI'
}

function formatQueueTime(value) {
  if (!value) return '未记录时间'

  return new Date(value).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatQueueDateRange(range) {
  if (!range?.start && !range?.end) return '未记录排程范围'
  if (!range?.start) return `截至 ${range.end}`
  if (!range?.end) return `${range.start} 起`
  return `${range.start} 至 ${range.end}`
}

function getQueueSourceLabel(job) {
  if (job.provider === 'imported') return '外部导入'
  return 'AI 生成'
}

function getQueueModelLabel(job) {
  if (job.provider === 'imported') return '导入方案'
  return job.model || '未记录模型'
}

const MODEL_PRESETS = {
  gemini: [
    { value: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro Preview' },
    { value: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview' },
    { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { value: 'gemini-2.5-flash-lite-preview-09-2025', label: 'Gemini 2.5 Flash Lite Preview' },
  ],
  openai: [
    { value: 'gpt-5.4', label: 'GPT-5.4' },
    { value: 'gpt-5.4-pro', label: 'GPT-5.4 Pro' },
  ],
  deepseek: [
    { value: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
  ],
}

const PROVIDER_OPTIONS = [
  { value: 'gemini', label: 'Gemini', defaultModel: 'gemini-3.1-pro-preview', keyLabel: 'Gemini API Key', keyPlaceholder: 'AIza...' },
  { value: 'openai', label: 'OpenAI', defaultModel: 'gpt-5.4', keyLabel: 'OpenAI API Key', keyPlaceholder: 'sk-...' },
  { value: 'deepseek', label: 'DeepSeek', defaultModel: 'deepseek-v4-pro', keyLabel: 'DeepSeek API Key', keyPlaceholder: 'sk-...' },
]

function getProviderOption(provider) {
  return PROVIDER_OPTIONS.find((item) => item.value === provider) ?? PROVIDER_OPTIONS[0]
}

function getRuleSummary(rule) {
  const normalized = String(rule || '').replace(/\s+/g, ' ').trim()
  if (!normalized) return '排程规则'
  return normalized.length > 52 ? `${normalized.slice(0, 52)}...` : normalized
}

function hydrateImportedSchedule(parsed, exportBatch, rawExport) {
  const taskToInstance = new Map(exportBatch.taskMap.map((item) => [item.taskId, item.instanceId]))
  const instanceMap = new Map(rawExport.meetings.map((meeting) => [meeting.id, meeting]))

  return {
    ...parsed,
    scheduledMeetings: parsed.scheduledMeetings.map((meeting, index) => {
      const instanceId = taskToInstance.get(meeting.taskId)
      const sourceMeeting = instanceId ? instanceMap.get(instanceId) : null

      return {
        ...sourceMeeting,
        ...meeting,
        id: meeting.id ?? sourceMeeting?.id ?? `scheduled-${index + 1}`,
        taskId: meeting.taskId ?? '',
        meetingId: sourceMeeting?.meetingId ?? sourceMeeting?.sourceMeetingId ?? meeting.meetingId ?? '',
        name: sourceMeeting?.name ?? meeting.name ?? `任务 ${meeting.taskId || index + 1}`,
        attendees: sourceMeeting?.attendees ?? '',
        notes: sourceMeeting?.notes ?? meeting.notes ?? '',
        noteMentions: sourceMeeting?.noteMentions ?? [],
        sourceFrequency: sourceMeeting?.sourceFrequency ?? meeting.sourceFrequency ?? null,
        sourceAnchorDate: sourceMeeting?.sourceAnchorDate ?? meeting.sourceAnchorDate ?? '',
      }
    }),
  }
}

export function PlanningWorkbench({
  meetings,
  aiState,
  setAiState,
  onApplyAiSchedule,
}) {
  const [showConnectionModal, setShowConnectionModal] = useState(false)
  const [showConstraints, setShowConstraints] = useState(false)
  const [selectedSchemeId, setSelectedSchemeId] = useState('')
  const [selectedJobDetails, setSelectedJobDetails] = useState(null)
  const [showInputJsonModal, setShowInputJsonModal] = useState(false)
  const [showResultJsonModal, setShowResultJsonModal] = useState(false)
  const [range, setRange] = useState(() => aiState.inputMeetings?.timeRange ?? getNextMonthRange())
  const [showInstancesModal, setShowInstancesModal] = useState(false)
  const [instancesView, setInstancesView] = useState('calendar')
  const [lookupInput, setLookupInput] = useState('')
  const [scheduleText, setScheduleText] = useState('')
  const [scheduleError, setScheduleError] = useState('')
  const [ruleInput, setRuleInput] = useState('')
  const [slotInput, setSlotInput] = useState({ start: '', end: '', reason: '' })
  const [expandedRuleIds, setExpandedRuleIds] = useState([])
  const [generatedInstances, setGeneratedInstances] = useState(() => aiState.inputMeetings?.meetings ?? [])
  const [generatedSourceSignature, setGeneratedSourceSignature] = useState(
    () => aiState.inputMeetings?.metadata?.sourceSignature ?? '',
  )
  const [aiJobs, setAiJobs] = useState([])
  const [submitError, setSubmitError] = useState('')
  const [submitBusy, setSubmitBusy] = useState(false)
  const [configState, setConfigState] = useState({
    providers: {
      openai: { hasApiKey: false },
      gemini: { hasApiKey: false },
      deepseek: { hasApiKey: false },
    },
    encryptionMode: '',
    updatedAt: '',
  })
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [configBusy, setConfigBusy] = useState(false)
  const [configError, setConfigError] = useState('')
  const [importMessage, setImportMessage] = useState('')
  const importSectionRef = useRef(null)

  const currentSourceSignature = useMemo(() => buildPlanningSourceSignature(meetings), [meetings])
  const pendingInstances = useMemo(() => generateScheduleInstances(meetings, range), [meetings, range])
  const rawExport = useMemo(
    () => exportInstances(range, generatedInstances, generatedSourceSignature),
    [generatedInstances, generatedSourceSignature, range],
  )
  const isGeneratedPlanStale =
    generatedInstances.length > 0 &&
    generatedSourceSignature &&
    generatedSourceSignature !== currentSourceSignature
  const exportBatch = useMemo(
    () => buildExportBatch(rawExport, aiState.exportBatch),
    [aiState.exportBatch, rawExport],
  )
  const optimizedInput = useMemo(
    () => optimizeInputForAI(rawExport, exportBatch, meetings),
    [exportBatch, meetings, rawExport],
  )
  const aiPrompt = useMemo(
    () => buildAIPrompt(rawExport, aiState.preferences, exportBatch, meetings),
    [aiState.preferences, exportBatch, meetings, rawExport],
  )
  const scheduleConflicts = useMemo(
    () =>
      aiState.scheduledMeetings?.scheduledMeetings
        ? detectAIScheduleConflicts(aiState.scheduledMeetings.scheduledMeetings)
        : [],
    [aiState.scheduledMeetings],
  )
  const months = useMemo(() => getMonthsInRange(range), [range])
  const meetingsByDate = useMemo(() => {
    return generatedInstances.reduce((accumulator, meeting) => {
      const current = accumulator.get(meeting.date) ?? []
      current.push(meeting)
      accumulator.set(meeting.date, current)
      return accumulator
    }, new Map())
  }, [generatedInstances])
  const summary = useMemo(() => {
    return generatedInstances.reduce(
      (accumulator, item) => {
        accumulator.total += 1
        accumulator[item.frequency] = (accumulator[item.frequency] ?? 0) + 1
        return accumulator
      },
      { total: 0 },
    )
  }, [generatedInstances])
  const desktopAiAvailable =
    typeof window !== 'undefined' &&
    window.aiScheduler &&
    typeof window.aiScheduler.listJobs === 'function'
  const currentBatchJobs = useMemo(() => {
    const batchId = exportBatch?.batchId
    if (!batchId) return []
    return aiJobs.filter((job) => job.batchId === batchId)
  }, [aiJobs, exportBatch])
  const activeBatchJobs = useMemo(
    () => currentBatchJobs.filter((job) => ACTIVE_JOB_STATUSES.has(job.status)),
    [currentBatchJobs],
  )
  const finishedBatchJobs = useMemo(
    () => currentBatchJobs.filter((job) => !ACTIVE_JOB_STATUSES.has(job.status)),
    [currentBatchJobs],
  )
  const schemeHistory = useMemo(
    () =>
      aiJobs
        .filter((job) => job.result && job.inputMeetings?.timeRange?.start && job.inputMeetings?.timeRange?.end)
        .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()),
    [aiJobs],
  )
  const taskQueue = useMemo(
    () =>
      [...aiJobs].sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()),
    [aiJobs],
  )
  const groupedTaskQueue = useMemo(() => {
    const aiGenerated = taskQueue.filter((job) => job.provider !== 'imported')
    const imported = taskQueue.filter((job) => job.provider === 'imported')

    return [
      {
        key: 'ai',
        title: 'AI 生成',
        description: '系统提交给模型并返回的排程结果',
        items: aiGenerated,
      },
      {
        key: 'imported',
        title: '外部导入',
        description: '从排程调整导入并回写到任务队列的方案',
        items: imported,
      },
    ].filter((group) => group.items.length > 0)
  }, [taskQueue])
  const latestBatchJob = currentBatchJobs[0] ?? null
  const aiSettings = aiState.settings ?? {
    provider: 'gemini',
    model: 'gemini-3.1-pro-preview',
    autoImportResult: true,
    autoImportToReview: false,
    lastImportedJobId: '',
  }
  const currentProvider = MODEL_PRESETS[aiSettings.provider] ? aiSettings.provider : 'gemini'
  const currentProviderOption = getProviderOption(currentProvider)
  const currentProviderHasKey = Boolean(configState.providers?.[currentProvider]?.hasApiKey)
  const currentModelPresets = MODEL_PRESETS[currentProvider]
  const hasGeneratedPlan = generatedInstances.length > 0
  const canSubmitToAi = hasGeneratedPlan && !isGeneratedPlanStale
  const hasImportedSchedule = Boolean(aiState.scheduledMeetings?.scheduledMeetings?.length)
  const latestJobPhaseHint =
    JOB_PHASE_HINTS[latestBatchJob?.status] ??
    (latestBatchJob ? '任务状态已更新。' : '生成清单后即可直接提交给 AI 排程。')

  async function refreshAiConfig() {
    if (!desktopAiAvailable) return null

    try {
      const config = await window.aiScheduler.getConfig()
      setConfigState(config)
      setConfigError('')
      return config
    } catch (error) {
      setConfigError(error.message)
      return null
    }
  }

  const aiResultSummary = useMemo(() => {
    if (!hasImportedSchedule) return null

    const scheduledCount = aiState.scheduledMeetings.scheduledMeetings.length
    const unscheduledCount = aiState.scheduledMeetings.summary?.unscheduledMeetings ?? 0

    return {
      scheduledCount,
      unscheduledCount,
      conflictCount: scheduleConflicts.length,
    }
  }, [aiState.scheduledMeetings, hasImportedSchedule, scheduleConflicts.length])
  const unscheduledPreviewItems = useMemo(() => {
    if (!hasImportedSchedule) return []

    const taskNameMap = new Map(
      (aiState.scheduledMeetings?.scheduledMeetings ?? [])
        .filter((meeting) => meeting.taskId && meeting.name)
        .map((meeting) => [meeting.taskId, meeting.name]),
    )
    const exportedMeetingsByInstanceId = new Map(
      Array.isArray(aiState.inputMeetings?.meetings)
        ? aiState.inputMeetings.meetings.map((meeting) => [meeting.id, meeting])
        : [],
    )
    const scheduledTaskIds = new Set(
      (aiState.scheduledMeetings?.scheduledMeetings ?? []).map((meeting) => meeting.taskId).filter(Boolean),
    )
    const importedUnscheduled = Array.isArray(aiState.scheduledMeetings?.unscheduledMeetings)
      ? aiState.scheduledMeetings.unscheduledMeetings
      : []
    const importedUnscheduledReasonMap = new Map(
      importedUnscheduled
        .filter((item) => item?.taskId)
        .map((item) => [
          item.taskId,
          {
            reason: replaceTaskIdsWithMeetingNames(item.reason ?? '', taskNameMap) || '无',
            type: item.type ?? '',
          },
        ]),
    )

    const normalized = Array.isArray(aiState.exportBatch?.taskMap)
      ? aiState.exportBatch.taskMap
          .filter((item) => item.taskId && !scheduledTaskIds.has(item.taskId))
          .map((item) => {
            const sourceMeeting = exportedMeetingsByInstanceId.get(item.instanceId)
            const imported = importedUnscheduledReasonMap.get(item.taskId)

            return {
              taskId: item.taskId,
              name: sourceMeeting?.name ?? item.taskId,
              date: sourceMeeting?.date ?? item.date ?? '',
              reason: imported?.reason || '无',
              type: imported?.type || '',
            }
          })
      : []

    return normalized.slice(0, 6)
  }, [aiState.exportBatch, aiState.inputMeetings, aiState.scheduledMeetings, hasImportedSchedule])
  const selectedSchemeJob = useMemo(() => {
    if (!taskQueue.length) return null
    if (!selectedSchemeId) return null
    return selectedJobDetails?.id === selectedSchemeId
      ? selectedJobDetails
      : (taskQueue.find((job) => job.id === selectedSchemeId) ?? null)
  }, [selectedJobDetails, taskQueue, selectedSchemeId])
  const selectedSchemeData = useMemo(() => {
    if (!selectedSchemeJob?.result || !selectedSchemeJob?.exportBatch || !selectedSchemeJob?.inputMeetings) {
      return null
    }

    try {
      const parsed = hydrateImportedSchedule(
        validateImportedSchedule(JSON.stringify(selectedSchemeJob.result)),
        selectedSchemeJob.exportBatch,
        selectedSchemeJob.inputMeetings,
      )
      const conflicts = detectAIScheduleConflicts(parsed.scheduledMeetings)
      const scheduledCount = parsed.scheduledMeetings.length
      const unscheduledMeetings = Array.isArray(parsed.unscheduledMeetings) ? parsed.unscheduledMeetings : []
      const taskNameMap = new Map(
        parsed.scheduledMeetings
          .filter((meeting) => meeting.taskId && meeting.name)
          .map((meeting) => [meeting.taskId, meeting.name]),
      )
      const exportedMeetingsByInstanceId = new Map(
        (selectedSchemeJob.inputMeetings?.meetings ?? []).map((meeting) => [meeting.id, meeting]),
      )
      const scheduledTaskIds = new Set(
        parsed.scheduledMeetings.map((meeting) => meeting.taskId).filter(Boolean),
      )
      const importedUnscheduledReasonMap = new Map(
        unscheduledMeetings
          .filter((item) => item?.taskId)
          .map((item) => [
            item.taskId,
            {
              reason: replaceTaskIdsWithMeetingNames(item.reason ?? '', taskNameMap) || '无',
              type: item.type ?? '',
            },
          ]),
      )
      const normalizedUnscheduledMeetings = Array.isArray(selectedSchemeJob.exportBatch?.taskMap)
        ? selectedSchemeJob.exportBatch.taskMap
            .filter((item) => item.taskId && !scheduledTaskIds.has(item.taskId))
            .map((item) => {
              const sourceMeeting = exportedMeetingsByInstanceId.get(item.instanceId)
              const imported = importedUnscheduledReasonMap.get(item.taskId)

              return {
                taskId: item.taskId,
                name: sourceMeeting?.name ?? taskNameMap.get(item.taskId) ?? item.taskId,
                date: sourceMeeting?.date ?? item.date ?? '',
                reason: imported?.reason || '无',
                type: imported?.type || '',
              }
            })
        : []
      const normalizedConflicts = conflicts.map((conflict) => ({
        ...conflict,
        description: replaceTaskIdsWithMeetingNames(conflict.description ?? '', taskNameMap),
      }))

      return {
        job: selectedSchemeJob,
        parsed,
        conflicts: normalizedConflicts,
        summary: {
          scheduledCount,
          unscheduledCount: parsed.summary?.unscheduledMeetings ?? normalizedUnscheduledMeetings.length,
          conflictCount: normalizedConflicts.length,
        },
        unscheduledPreviewItems: normalizedUnscheduledMeetings.slice(0, 6),
      }
    } catch {
      return null
    }
  }, [selectedSchemeJob])
  const displayedResultSummary = selectedSchemeData?.summary ?? (selectedSchemeJob ? null : aiResultSummary)
  const displayedUnscheduledPreviewItems = selectedSchemeData?.unscheduledPreviewItems ?? (selectedSchemeJob ? [] : unscheduledPreviewItems)
  const selectedSchemeOverview = useMemo(() => {
    if (!selectedSchemeJob || !displayedResultSummary) return null

    const scheduledMeetings = selectedSchemeData?.parsed?.scheduledMeetings ?? []
    const frequencyCounts = scheduledMeetings.reduce(
      (accumulator, meeting) => {
        accumulator[meeting.frequency] = (accumulator[meeting.frequency] ?? 0) + 1
        return accumulator
      },
      { weekly: 0, monthly: 0, yearly: 0, adhoc: 0 },
    )
    const scheduledByDate = scheduledMeetings.reduce((accumulator, meeting) => {
      accumulator.set(meeting.date, (accumulator.get(meeting.date) ?? 0) + 1)
      return accumulator
    }, new Map())
    const busiestDates = Array.from(scheduledByDate.entries())
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 3)
      .map(([date, count]) => ({ date, count }))
    const unscheduledTypes = displayedUnscheduledPreviewItems.reduce((accumulator, item) => {
      const key = item.type || '未分类'
      accumulator[key] = (accumulator[key] ?? 0) + 1
      return accumulator
    }, {})
    const totalCount = (displayedResultSummary.scheduledCount ?? 0) + (displayedResultSummary.unscheduledCount ?? 0)
    const completionRate = totalCount
      ? Math.round(((displayedResultSummary.scheduledCount ?? 0) / totalCount) * 100)
      : 0

    return {
      frequencyCounts,
      busiestDates,
      unscheduledTypes: Object.entries(unscheduledTypes),
      completionRate,
    }
  }, [displayedResultSummary, displayedUnscheduledPreviewItems, selectedSchemeData, selectedSchemeJob])
  const groupedUnscheduledPreviewItems = useMemo(() => {
    const groups = displayedUnscheduledPreviewItems.reduce((accumulator, item) => {
      const type = item.type || 'unknown'
      const current = accumulator.get(type) ?? []
      current.push(item)
      accumulator.set(type, current)
      return accumulator
    }, new Map())

    return Array.from(groups.entries()).map(([type, items]) => ({
      type,
      label: getUnscheduledTypeLabel(type),
      count: items.length,
      items,
    }))
  }, [displayedUnscheduledPreviewItems])
  const selectedSchemeRange = selectedSchemeJob?.inputMeetings?.timeRange ?? range
  const selectedSchemeMonths = useMemo(
    () => getMonthsInRange(selectedSchemeRange),
    [selectedSchemeRange],
  )
  const selectedSchedulePreviewRows = useMemo(
    () =>
      (selectedSchemeData?.parsed?.scheduledMeetings ?? [])
        .slice()
        .sort(
          (left, right) =>
            left.date.localeCompare(right.date) ||
            (left.startTime ?? '').localeCompare(right.startTime ?? '') ||
            left.name.localeCompare(right.name, 'zh-CN'),
        ),
    [selectedSchemeData],
  )
  const selectedScheduledMeetingsByDate = useMemo(() => {
    return selectedSchedulePreviewRows.reduce((accumulator, meeting) => {
      const current = accumulator.get(meeting.date) ?? []
      current.push(meeting)
      accumulator.set(meeting.date, current)
      return accumulator
    }, new Map())
  }, [selectedSchedulePreviewRows])
  const maxDailySelectedScheduleCount = useMemo(() => {
    return Math.max(1, ...Array.from(selectedScheduledMeetingsByDate.values()).map((items) => items.length))
  }, [selectedScheduledMeetingsByDate])
  const planningInputInstances = hasGeneratedPlan ? generatedInstances : pendingInstances
  const planningMeetingsByDate = useMemo(() => {
    return planningInputInstances.reduce((accumulator, meeting) => {
      const current = accumulator.get(meeting.date) ?? []
      current.push(meeting)
      accumulator.set(meeting.date, current)
      return accumulator
    }, new Map())
  }, [planningInputInstances])
  const maxDailyPlanningCount = useMemo(() => {
    return Math.max(1, ...Array.from(planningMeetingsByDate.values()).map((items) => items.length))
  }, [planningMeetingsByDate])
  const plannerRuleItems = useMemo(() => {
    const rules = aiState.preferences.rules.map((rule, index) => ({
      id: `rule-${index}`,
      title: getRuleSummary(rule),
      detail: rule,
      badge: '规则',
    }))
    const slots = aiState.preferences.avoidTimeSlots.map((slot, index) => ({
      id: `slot-${index}`,
      title: `${slot.start} - ${slot.end} 不排会`,
      detail: slot.reason ? `原因：${slot.reason}` : 'AI 排程时会避开这个时间段。',
      badge: '时段',
    }))

    return [...rules, ...slots]
  }, [aiState.preferences.avoidTimeSlots, aiState.preferences.rules])
  const planningInputSummary = useMemo(() => {
    return planningInputInstances.reduce(
      (accumulator, item) => {
        accumulator.total += 1
        accumulator[item.frequency] = (accumulator[item.frequency] ?? 0) + 1
        return accumulator
      },
      { total: 0 },
    )
  }, [planningInputInstances])
  const planningPreviewRows = useMemo(
    () =>
      planningInputInstances
        .slice()
        .sort((left, right) => left.date.localeCompare(right.date) || left.name.localeCompare(right.name, 'zh-CN')),
    [planningInputInstances],
  )
  const hasSelectedScheme = Boolean(selectedSchemeId && (selectedSchemeJob || selectedSchemeData || aiResultSummary))
  const handleCompletedJob = useEffectEvent((job, options = {}) => {
    importJobResult(job, options)
  })
  const mappingLookup = useMemo(() => {
    const normalizedInput = lookupInput.trim().toUpperCase()
    if (!normalizedInput) return null

    const instanceMap = new Map(rawExport.meetings.map((meeting) => [meeting.id, meeting]))
    const taskRows = (exportBatch.taskMap ?? []).map((item) => {
      const sourceMeeting = instanceMap.get(item.instanceId)
      return {
        key: item.taskId,
        kind: 'task',
        name: sourceMeeting?.name ?? '未知会议',
        date: sourceMeeting?.date ?? item.date ?? '',
        meetingId: item.meetingId ?? '',
      }
    })

    const scheduledMeetingIds = new Set(
      (exportBatch.taskMap ?? []).map((item) => item.meetingId).filter(Boolean),
    )
    const referenceMeetings = new Map()
    rawExport.meetings.forEach((meeting) => {
      ;(Array.isArray(meeting.noteMentions) ? meeting.noteMentions : []).forEach((mention) => {
        if (!mention?.meetingId || scheduledMeetingIds.has(mention.meetingId)) {
          return
        }

        if (!referenceMeetings.has(mention.meetingId)) {
          referenceMeetings.set(mention.meetingId, {
            meetingId: mention.meetingId,
            name: mention.label || mention.meetingId,
          })
        }
      })
    })

    const referenceRows = Array.from(referenceMeetings.values())
      .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
      .map((meeting, index) => ({
        key: `R-${String(index + 1).padStart(3, '0')}`,
        kind: 'reference',
        name: meeting.name,
        date: '',
        meetingId: meeting.meetingId,
      }))

    return [...taskRows, ...referenceRows].find((item) => item.key === normalizedInput) ?? {
      key: normalizedInput,
      kind: 'missing',
    }
  }, [exportBatch.taskMap, lookupInput, rawExport.meetings])

  useEffect(() => {
    if (!desktopAiAvailable) return undefined

    let cancelled = false

    async function loadConfig() {
      try {
        const config = await window.aiScheduler.getConfig()
        if (!cancelled) {
          setConfigState(config)
          setConfigError('')
        }
      } catch (error) {
        if (!cancelled) {
          setConfigError(error.message)
        }
      }
    }

    async function loadJobs() {
      try {
        const jobs = await window.aiScheduler.listJobs()
        if (!cancelled) {
          setAiJobs(Array.isArray(jobs) ? jobs : [])
        }
      } catch (error) {
        if (!cancelled) {
          setSubmitError(error.message)
        }
      }
    }

    loadConfig()
    loadJobs()

    const delay = currentBatchJobs.some((job) => ACTIVE_JOB_STATUSES.has(job.status)) ? 5000 : 15000
    const timer = window.setInterval(loadJobs, delay)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [currentBatchJobs, desktopAiAvailable])

  useEffect(() => {
    if (!latestBatchJob || latestBatchJob.status !== 'completed') return
    if (!aiSettings.autoImportResult) return
    if (aiSettings.lastImportedJobId === latestBatchJob.id) return

    handleCompletedJob(latestBatchJob, {
      markImported: true,
      importToReview: aiSettings.autoImportToReview,
    })
  }, [aiSettings.autoImportResult, aiSettings.autoImportToReview, aiSettings.lastImportedJobId, latestBatchJob])

  useEffect(() => {
    if (!desktopAiAvailable || !selectedSchemeId || typeof window.aiScheduler?.getJob !== 'function') {
      return undefined
    }

    let cancelled = false

    async function loadSelectedJob() {
      try {
        const job = await window.aiScheduler.getJob(selectedSchemeId)
        if (!cancelled) {
          setSelectedJobDetails(job ?? null)
        }
      } catch {
        if (!cancelled) {
          setSelectedJobDetails(null)
        }
      }
    }

    loadSelectedJob()

    return () => {
      cancelled = true
    }
  }, [desktopAiAvailable, selectedSchemeId])

  function updatePreferences(nextPreferences) {
    setAiState((current) => ({
      ...current,
      inputMeetings: rawExport,
      exportBatch,
      preferences: nextPreferences,
    }))
  }

  function generateAiInput() {
    const nextExport = exportInstances(range, pendingInstances, currentSourceSignature)
    const nextBatch = buildExportBatch(nextExport)
    setGeneratedInstances(pendingInstances)
    setGeneratedSourceSignature(currentSourceSignature)
    setImportMessage('')
    setAiState((current) => ({
      ...current,
      inputMeetings: nextExport,
      exportBatch: nextBatch,
    }))
  }

  function clearGeneratedInstances() {
    setGeneratedInstances([])
    setGeneratedSourceSignature('')
    setImportMessage('')
    setShowInstancesModal(false)
    setShowResultJsonModal(false)
    setAiState((current) => ({
      ...current,
      inputMeetings: null,
      exportBatch: null,
    }))
  }

  function removeGeneratedInstance(instanceId) {
    setGeneratedInstances((current) => current.filter((item) => item.id !== instanceId))
    setAiState((current) => {
      const nextMeetings = (current.inputMeetings?.meetings ?? []).filter((item) => item.id !== instanceId)
      return {
        ...current,
        exportBatch: current.exportBatch
          ? {
              ...current.exportBatch,
              taskMap: (current.exportBatch.taskMap ?? []).filter((item) => item.instanceId !== instanceId),
            }
          : null,
        inputMeetings: current.inputMeetings
          ? {
              ...current.inputMeetings,
              meetings: nextMeetings,
              metadata: current.inputMeetings.metadata
                ? { ...current.inputMeetings.metadata, totalCount: nextMeetings.length }
                : current.inputMeetings.metadata,
            }
          : current.inputMeetings,
      }
    })
  }

  function importAiResult() {
    try {
      if (!exportBatch?.taskMap?.length || !rawExport?.meetings?.length) {
        setScheduleError('请先生成待排程清单，再导入 AI 返回结果。')
        return
      }

      if (!scheduleText.trim()) {
        if (latestBatchJob?.result) {
          importJobResult(latestBatchJob, { markImported: true, importToReview: false })
          return
        }

        setScheduleError('当前文本框为空。你可以粘贴 AI 返回的 JSON，或先点击上方任务卡片里的“导入结果”。')
        return
      }

      const parsed = hydrateImportedSchedule(validateImportedSchedule(scheduleText), exportBatch, rawExport)

      setAiState((current) => ({
        ...current,
        inputMeetings: rawExport,
        exportBatch,
        scheduledMeetings: parsed,
      }))
      setScheduleText('')
      setScheduleError('')
      setImportMessage(`已导入 ${parsed.scheduledMeetings.length} 条 AI 排程结果，请继续导入到审核排程。`)
      importSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    } catch (error) {
      setScheduleError(error.message || '导入 AI 排程结果失败，请检查 JSON 格式。')
    }
  }

  async function submitAiJob() {
    if (!desktopAiAvailable) {
      setSubmitError('当前运行环境未挂载 Electron AI 服务，请使用桌面版。')
      return
    }

    if (!exportBatch?.taskMap?.length || !rawExport?.meetings?.length) {
      setSubmitError('请先生成待排程清单，再提交给 AI。')
      return
    }

    setSubmitBusy(true)
    setSubmitError('')
    setImportMessage('')

    try {
      await window.aiScheduler.submitJob({
        batchId: exportBatch.batchId,
        provider: currentProvider,
        model: aiSettings.model || currentProviderOption.defaultModel,
        prompt: aiPrompt,
        inputMeetings: rawExport,
        preferences: aiState.preferences,
        exportBatch,
        promptVersion: 'v1',
      })

      const jobs = await window.aiScheduler.listJobs()
      setAiJobs(Array.isArray(jobs) ? jobs : [])
    } catch (error) {
      setSubmitError(error.message)
    } finally {
      setSubmitBusy(false)
    }
  }

  async function retryAiJob(jobId) {
    if (!desktopAiAvailable || !jobId) return

    setSubmitBusy(true)
    setSubmitError('')
    setImportMessage('')

    try {
      await window.aiScheduler.retryJob(jobId)
      const jobs = await window.aiScheduler.listJobs()
      setAiJobs(Array.isArray(jobs) ? jobs : [])
    } catch (error) {
      setSubmitError(error.message)
    } finally {
      setSubmitBusy(false)
    }
  }

  async function saveApiKey() {
    if (!desktopAiAvailable) return

    setConfigBusy(true)
    setConfigError('')

    try {
      const nextConfig = await window.aiScheduler.saveApiKey({
        provider: currentProvider,
        apiKey: apiKeyInput,
      })
      setConfigState(nextConfig)
      setApiKeyInput('')
      await refreshAiConfig()
    } catch (error) {
      setConfigError(error.message)
    } finally {
      setConfigBusy(false)
    }
  }

  async function clearApiKey() {
    if (!desktopAiAvailable) return

    setConfigBusy(true)
    setConfigError('')

    try {
      const nextConfig = await window.aiScheduler.clearApiKey(currentProvider)
      setConfigState(nextConfig)
      await refreshAiConfig()
    } catch (error) {
      setConfigError(error.message)
    } finally {
      setConfigBusy(false)
    }
  }

  function updateAiSettings(patch) {
    setAiState((current) => ({
      ...current,
      settings: {
        ...(current.settings ?? {}),
        ...patch,
      },
    }))
  }

  function selectProvider(providerOption) {
    updateAiSettings({
      provider: providerOption.value,
      model: providerOption.defaultModel,
    })
    setApiKeyInput('')
    refreshAiConfig()
  }

  function openConnectionSettings() {
    setShowConnectionModal(true)
    refreshAiConfig()
  }

  function importJobResult(job, options = {}) {
    try {
      if (!job?.result) {
        setScheduleError('该任务还没有可导入的排程结果。')
        return
      }

      const sourceExportBatch = job.exportBatch ?? exportBatch
      const sourceInputMeetings = job.inputMeetings ?? rawExport

      if (!sourceExportBatch?.taskMap?.length || !sourceInputMeetings?.meetings?.length) {
        setScheduleError('请先保留当前批次清单，再导入 AI 返回结果。')
        return
      }

      const parsed = hydrateImportedSchedule(
        validateImportedSchedule(JSON.stringify(job.result)),
        sourceExportBatch,
        sourceInputMeetings,
      )

      const nextAiState = {
        ...aiState,
        inputMeetings: sourceInputMeetings,
        exportBatch: sourceExportBatch,
        scheduledMeetings: parsed,
        settings: {
          ...aiSettings,
          lastImportedJobId: options.markImported ? job.id : aiSettings.lastImportedJobId,
        },
      }

      if (typeof onApplyAiSchedule === 'function') {
        onApplyAiSchedule(nextAiState, { importToReview: options.importToReview === true })
      } else {
        setAiState(nextAiState)
      }
      setScheduleError('')
      setImportMessage(
        options.importToReview
          ? `已导入 ${parsed.scheduledMeetings.length} 条 AI 排程结果，正在进入排程调整。`
          : `已导入 ${parsed.scheduledMeetings.length} 条 AI 排程结果，请继续导入到审核排程。`,
      )
      importSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    } catch (error) {
      setScheduleError(error.message)
    }
  }

  function renderCalendarMonth(year, month) {
    const days = getCalendarDays(year, month)

    return (
      <div className="schedule-calendar-block" key={`${year}-${month}`}>
        <div className="month-nav">
          <strong>
            {year} 年 {month + 1} 月
          </strong>
        </div>
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
              <div key={day.date} className={day.isCurrentMonth ? 'month-cell' : 'month-cell month-cell-muted'}>
                <div className="month-cell-day">{day.day}</div>
                <div className="month-cell-items">
                  {items.slice(0, 4).map((item) => (
                    <div key={item.id} className="month-item">
                      <span className="truncate-line">{item.name}</span>
                      <button
                        type="button"
                        className="instance-delete-chip"
                        onClick={(event) => {
                          event.stopPropagation()
                          removeGeneratedInstance(item.id)
                        }}
                        aria-label={`删除 ${item.name}`}
                      >
                        <Trash2 size={12} />
                      </button>
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

  function renderDistributionCalendarMonth(year, month, options = {}) {
    const {
      meetingsByDate: sourceMeetingsByDate = planningMeetingsByDate,
      maxDailyCount = maxDailyPlanningCount,
      totalCount = planningInputSummary.total,
      dateRange = range,
    } = options
    const days = getCalendarDays(year, month)

    return (
      <div className="planner-date-distribution">
        <div className="planner-date-distribution-head">
          <div>
            <strong>
              {year} 年 {month + 1} 月
            </strong>
            <span>{dateRange.start} - {dateRange.end}</span>
          </div>
          <em>{totalCount} 场</em>
        </div>
        <div className="month-grid month-grid-head">
          {['周一', '周二', '周三', '周四', '周五', '周六', '周日'].map((label) => (
            <div key={label} className="month-head-cell">
              {label}
            </div>
          ))}
        </div>
        <div className="month-grid planner-distribution-grid">
          {days.map((day) => {
            const items = sourceMeetingsByDate.get(day.date) ?? []
            const count = items.length
            const density = Math.min(1, count / maxDailyCount)

            return (
              <div
                key={day.date}
                className={[
                  day.isCurrentMonth ? 'planner-distribution-day' : 'planner-distribution-day planner-distribution-day-muted',
                  count > 0 ? 'planner-distribution-day-active' : '',
                ].filter(Boolean).join(' ')}
                title={count > 0 ? `${day.date} · ${count} 场会议` : day.date}
              >
                <span className="planner-distribution-day-number">{day.day}</span>
                {count > 0 ? <strong>{count}</strong> : <span className="planner-distribution-empty-count" />}
                {count > 0 ? (
                  <span className="planner-distribution-bar">
                    <span style={{ width: `${Math.max(18, density * 100)}%` }} />
                  </span>
                ) : (
                  <span className="planner-distribution-empty-mark" />
                )}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="planner-generation-page">
      <section className="panel planner-step-card planner-step-card-range">
        <div className="planner-step-card-head">
          <strong>步骤 1</strong>
          <h2>范围与清单</h2>
          <span>选择时间范围</span>
        </div>
        <div className="planner-range-fields">
          <label className="field">
            <span>开始</span>
            <input type="date" value={range.start} onChange={(event) => setRange({ ...range, start: event.target.value })} />
          </label>
          <label className="field">
            <span>结束</span>
            <input type="date" value={range.end} onChange={(event) => setRange({ ...range, end: event.target.value })} />
          </label>
          <button className="primary-button planner-generate-button" onClick={generateAiInput}>
            <Bot size={16} />
            {hasGeneratedPlan ? '更新清单' : '生成清单'}
          </button>
        </div>
        <div className={hasGeneratedPlan ? 'planner-ready-card planner-ready-card-ok' : 'planner-ready-card'}>
          <Check size={16} />
          <div>
            <strong>{hasGeneratedPlan ? '清单已准备就绪' : '等待生成清单'}</strong>
            <span>
              {hasGeneratedPlan
                ? `已生成 ${exportBatch.taskMap.length} 个任务编号`
                : `当前范围预计生成 ${pendingInstances.length} 条会议实例`}
            </span>
          </div>
        </div>
        <div className="planner-count-grid">
          <div className="planner-count-card planner-count-card-total">
            <span>待排程</span>
            <strong>{planningInputSummary.total}</strong>
          </div>
          {Object.entries(FREQUENCY_LABELS).map(([key, label]) => (
            <div key={key} className={`planner-count-card planner-count-card-${key}`}>
              <span>{label}</span>
              <strong>{planningInputSummary[key] ?? 0}</strong>
            </div>
          ))}
        </div>
        <div className="planner-rule-list">
          <div className="planner-rule-list-head">
            <strong>约束规则</strong>
            <span>生效中 {plannerRuleItems.length} 条</span>
          </div>
          {plannerRuleItems.map((rule) => {
            const isExpanded = expandedRuleIds.includes(rule.id)

            return (
              <div key={rule.id} className={isExpanded ? 'planner-rule-item planner-rule-item-expanded' : 'planner-rule-item'}>
                <button
                  type="button"
                  className={isExpanded ? 'planner-rule-expand planner-rule-expand-open' : 'planner-rule-expand'}
                  onClick={() =>
                    setExpandedRuleIds((current) =>
                      current.includes(rule.id)
                        ? current.filter((item) => item !== rule.id)
                        : [...current, rule.id],
                    )
                  }
                  aria-label={isExpanded ? `收起 ${rule.title}` : `展开 ${rule.title}`}
                >
                  <ChevronDown size={14} />
                </button>
                <div className="planner-rule-copy">
                  <span>{rule.title}</span>
                  {isExpanded ? <p>{rule.detail}</p> : null}
                </div>
                <em>{rule.badge}</em>
              </div>
            )
          })}
          {plannerRuleItems.length === 0 ? (
            <div className="planner-rule-item planner-rule-item-empty">
              <div className="planner-rule-copy">
                <span>暂无约束规则</span>
              </div>
            </div>
          ) : null}
          <button className="ghost-button" type="button" onClick={() => setShowConstraints((current) => !current)}>
            管理约束规则
          </button>
        </div>
        {showConstraints ? (
          <div className="planner-constraint-editor planner-constraint-editor-card">
            <label className="field">
              <span>新增排程规则</span>
              <div className="simple-form">
                <input value={ruleInput} onChange={(event) => setRuleInput(event.target.value)} placeholder="例如：周会优先安排上午" />
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
                  新增
                </button>
              </div>
            </label>
            <label className="field">
              <span>新增避开时段</span>
              <div className="simple-form">
                <input type="time" value={slotInput.start} onChange={(event) => setSlotInput({ ...slotInput, start: event.target.value })} />
                <input type="time" value={slotInput.end} onChange={(event) => setSlotInput({ ...slotInput, end: event.target.value })} />
                <input placeholder="原因" value={slotInput.reason} onChange={(event) => setSlotInput({ ...slotInput, reason: event.target.value })} />
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
                  新增
                </button>
              </div>
            </label>
          </div>
        ) : null}
        <div className="planner-status-table">
          <div><span>数据来源</span><strong>会议库（{meetings.length} 条会议模板）</strong></div>
          <div><span>覆盖范围</span><strong>{range.start} ~ {range.end}</strong></div>
          <div><span>预计冲突数</span><strong>{scheduleConflicts.length}</strong></div>
        </div>
      </section>

      <section className="panel planner-step-card planner-step-card-preview">
        <div className="planner-step-card-head planner-step-card-head-row">
          <div>
            <strong>步骤 2</strong>
            <h2>清单预览与日期分布</h2>
          </div>
          <div className="planner-preview-actions">
            <button className="ghost-button" onClick={() => setShowInstancesModal(true)} disabled={!hasGeneratedPlan}>
              <Eye size={16} />
              查看完整清单
            </button>
          </div>
        </div>
        <div className="planner-preview-toolbar">
          <div className="search-box">
            <List size={15} />
            <input readOnly value="" placeholder="搜索会议名称、负责人或备注" />
          </div>
          <button className="ghost-button" type="button">
            筛选
            <ChevronDown size={14} />
          </button>
        </div>
        <div className="planner-instance-table-wrap">
          <div className="planner-instance-list-head">
            <span>会议</span>
            <span>排程信息</span>
          </div>
          <div className="planner-instance-preview-list">
            {planningPreviewRows.map((item) => {
              const constraintText = item.notes || aiState.preferences.rules[0] || '-'
              const constraintSummary = constraintText === '-' ? '-' : getRuleSummary(constraintText)

              return (
                <article className="planner-instance-preview-item" key={item.id}>
                  <div className="planner-instance-preview-main">
                    <strong title={item.name}>{item.name}</strong>
                    <span title={constraintText}>{constraintSummary}</span>
                  </div>
                  <div className="planner-instance-preview-meta">
                    <span>{item.date}</span>
                    <span>{item.duration}m</span>
                    <span className={getFrequencyPillClass(item.frequency)}>{FREQUENCY_LABELS[item.frequency]}</span>
                  </div>
                </article>
              )
            })}
            {planningPreviewRows.length === 0 ? (
              <div className="planner-instance-preview-empty">当前范围内暂无会议实例。</div>
            ) : null}
          </div>
        </div>
        <div className="planner-preview-bottom">
          <div className="planner-mini-calendar planner-distribution-calendar-list">
            {months.length > 0 ? (
              months.map((monthItem) => (
                <div className="planner-distribution-month" key={`${monthItem.year}-${monthItem.month}`}>
                  {renderDistributionCalendarMonth(monthItem.year, monthItem.month)}
                </div>
              ))
            ) : (
              <div className="info-note">暂无日期预览</div>
            )}
          </div>
        </div>
      </section>

      <aside className="panel planner-step-card planner-step-card-ai">
        <div className="planner-step-card-head">
          <strong>步骤 3</strong>
          <h2>AI 排程任务</h2>
          <span>AI 配置</span>
        </div>
        <div className="planner-provider-toggle">
          {PROVIDER_OPTIONS.map((providerOption) => (
            <button
              key={providerOption.value}
              type="button"
              className={currentProvider === providerOption.value ? 'planner-provider-option planner-provider-option-active' : 'planner-provider-option'}
              onClick={() => selectProvider(providerOption)}
            >
              {providerOption.label}
            </button>
          ))}
        </div>
        <label className="field">
          <span>模型</span>
          <input
            value={aiSettings.model || currentProviderOption.defaultModel}
            onChange={(event) => updateAiSettings({ model: event.target.value })}
            placeholder={currentProviderOption.defaultModel}
            list={`model-presets-${currentProvider}`}
          />
          <datalist id={`model-presets-${currentProvider}`}>
            {currentModelPresets.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </datalist>
        </label>
        <div className="planner-connection-state">
          <span className={currentProviderHasKey ? 'planner-state-dot planner-state-dot-ok' : 'planner-state-dot'} />
          {currentProviderHasKey ? '已连接' : '未配置 Key'}
        </div>
        <div className="planner-ai-actions">
          <button className="ghost-button" onClick={openConnectionSettings}>连接设置</button>
          <button className="ghost-button" onClick={() => setShowInputJsonModal(true)} disabled={!hasGeneratedPlan}>
            <Eye size={16} />
            检查 JSON
          </button>
          <button className="primary-button" onClick={submitAiJob} disabled={!canSubmitToAi || submitBusy}>
            <Bot size={16} />
            {submitBusy ? '提交中...' : '开始排程'}
          </button>
        </div>
        <div className="planner-status-inline">
          <strong>{latestBatchJob ? JOB_STATUS_LABELS[latestBatchJob.status] ?? latestBatchJob.status : '尚未提交任务'}</strong>
          <span>{latestJobPhaseHint}</span>
        </div>
        {configError ? <p className="error-text">{configError}</p> : null}
        {submitError ? <p className="error-text">{submitError}</p> : null}
        {isGeneratedPlanStale ? <div className="info-note warning-note-inline">清单已过期，请更新</div> : null}

        <div className="planner-task-section">
          <div className="planner-task-section-head">
            <strong>任务队列与历史</strong>
            <span>全部 {taskQueue.length}</span>
          </div>
          {taskQueue.length > 0 ? (
            <div className="planner-task-queue-list">
              {groupedTaskQueue.map((group) => (
                <section key={group.key} className="planner-queue-group">
                  <div className="planner-queue-group-head">
                    <div>
                      <strong>{group.title}</strong>
                      <p>{group.description}</p>
                    </div>
                    <span className="planner-queue-group-count">{group.items.length} 条</span>
                  </div>
                  <div className="planner-scheme-list planner-queue-group-list">
                    {group.items.map((job) => {
                      const timeRange = job.inputMeetings?.timeRange
                      const isCompleted = job.status === 'completed'
                      return (
                        <button
                          key={job.id}
                          type="button"
                          className="planner-scheme-chip planner-queue-item"
                          onClick={() => setSelectedSchemeId(job.id)}
                        >
                          <div className="planner-scheme-chip-head">
                            <div className="planner-scheme-chip-head-main">
                              <span className="planner-queue-item-kicker">{getQueueSourceLabel(job)}</span>
                              <strong>{formatQueueDateRange(timeRange)}</strong>
                            </div>
                            <span className={isCompleted ? 'planner-scheme-chip-state planner-scheme-chip-state-complete' : 'planner-scheme-chip-state'}>
                              {JOB_STATUS_LABELS[job.status] ?? job.status}
                              {isCompleted ? <Check size={12} /> : null}
                            </span>
                          </div>
                          <div className="planner-scheme-chip-range">
                            <span>{formatQueueTime(job.updatedAt || job.createdAt)}</span>
                            <span className="planner-scheme-chip-separator">·</span>
                            <span>{getProviderLabel(job.provider)}</span>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="info-note">暂无历史任务</div>
          )}
        </div>
      </aside>

      {hasSelectedScheme ? (
        <div className="modal-backdrop modal-open" onClick={() => setSelectedSchemeId('')}>
          <div className="modal-card modal-card-open planner-scheme-modal" onClick={(event) => event.stopPropagation()}>
            <div className="planner-scheme-modal-head">
              <div>
                <h3>AI 排程方案详情</h3>
                <p>
                  {selectedSchemeJob ? `${getProviderLabel(selectedSchemeJob.provider)} · ${selectedSchemeJob.model} · ${formatQueueTime(selectedSchemeJob.updatedAt || selectedSchemeJob.createdAt)} · ${formatQueueDateRange(selectedSchemeJob.inputMeetings?.timeRange)}` : '方案详情'}
                </p>
              </div>
              <span className="planner-scheme-chip-state planner-scheme-chip-state-complete">可导入</span>
              <button className="icon-button" onClick={() => setSelectedSchemeId('')} aria-label="关闭方案详情">
                <X size={18} />
              </button>
            </div>
            {!selectedSchemeData && selectedSchemeJob ? (
              <div className="info-note">
                当前任务为 {JOB_STATUS_LABELS[selectedSchemeJob.status] ?? selectedSchemeJob.status}，完成后可查看排程预览和未排程提示。
              </div>
            ) : null}
            <div className="planner-scheme-modal-body">
              <section className="planner-scheme-modal-panel">
                <strong>方案概览</strong>
                <div className="planner-overview-intro">
                  <strong>{selectedSchemeOverview?.completionRate ?? 0}%</strong>
                  <span>基于约束和参会人可用性，系统已生成可导入审核区的排程方案。</span>
                </div>
                <div className="planner-overview-grid planner-overview-grid-metrics">
                  <div className="planner-overview-item">
                    <span>已排会议</span>
                    <strong>{displayedResultSummary?.scheduledCount ?? '-'}</strong>
                  </div>
                  <div className="planner-overview-item">
                    <span>未排会议</span>
                    <strong>{displayedResultSummary?.unscheduledCount ?? '-'}</strong>
                  </div>
                  <div className="planner-overview-item">
                    <span>冲突风险</span>
                    <strong>{displayedResultSummary?.conflictCount ?? '-'}</strong>
                  </div>
                  <div className="planner-overview-item">
                    <span>完成率</span>
                    <strong>{selectedSchemeOverview?.completionRate ?? 0}%</strong>
                  </div>
                </div>
                <div className="planner-overview-pills">
                  {Object.entries(FREQUENCY_LABELS).map(([key, label]) => (
                    <span key={key} className={`planner-overview-pill planner-overview-pill-${key}`}>
                      {label} {selectedSchemeOverview?.frequencyCounts?.[key] ?? 0}
                    </span>
                  ))}
                </div>
                <div className="planner-scheme-timeline">
                  <span>已提交</span>
                  <span>推理完成</span>
                  <span>等待导入</span>
                </div>
              </section>
              <section className="planner-scheme-modal-panel planner-scheme-results-panel">
                <div className="planner-scheme-panel-head">
                  <strong>排程结果预览</strong>
                  <span>清单预览 + 日期分布</span>
                </div>
                {selectedSchedulePreviewRows.length > 0 ? (
                  <div className="planner-scheme-preview-stack">
                    <div className="planner-instance-table-wrap planner-scheme-instance-table-wrap">
                      <div className="planner-instance-list-head">
                        <span>会议</span>
                        <span>排程信息</span>
                      </div>
                      <div className="planner-instance-preview-list planner-scheme-instance-preview-list">
                        {selectedSchedulePreviewRows.map((item) => {
                          const reasonText = item.aiReason || item.notes || '符合当前约束。'
                          const reasonSummary = getRuleSummary(reasonText)

                          return (
                            <article className="planner-instance-preview-item" key={`${item.id}-${item.taskId}-${item.startTime}`}>
                              <div className="planner-instance-preview-main">
                                <strong title={item.name}>{item.name}</strong>
                                <span title={reasonText}>{reasonSummary}</span>
                              </div>
                              <div className="planner-instance-preview-meta">
                                <span>{item.date}</span>
                                <span>{item.startTime || '--'} - {item.endTime || '--'}</span>
                                <span>{item.duration}m</span>
                                <span className={getFrequencyPillClass(item.frequency)}>{FREQUENCY_LABELS[item.frequency] ?? '会议'}</span>
                              </div>
                            </article>
                          )
                        })}
                      </div>
                    </div>
                    <div className="planner-preview-bottom planner-scheme-preview-bottom">
                      <div className="planner-mini-calendar planner-distribution-calendar-list planner-scheme-distribution-calendar-list">
                        {selectedSchemeMonths.length > 0 ? (
                          selectedSchemeMonths.map((monthItem) => (
                            <div className="planner-distribution-month" key={`${monthItem.year}-${monthItem.month}`}>
                              {renderDistributionCalendarMonth(monthItem.year, monthItem.month, {
                                meetingsByDate: selectedScheduledMeetingsByDate,
                                maxDailyCount: maxDailySelectedScheduleCount,
                                totalCount: selectedSchedulePreviewRows.length,
                                dateRange: selectedSchemeRange,
                              })}
                            </div>
                          ))
                        ) : (
                          <div className="info-note">暂无日期预览</div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="info-note">暂无可预览的已排会议。</div>
                )}
              </section>
              <section className="planner-scheme-modal-panel">
                <strong>未排与注意事项</strong>
                {groupedUnscheduledPreviewItems.length > 0 ? (
                  <div className="planner-unscheduled-groups">
                    {groupedUnscheduledPreviewItems.map((group) => (
                      <div key={group.type} className="planner-scheme-warning-card">
                        <strong>{group.label}（{group.count}）</strong>
                        {group.items.slice(0, 2).map((item, index) => (
                          <p key={`${item.taskId}-${index}`}>{item.name || item.taskId}：{item.reason || '待人工确认'}</p>
                        ))}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="info-note">无未排程会议。</div>
                )}
                <div className="planner-ai-summary-card">
                  <strong>AI 说明摘要</strong>
                  <p>已优先满足高频会议和午间不排会等主要约束，建议导入审核区后进行人工复核。</p>
                </div>
              </section>
            </div>
            <div className="planner-scheme-modal-footer">
              <button className="ghost-button" onClick={() => setShowInputJsonModal(true)} disabled={!hasGeneratedPlan}>
                <Copy size={16} />
                查看输入 JSON
              </button>
              <button className="ghost-button" onClick={() => setShowResultJsonModal(true)} disabled={!selectedSchemeJob?.result}>
                <Eye size={16} />
                查看结果 JSON
              </button>
              <button className="ghost-button" onClick={() => copyText(JSON.stringify(selectedSchemeJob?.result ?? {}, null, 2))} disabled={!selectedSchemeJob?.result}>
                <Copy size={16} />
                复制方案摘要
              </button>
              <button className="ghost-button" onClick={() => setSelectedSchemeId('')}>关闭</button>
              <button
                className="primary-button"
                onClick={() => {
                  if (!selectedSchemeData?.job) return
                  importJobResult(selectedSchemeData.job, {
                    markImported: true,
                    importToReview: true,
                  })
                  setSelectedSchemeId('')
                }}
                disabled={!selectedSchemeData?.job}
              >
                导入审核区
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showInstancesModal ? (
        <div className="modal-backdrop modal-open" onClick={() => setShowInstancesModal(false)}>
          <div className="modal-card modal-card-open modal-wide instance-browser-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3>已生成的待排程清单</h3>
                <p className="meeting-notes">{range.start} - {range.end} · {generatedInstances.length} 条</p>
              </div>
              <button className="icon-button" onClick={() => setShowInstancesModal(false)}>
                <X size={16} />
              </button>
            </div>

            <div className="panel-actions instance-browser-toolbar">
              <button
                className={instancesView === 'calendar' ? 'primary-button' : 'ghost-button'}
                onClick={() => setInstancesView('calendar')}
              >
                <CalendarDays size={16} />
                日历
              </button>
              <button
                className={instancesView === 'list' ? 'primary-button' : 'ghost-button'}
                onClick={() => setInstancesView('list')}
              >
                <List size={16} />
                列表
              </button>
            </div>

            {instancesView === 'calendar' ? (
              <div className="instance-browser-calendar">
                {months.map((item) => renderCalendarMonth(item.year, item.month))}
              </div>
            ) : (
              <div className="schedule-list">
                {generatedInstances.map((item) => (
                  <div key={item.id} className="schedule-item">
                    <div className="schedule-item-main">
                      <div>
                        <strong>{item.name}</strong>
                        <p>
                          {item.date} · {item.duration} 分钟
                        </p>
                        {item.attendees ? <p className="preserve-lines">{item.attendees}</p> : null}
                      </div>
                    </div>
                    <div className="review-actions">
                      <span className={getFrequencyPillClass(item.frequency)}>{FREQUENCY_LABELS[item.frequency]}</span>
                      <button className="icon-button danger" onClick={() => removeGeneratedInstance(item.id)}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {showInputJsonModal ? (
        <div className="modal-backdrop modal-open" onClick={() => setShowInputJsonModal(false)}>
          <div className="modal-card modal-card-open modal-wide planner-json-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3>发送给大模型的 Prompt</h3>
                <p className="meeting-notes">
                  这里展示的是最终发送给模型的完整 Prompt，包含会议输入、约束和输出要求。
                </p>
              </div>
              <button className="icon-button" onClick={() => setShowInputJsonModal(false)}>
                <X size={18} />
              </button>
            </div>
            <pre className="code-block">{aiPrompt}</pre>
            <div className="panel-actions">
              <button className="ghost-button" onClick={() => copyText(aiPrompt)}>
                <Copy size={16} />
                复制 Prompt
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showResultJsonModal ? (
        <div className="modal-backdrop modal-open" onClick={() => setShowResultJsonModal(false)}>
          <div className="modal-card modal-card-open modal-wide planner-json-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3>任务结果 JSON</h3>
                <p className="meeting-notes">
                  这里是当前选中任务返回的结构化结果。
                </p>
              </div>
              <button className="icon-button" onClick={() => setShowResultJsonModal(false)}>
                <X size={18} />
              </button>
            </div>
            <pre className="code-block">{JSON.stringify(selectedSchemeJob?.result ?? {}, null, 2)}</pre>
            <div className="panel-actions">
              <button className="ghost-button" onClick={() => copyText(JSON.stringify(selectedSchemeJob?.result ?? {}, null, 2))} disabled={!selectedSchemeJob?.result}>
                <Copy size={16} />
                复制结果 JSON
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showConnectionModal ? (
        <div className="modal-backdrop modal-open" onClick={() => setShowConnectionModal(false)}>
          <div className="modal-card modal-card-open planner-connection-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3>连接设置</h3>
                <p className="meeting-notes">Key 与自动回填</p>
              </div>
              <button className="icon-button" onClick={() => setShowConnectionModal(false)}>
                <X size={16} />
              </button>
            </div>
            <div className="panel-grid">
              <label className="field">
                <span>{currentProviderOption.keyLabel}</span>
                <input
                  type="password"
                  value={apiKeyInput}
                  onChange={(event) => setApiKeyInput(event.target.value)}
                  placeholder={currentProviderHasKey ? '已保存，输入新值可覆盖' : currentProviderOption.keyPlaceholder}
                  disabled={!desktopAiAvailable}
                />
              </label>
              <label className="field">
                <span>自动回填结果</span>
                <select
                  value={Boolean(aiSettings.autoImportResult) ? 'yes' : 'no'}
                  onChange={(event) => updateAiSettings({ autoImportResult: event.target.value === 'yes' })}
                >
                  <option value="yes">开启</option>
                  <option value="no">关闭</option>
                </select>
              </label>
              <label className="field">
                <span>自动导入审核</span>
                <select
                  value={Boolean(aiSettings.autoImportToReview) ? 'yes' : 'no'}
                  onChange={(event) => updateAiSettings({ autoImportToReview: event.target.value === 'yes' })}
                >
                  <option value="no">关闭</option>
                  <option value="yes">开启</option>
                </select>
              </label>
            </div>
            <div className="panel-actions">
              <button className="ghost-button" onClick={saveApiKey} disabled={!desktopAiAvailable || configBusy || !apiKeyInput.trim()}>
                保存 Key
              </button>
              <button className="ghost-button" onClick={clearApiKey} disabled={!desktopAiAvailable || configBusy || !currentProviderHasKey}>
                清除 Key
              </button>
            </div>
            <div className="info-note">
              {desktopAiAvailable
                ? `${currentProviderOption.label} Key ${currentProviderHasKey ? '已保存' : '尚未保存'}，当前存储方式：${
                    configState.encryptionMode === 'safeStorage' ? '系统安全存储' : '普通文件'
                  }。`
                : '当前是纯前端环境，只有通过 Electron 桌面版启动时才可保存 API Key 并执行后台任务。'}
            </div>
            {configError ? <p className="error-text">{configError}</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
