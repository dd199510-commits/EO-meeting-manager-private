import { createElement, useEffect, useMemo, useRef, useState } from 'react'
import {
  BarChart3,
  CalendarDays,
  Copy,
  FileDown,
  Pause,
  Play,
  Plus,
  RotateCcw,
  SkipBack,
  SkipForward,
  Sparkles,
  Table2,
  TrendingUp,
  Trash2,
  Upload,
} from 'lucide-react'
import { TIME_ANALYSIS_COLUMNS } from './timeAnalysisData.js'
import { TIME_RECORD_V1_CSV } from './timeRecordV1Data.js'
import { IS_PUBLIC_EMPTY_BUILD } from '../../lib/publicBuild.js'
import {
  HOUR_BUCKETS,
  STATUS_RULES,
  WEEKDAY_OPTIONS,
  buildReportNarratives,
  buildSeriesAnalysis,
  calculateOverview,
  createBlankRecord,
  filterRecords,
  formatMinutes,
  formatNumber,
  formatPercent,
  getRecordHourBucketKey,
  getRecordWeekdayKey,
  getUniqueOptions,
  groupSummary,
  pickMeetingRowsFromSheets,
  parsePastedMeetings,
  parseSampleRecords,
  quarterTrend,
  statusSummary,
  updateRecordCell,
} from './timeAnalysisUtils.js'

const CHART_COLORS = ['#1d7afc', '#00a884', '#f5a524', '#e85d75', '#6c5ce7', '#0f766e', '#64748b']
const STORAGE_KEY = 'meeting-manager:time-analysis-records:v2'
const FILTER_STORAGE_KEY = 'meeting-manager:time-analysis-filters:v1'
const SAVED_VIEWS_STORAGE_KEY = 'meeting-manager:time-analysis-saved-views:v1'
const TRACKED_GROUPS_STORAGE_KEY = 'meeting-manager:time-analysis-tracked-groups:v4'
const DEFAULT_TRACKED_PLANNED_MINUTES = {}
const DEFAULT_TRACKED_MEETING_GROUPS = []
const DEFAULT_SIMULATION_ASSUMPTIONS = {
  shortenRate: 100,
  bufferRate: 100,
  actualLoadChange: 0,
}
const HEALTH_DIMENSION_COLORS = ['#1d7afc', '#00a884', '#f5a524', '#e85d75', '#6c5ce7']
const TREND_METRICS = [
  { key: 'count', label: '日程数量', unit: 'count', color: '#1d7afc', direction: 'lower' },
  { key: 'actualMinutes', label: '实际时长', unit: 'minutes', color: '#00a884', direction: 'lower' },
  { key: 'plannedMinutes', label: '规划时长', unit: 'minutes', color: '#f5a524', direction: 'neutral' },
  { key: 'absDiffMinutes', label: '累计偏差', unit: 'minutes', color: '#7c3aed', direction: 'lower' },
  { key: 'diffMinutes', label: '净差值', unit: 'minutes', color: '#ea580c', direction: 'lower' },
  { key: 'diffPercent', label: '差值率', unit: 'pct', color: '#e85d75', direction: 'lower' },
  { key: 'onTimeRate', label: '准时率', unit: 'pct', color: '#6c5ce7', direction: 'higher' },
  { key: 'avgAbsDiffMinutes', label: '平均偏差', unit: 'minutes', color: '#0f766e', direction: 'lower' },
]
const DEFAULT_FILTERS = {
  quarter: '',
  month: 'all',
  date: 'all',
  dateStart: '',
  dateEnd: '',
  meetingType: 'all',
  locationType: 'all',
  status: 'all',
  weekday: 'all',
  hourBucket: 'all',
  keyword: '',
}
const STRUCTURE_DIMENSIONS = [
  {
    key: 'meetingType',
    label: '会议类型',
    shortLabel: '类型',
    filterKey: 'meetingType',
    getGroup: (record) => ({ label: record.meetingType || '未分类', value: record.meetingType || '未分类' }),
  },
  {
    key: 'locationType',
    label: '地点形式',
    shortLabel: '地点',
    filterKey: 'locationType',
    getGroup: (record) => ({ label: record.locationType || '未分类', value: record.locationType || '未分类' }),
  },
  {
    key: 'status',
    label: '准时状态',
    shortLabel: '状态',
    filterKey: 'status',
    getGroup: (record) => ({ label: record.status || '未分类', value: record.status || '未分类' }),
  },
  {
    key: 'weekday',
    label: '星期分布',
    shortLabel: '星期',
    filterKey: 'weekday',
    getGroup: (record) => {
      const value = getRecordWeekdayKey(record)
      return {
        label: WEEKDAY_OPTIONS.find((item) => item.key === value)?.label || '未分类',
        value,
      }
    },
  },
  {
    key: 'hourBucket',
    label: '时段分布',
    shortLabel: '时段',
    filterKey: 'hourBucket',
    getGroup: (record) => {
      const value = getRecordHourBucketKey(record)
      return {
        label: HOUR_BUCKETS.find((item) => item.key === value)?.label || '未分类',
        value,
      }
    },
  },
]

export function TimeAnalysisWorkbench() {
  const fileInputRef = useRef(null)
  const [records, setRecords] = useState(() => readStoredRecords())
  const quarters = useMemo(() => getUniqueOptions(records, 'quarter'), [records])
  const [filters, setFilters] = useState(() => ({
    ...DEFAULT_FILTERS,
    ...readStoredFilters(),
    quarter: readStoredFilters().quarter || quarters.at(-1) || 'all',
  }))
  const [selectedSeries, setSelectedSeries] = useState('')
  const [importNotice, setImportNotice] = useState('')
  const [copyNotice, setCopyNotice] = useState('')
  const [sharePreview, setSharePreview] = useState('')
  const [lastDataSnapshot, setLastDataSnapshot] = useState(null)
  const [savedViews, setSavedViews] = useState(() => readStoredSavedViews())
  const [qualityFilter, setQualityFilter] = useState('all')
  const [compareDimension, setCompareDimension] = useState('meetingType')
  const [benchmarkQuarter, setBenchmarkQuarter] = useState('previous')
  const [trendMetricKey, setTrendMetricKey] = useState('actualMinutes')
  const [overviewTrendMode, setOverviewTrendMode] = useState('quarter')
  const [tableSort, setTableSort] = useState({ key: 'date', direction: 'asc' })
  const [isQuarterPlayback, setIsQuarterPlayback] = useState(false)
  const [activeReportStepKey, setActiveReportStepKey] = useState('overview')
  const [isReportPlayback, setIsReportPlayback] = useState(false)
  const [simulationAssumptions, setSimulationAssumptions] = useState(DEFAULT_SIMULATION_ASSUMPTIONS)
  const [visibleTrendMetrics, setVisibleTrendMetrics] = useState({
    count: true,
    actualMinutes: true,
    plannedMinutes: false,
    absDiffMinutes: false,
    diffMinutes: false,
    diffPercent: false,
    onTimeRate: false,
    avgAbsDiffMinutes: false,
  })
  const [trackedGroups, setTrackedGroups] = useState(() => readStoredTrackedGroups())
  const [newTrackedGroupName, setNewTrackedGroupName] = useState('')
  const [newTrackedGroupKeywords, setNewTrackedGroupKeywords] = useState('')
  const [detailModal, setDetailModal] = useState(null)
  const [dateDraft, setDateDraft] = useState(() => ({
    dateStart: filters.dateStart || '',
    dateEnd: filters.dateEnd || '',
  }))
  const isCustomDateRange = filters.quarter === 'custom'
  const isDateRangeInvalid = Boolean(dateDraft.dateStart && dateDraft.dateEnd && dateDraft.dateStart > dateDraft.dateEnd)
  const activeQuarterFilter = isCustomDateRange || filters.quarter === 'all' || quarters.includes(filters.quarter)
    ? filters.quarter
    : quarters.at(-1) || 'all'
  const effectiveFilters = useMemo(
    () => ({
      ...filters,
      quarter: isCustomDateRange ? 'all' : activeQuarterFilter,
      dateStart: isCustomDateRange ? filters.dateStart : '',
      dateEnd: isCustomDateRange ? filters.dateEnd : '',
    }),
    [activeQuarterFilter, filters, isCustomDateRange],
  )
  const monthBaseFilters = useMemo(
    () => ({ ...effectiveFilters, month: 'all' }),
    [effectiveFilters],
  )
  const calendarBaseFilters = useMemo(
    () => ({ ...effectiveFilters, date: 'all' }),
    [effectiveFilters],
  )
  const rhythmBaseFilters = useMemo(
    () => ({ ...effectiveFilters, weekday: 'all', hourBucket: 'all' }),
    [effectiveFilters],
  )
  const selectedQuarter = activeQuarterFilter === 'all' || activeQuarterFilter === 'custom' ? quarters.at(-1) : activeQuarterFilter
  const filteredRecords = useMemo(() => filterRecords(records, effectiveFilters), [records, effectiveFilters])
  const filterScopeRecords = useMemo(
    () => filterRecords(records, {
      ...DEFAULT_FILTERS,
      quarter: isCustomDateRange ? 'all' : activeQuarterFilter,
      dateStart: isCustomDateRange ? filters.dateStart : '',
      dateEnd: isCustomDateRange ? filters.dateEnd : '',
    }),
    [activeQuarterFilter, filters.dateEnd, filters.dateStart, isCustomDateRange, records],
  )
  const monthlySourceRecords = useMemo(() => filterRecords(records, monthBaseFilters), [monthBaseFilters, records])
  const calendarSourceRecords = useMemo(() => filterRecords(records, calendarBaseFilters), [calendarBaseFilters, records])
  const rhythmSourceRecords = useMemo(() => filterRecords(records, rhythmBaseFilters), [records, rhythmBaseFilters])
  const quarterRecords = useMemo(
    () => records.filter((record) => record.quarter === selectedQuarter),
    [records, selectedQuarter],
  )
  const overview = useMemo(() => calculateOverview(filteredRecords), [filteredRecords])
  const trend = useMemo(() => quarterTrend(records), [records])
  const monthTrend = useMemo(() => buildMonthTrend(records), [records])
  const selectedTrendMonth = useMemo(() => getSelectedTrendMonth(filters, monthTrend), [filters, monthTrend])
  const activeTrendMetric = TREND_METRICS.find((metric) => metric.key === trendMetricKey) || TREND_METRICS[1]
  const selectedTrendPoint = trend.find((item) => item.quarter === selectedQuarter) || trend.at(-1) || null
  const selectedQuarterIndex = Math.max(0, trend.findIndex((item) => item.quarter === selectedQuarter))
  const typeSummary = useMemo(() => groupSummary(filteredRecords, 'meetingType'), [filteredRecords])
  const locationSummary = useMemo(() => groupSummary(filteredRecords, 'locationType'), [filteredRecords])
  const statusItems = useMemo(() => statusSummary(filteredRecords), [filteredRecords])
  const seriesAnalysis = useMemo(() => buildSeriesAnalysis(filteredRecords), [filteredRecords])
  const trackedMeetingReports = useMemo(
    () => buildTrackedMeetingReports(filteredRecords, trackedGroups),
    [filteredRecords, trackedGroups],
  )
  const scheduleActions = useMemo(() => buildScheduleActions(seriesAnalysis), [seriesAnalysis])
  const scheduleImpact = useMemo(() => buildScheduleImpact(scheduleActions), [scheduleActions])
  const scheduleSimulation = useMemo(
    () => buildScheduleSimulation(overview, scheduleImpact, simulationAssumptions),
    [overview, scheduleImpact, simulationAssumptions],
  )
  const rhythmInsights = useMemo(() => buildRhythmInsights(rhythmSourceRecords), [rhythmSourceRecords])
  const healthScore = useMemo(
    () => buildHealthScore({
      overview,
      seriesAnalysis,
      rhythmInsights,
      scheduleSimulation,
    }),
    [overview, rhythmInsights, scheduleSimulation, seriesAnalysis],
  )
  const narratives = useMemo(
    () => buildReportNarratives(records, selectedQuarter),
    [records, selectedQuarter],
  )
  const topHeavy = [...seriesAnalysis].sort((left, right) => right.actualMinutes - left.actualMinutes).slice(0, 6)
  const topOver = [...seriesAnalysis].sort((left, right) => right.avgDiff - left.avgDiff).slice(0, 6)
  const topUnstable = [...seriesAnalysis].sort((left, right) => right.cv - left.cv).slice(0, 6)
  const benchmarkOptions = useMemo(() => getBenchmarkQuarterOptions(trend, selectedQuarter), [trend, selectedQuarter])
  const activeBenchmarkQuarter = benchmarkQuarter === 'previous' || benchmarkOptions.includes(benchmarkQuarter)
    ? benchmarkQuarter
    : 'previous'
  const resolvedBenchmarkQuarter = activeBenchmarkQuarter === 'previous'
    ? benchmarkOptions.at(-1) || ''
    : activeBenchmarkQuarter
  const sameQuarterBenchmark = useMemo(
    () => getSameQuarterLastYear(selectedQuarter, benchmarkOptions),
    [benchmarkOptions, selectedQuarter],
  )
  const comparisonRows = useMemo(
    () => buildComparisonRows(trend, selectedQuarter, resolvedBenchmarkQuarter),
    [resolvedBenchmarkQuarter, selectedQuarter, trend],
  )
  const quarterSummary = useMemo(
    () => buildQuarterSummary(trend, selectedQuarter, resolvedBenchmarkQuarter),
    [resolvedBenchmarkQuarter, selectedQuarter, trend],
  )
  const trendMetricInsights = useMemo(
    () => buildTrendMetricInsights(trend, selectedQuarter, resolvedBenchmarkQuarter, activeTrendMetric),
    [activeTrendMetric, resolvedBenchmarkQuarter, selectedQuarter, trend],
  )
  const monthlyBreakdown = useMemo(() => buildMonthlyBreakdown(monthlySourceRecords), [monthlySourceRecords])
  const quarterCalendar = useMemo(
    () => buildQuarterCalendar(calendarSourceRecords, selectedQuarter),
    [calendarSourceRecords, selectedQuarter],
  )
  const selectedSeriesAnalysis = selectedSeries
    ? seriesAnalysis.find((item) => item.label === selectedSeries)
    : null
  const selectedSeriesRecords = selectedSeries
    ? filteredRecords.filter((record) => record.seriesName === selectedSeries)
    : []
  const tableRecords = filteredRecords
  const dataQuality = useMemo(() => analyzeDataQuality(tableRecords), [tableRecords])
  const qualityFilteredTableRecords = useMemo(
    () => (qualityFilter === 'all'
      ? tableRecords
      : tableRecords.filter((record) => dataQuality.issuesById[record.id]?.some((issue) => issue.type === qualityFilter))),
    [dataQuality.issuesById, qualityFilter, tableRecords],
  )
  const visibleTableRecords = useMemo(
    () => sortMeetingRecords(qualityFilteredTableRecords, tableSort),
    [qualityFilteredTableRecords, tableSort],
  )
  const previousQuarterRecords = useMemo(
    () => records.filter((record) => record.quarter === quarterSummary.previousQuarter),
    [quarterSummary.previousQuarter, records],
  )
  const structureDeltas = useMemo(
    () => buildStructureDeltas(quarterRecords, previousQuarterRecords, compareDimension),
    [compareDimension, previousQuarterRecords, quarterRecords],
  )
  const briefingCards = useMemo(
    () => buildBriefingCards({
      overview,
      healthScore,
      quarterSummary,
      monthlyBreakdown,
      rhythmInsights,
      structureDeltas,
      compareDimension,
      scheduleSimulation,
    }),
    [compareDimension, healthScore, monthlyBreakdown, overview, quarterSummary, rhythmInsights, scheduleSimulation, structureDeltas],
  )
  const activeFilterItems = useMemo(
    () => buildActiveFilterItems({
      filters,
      activeQuarterFilter,
      selectedQuarter,
      qualityFilter,
    }),
    [activeQuarterFilter, filters, qualityFilter, selectedQuarter],
  )
  const sliceReview = useMemo(
    () => buildSliceReview(filteredRecords, filterScopeRecords, activeFilterItems),
    [activeFilterItems, filterScopeRecords, filteredRecords],
  )
  const quickSlices = useMemo(
    () => buildQuickSlices(filterScopeRecords),
    [filterScopeRecords],
  )
  const savedViewReports = useMemo(
    () => buildSavedViewReports(savedViews, records),
    [records, savedViews],
  )
  const reportOutline = useMemo(
    () => buildReportOutline({
      selectedQuarter,
      overview,
      healthScore,
      briefingCards,
      quarterSummary,
      rhythmInsights,
      savedViewReports,
      scheduleSimulation,
      dataQuality,
    }),
    [briefingCards, dataQuality, healthScore, overview, quarterSummary, rhythmInsights, savedViewReports, scheduleSimulation, selectedQuarter],
  )
  const reportReadiness = useMemo(
    () => buildReportReadiness({
      overview,
      quarterSummary,
      dataQuality,
      savedViewReports,
      structureDeltas,
      reportOutline,
    }),
    [dataQuality, overview, quarterSummary, reportOutline, savedViewReports, structureDeltas],
  )

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0 })
  }, [])

  useEffect(() => {
    persistJson(STORAGE_KEY, records)
  }, [records])

  useEffect(() => {
    persistJson(FILTER_STORAGE_KEY, filters)
  }, [filters])

  useEffect(() => {
    persistJson(SAVED_VIEWS_STORAGE_KEY, savedViews)
  }, [savedViews])

  useEffect(() => {
    persistJson(TRACKED_GROUPS_STORAGE_KEY, trackedGroups)
  }, [trackedGroups])

  useEffect(() => {
    if (!isQuarterPlayback || quarters.length <= 1) return undefined
    const timer = window.setInterval(() => {
      setFilters((current) => {
        const activeQuarter = quarters.includes(current.quarter) ? current.quarter : quarters.at(-1)
        const currentIndex = Math.max(0, quarters.indexOf(activeQuarter))
        const nextIndex = (currentIndex + 1) % quarters.length
        return { ...current, quarter: quarters[nextIndex] }
      })
      setSelectedSeries('')
    }, 1400)
    return () => window.clearInterval(timer)
  }, [isQuarterPlayback, quarters])

  useEffect(() => {
    if (!isReportPlayback || reportOutline.length <= 1) return undefined
    const timer = window.setInterval(() => {
      setActiveReportStepKey((current) => {
        const currentIndex = Math.max(0, reportOutline.findIndex((item) => item.key === current))
        return reportOutline[(currentIndex + 1) % reportOutline.length].key
      })
    }, 2200)
    return () => window.clearInterval(timer)
  }, [isReportPlayback, reportOutline])

  function patchFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }))
    if (key !== 'keyword') setSelectedSeries('')
  }

  function stepReportOutline(offset) {
    if (reportOutline.length === 0) return
    setIsReportPlayback(false)
    const currentIndex = Math.max(0, reportOutline.findIndex((item) => item.key === activeReportStepKey))
    const nextIndex = (currentIndex + offset + reportOutline.length) % reportOutline.length
    setActiveReportStepKey(reportOutline[nextIndex].key)
  }

  function selectReportStep(key) {
    setIsReportPlayback(false)
    setActiveReportStepKey(key)
  }

  function applyQuickSlice(slice) {
    setFilters((current) => ({
      ...current,
      month: 'all',
      date: 'all',
      meetingType: 'all',
      locationType: 'all',
      status: 'all',
      weekday: 'all',
      hourBucket: 'all',
      keyword: '',
      ...slice.filters,
      quarter: activeQuarterFilter || current.quarter,
    }))
    setQualityFilter('all')
    setSelectedSeries('')
  }

  function saveCurrentView() {
    if (!sliceReview.visible) {
      showCopyNotice('当前为季度全量视角，先选择一个切片后再保存')
      return
    }
    const view = {
      id: `view-${Date.now()}`,
      title: sliceReview.title || `${selectedQuarter || '全部季度'} 视角`,
      filters: { ...effectiveFilters },
      qualityFilter,
      createdAt: new Date().toISOString(),
      summary: `${sliceReview.overview.count} 条 / ${formatMinutes(sliceReview.overview.actualMinutes)} / 准时率 ${formatPercent(sliceReview.overview.onTimeRate)}`,
    }
    setSavedViews((current) => [view, ...current.filter((item) => item.title !== view.title)].slice(0, 8))
    showCopyNotice('已保存当前分析视角')
  }

  function applySavedView(view) {
    setFilters((current) => ({
      ...current,
      ...DEFAULT_FILTERS,
      ...view.filters,
      quarter: view.filters.quarter || selectedQuarter || current.quarter,
    }))
    setQualityFilter(view.qualityFilter || 'all')
    setSelectedSeries('')
  }

  function deleteSavedView(viewId) {
    setSavedViews((current) => current.filter((item) => item.id !== viewId))
  }

  function stepQuarter(offset) {
    if (quarters.length === 0) return
    const currentIndex = quarters.indexOf(selectedQuarter)
    const safeIndex = currentIndex >= 0 ? currentIndex : quarters.length - 1
    const nextIndex = (safeIndex + offset + quarters.length) % quarters.length
    patchFilter('quarter', quarters[nextIndex])
  }

  async function handleCopyCleanData() {
    const copied = await copyTextToClipboard(serializeRecords(records))
    showCopyNotice(copied ? '已复制标准表，可直接粘贴回 Excel 或表格工具' : '复制失败，可尝试下载 TSV')
  }

  async function handleExportReport() {
    const report = buildShareSummary({
      selectedQuarter,
      overview,
      healthScore,
      briefingCards,
      quarterSummary,
      dataQuality,
      rhythmInsights,
      scheduleSimulation,
    })
    const copied = await copyTextToClipboard(report)
    setSharePreview(copied ? '' : report)
    showCopyNotice(copied ? '已复制复盘摘要，包含健康雷达、汇报叙事和下季度模拟' : '复制失败，已在下方展开摘要文本')
  }

  async function handleCopyReportOutline() {
    const outline = buildReportOutlineMarkdown(reportOutline)
    const copied = await copyTextToClipboard(outline)
    setSharePreview(copied ? '' : outline)
    showCopyNotice(copied ? '已复制汇报大纲，可直接粘贴到报告或PPT备注' : '复制失败，已在下方展开汇报大纲')
  }

  function showCopyNotice(message) {
    setCopyNotice(message)
    window.setTimeout(() => setCopyNotice(''), 2400)
  }

  async function copyTextToClipboard(text) {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text)
        return true
      } catch {
        // Fall back for local browsers that block async clipboard access.
      }
    }

    try {
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.setAttribute('readonly', '')
      textarea.style.position = 'fixed'
      textarea.style.left = '-9999px'
      textarea.style.top = '0'
      document.body.appendChild(textarea)
      textarea.select()
      const copied = document.execCommand('copy')
      document.body.removeChild(textarea)
      return copied
    } catch {
      return false
    }
  }

  function handleDownloadCleanData() {
    downloadText(`meeting-time-analysis-${selectedQuarter || 'all'}.tsv`, serializeRecords(records))
  }

  async function handleDownloadExcel() {
    const XLSX = await import('xlsx')
    const workbook = XLSX.utils.book_new()
    const rows = serializeRecords(records).split('\n').map((line) => line.split('\t'))
    const worksheet = XLSX.utils.aoa_to_sheet(rows)
    XLSX.utils.book_append_sheet(workbook, worksheet, '会议时间分析明细')
    XLSX.writeFile(workbook, `meeting-time-analysis-${selectedQuarter || 'all'}.xlsx`)
  }

  function handleDownloadReport() {
    const report = buildMarkdownReport({
      selectedQuarter,
      overview,
      narratives,
      healthScore,
      comparisonRows,
      typeSummary,
      locationSummary,
      statusItems,
      seriesAnalysis,
      dataQuality,
      quarterSummary,
      structureDeltas,
      compareDimension,
      monthlyBreakdown,
      rhythmInsights,
      scheduleActions,
      scheduleImpact,
      scheduleSimulation,
      briefingCards,
      savedViewReports,
    })
    downloadText(`meeting-time-report-${selectedQuarter || 'all'}.md`, report)
  }

  function updateSimulationAssumption(key, value) {
    setSimulationAssumptions((current) => ({
      ...current,
      [key]: normalizeSimulationAssumption(key, value),
    }))
  }

  async function handleFileImport(event) {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      if (/\.xlsx?$/i.test(file.name)) {
        const { records: importedRecords, sheetName } = await parseWorkbookFile(file)
        if (importedRecords.length > 0) {
          applyImportedRecords(importedRecords, `已导入 ${file.name} / ${sheetName}：${importedRecords.length} 条`, '导入文件')
        } else {
          setImportNotice('没有在工作簿中识别到会议明细表')
        }
      } else {
        const text = await file.text()
        const nextRecords = parsePastedMeetings(text)
        if (nextRecords.length > 0) {
          applyImportedRecords(nextRecords, `已导入 ${file.name}：${nextRecords.length} 条`, '导入文件')
        } else {
          setImportNotice('没有识别到可导入的会议明细')
        }
      }
    } catch (error) {
      setImportNotice(`导入失败：${error.message}`)
    }
    event.target.value = ''
  }

  function rememberDataSnapshot(reason) {
    setLastDataSnapshot({
      records,
      filters,
      qualityFilter,
      selectedSeries,
      reason,
      createdAt: new Date().toISOString(),
    })
  }

  function restoreDataSnapshot() {
    if (!lastDataSnapshot) return
    setRecords(lastDataSnapshot.records)
    setFilters(lastDataSnapshot.filters)
    setSelectedSeries(lastDataSnapshot.selectedSeries)
    setQualityFilter(lastDataSnapshot.qualityFilter)
    setImportNotice(`已撤销${lastDataSnapshot.reason}，恢复到操作前的 ${lastDataSnapshot.records.length} 条记录`)
    setLastDataSnapshot(null)
  }

  function applyImportedRecords(nextRecords, notice, snapshotReason = '导入数据') {
    rememberDataSnapshot(snapshotReason)
    setRecords(nextRecords)
    setFilters((current) => ({
      ...current,
      quarter: getUniqueOptions(nextRecords, 'quarter').at(-1) || 'all',
      month: 'all',
      meetingType: 'all',
      locationType: 'all',
      status: 'all',
      weekday: 'all',
      hourBucket: 'all',
      keyword: '',
    }))
    setSelectedSeries('')
    setQualityFilter('all')
    setImportNotice(notice)
  }

  function handleSelectSeries(label) {
    setSelectedSeries((current) => (current === label ? '' : label))
    setFilters((current) => ({
      ...current,
      keyword: current.keyword === label ? '' : label,
      status: 'all',
    }))
  }

  function handleBriefingSelect(card) {
    if (!card.filter) return
    patchFilter(card.filter.key, filters[card.filter.key] === card.filter.value ? 'all' : card.filter.value)
  }

  function handleHealthSelect(dimension) {
    if (!dimension.filter) return
    patchFilter(dimension.filter.key, filters[dimension.filter.key] === dimension.filter.value ? 'all' : dimension.filter.value)
  }

  function handleReportReadinessAction(item) {
    if (item.key === 'quality') {
      const firstIssue = dataQuality.items.find((qualityItem) => qualityItem.count > 0)
      if (firstIssue) setQualityFilter(firstIssue.type)
      setActiveReportStepKey('quality')
      return
    }
    if (item.key === 'compare') {
      setActiveReportStepKey('compare')
      if (benchmarkOptions.length > 0) setBenchmarkQuarter('previous')
      return
    }
    if (item.key === 'focus') {
      setActiveReportStepKey('focus')
      if (sliceReview.visible) saveCurrentView()
      else showCopyNotice('先选择一个切片，再保存为报告专题')
      return
    }
    if (item.outlineKey) {
      setActiveReportStepKey(item.outlineKey)
    }
  }

  function toggleTableSort(key) {
    setTableSort((current) => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    }))
  }

  function toggleTrendMetric(key) {
    setVisibleTrendMetrics((current) => {
      const enabledCount = Object.values(current).filter(Boolean).length
      if (current[key] && enabledCount <= 1) return current
      return { ...current, [key]: !current[key] }
    })
  }

  function selectTrendQuarter(quarter) {
    setDateDraft({ dateStart: '', dateEnd: '' })
    setFilters((current) => ({
      ...current,
      quarter,
      month: 'all',
      date: 'all',
      dateStart: '',
      dateEnd: '',
    }))
    setSelectedSeries('')
  }

  function selectTrendMonth(month) {
    const dateStart = `${month}-01`
    const dateEnd = getMonthEndDate(month)
    setDateDraft({ dateStart, dateEnd })
    setFilters((current) => ({
      ...current,
      quarter: 'custom',
      month: 'all',
      date: 'all',
      dateStart,
      dateEnd,
    }))
    setSelectedSeries('')
  }

  function getCurrentTimeWindowLabel() {
    if (isCustomDateRange) {
      const start = filters.dateStart || '不限开始'
      const end = filters.dateEnd || '不限结束'
      return `${start} 至 ${end}`
    }
    if (activeQuarterFilter === 'all') return '全部季度'
    return activeQuarterFilter || selectedQuarter || '当前时间窗口'
  }

  function openRecordDetail(title, matchedRecords, sourceLabel) {
    const sortedRecords = sortMeetingRecords(matchedRecords, { key: 'date', direction: 'asc' })
    setDetailModal({
      title,
      sourceLabel,
      windowLabel: getCurrentTimeWindowLabel(),
      records: sortedRecords,
      overview: calculateOverview(sortedRecords),
    })
  }

  function openTypeDetail(label) {
    openRecordDetail(
      `会议类型：${label}`,
      filterScopeRecords.filter((record) => record.meetingType === label),
      '日程数量 / 日程时长视角',
    )
  }

  function openLocationDetail(label) {
    openRecordDetail(
      `地点形式：${label}`,
      filterScopeRecords.filter((record) => record.locationType === label),
      '地点形式',
    )
  }

  function openTrackedMeetingDetail(label) {
    openRecordDetail(
      `重点会议：${label}`,
      filterScopeRecords.filter((record) => matchesTrackedTerm(record, label)),
      '重点会议',
    )
  }

  function addTrackedGroup() {
    const label = newTrackedGroupName.trim()
    const terms = splitTerms(newTrackedGroupKeywords)
    if (!label || terms.length === 0) {
      showCopyNotice('请输入分类名称和用于匹配会议名称的关键词')
      return
    }
    setTrackedGroups((current) => [
      ...current,
      {
        id: `tracked-${Date.now()}`,
        label,
        terms,
        matchMode: 'any',
      },
    ])
    setNewTrackedGroupName('')
    setNewTrackedGroupKeywords('')
  }

  function updateTrackedGroupLabel(id, label) {
    setTrackedGroups((current) => current.map((group) => (
      group.id === id ? { ...group, label } : group
    )))
  }

  function addTrackedGroupTerms(id, value) {
    const terms = splitTerms(value)
    if (terms.length === 0) {
      showCopyNotice('请输入要加入这个大类的会议名称')
      return
    }
    setTrackedGroups((current) => current.map((group) => {
      if (group.id !== id) return group
      const existingTerms = Array.isArray(group.terms) ? group.terms : []
      const nextTerms = [...existingTerms]
      terms.forEach((term) => {
        if (!nextTerms.some((item) => item.toLowerCase() === term.toLowerCase())) nextTerms.push(term)
      })
      const excludeTerms = (group.excludeTerms || []).filter(
        (term) => !terms.some((item) => item.toLowerCase() === String(term).toLowerCase()),
      )
      return { ...group, terms: nextTerms, excludeTerms }
    }))
  }

  function removeTrackedGroupTerm(id, term) {
    setTrackedGroups((current) => current.map((group) => (
      group.id === id
        ? { ...group, terms: (group.terms || []).filter((item) => item !== term) }
        : group
    )))
  }

  function removeTrackedGroupItem(id, label) {
    if (!label || label === '暂无明细') return
    setTrackedGroups((current) => current.map((group) => {
      if (group.id !== id) return group
      const terms = Array.isArray(group.terms) ? group.terms : []
      const exactTermExists = terms.some((term) => term === label)
      if (exactTermExists) {
        return { ...group, terms: terms.filter((term) => term !== label) }
      }
      const excludeTerms = Array.isArray(group.excludeTerms) ? group.excludeTerms : []
      return excludeTerms.includes(label) ? group : { ...group, excludeTerms: [...excludeTerms, label] }
    }))
  }

  function restoreTrackedGroupItem(id, term) {
    setTrackedGroups((current) => current.map((group) => (
      group.id === id
        ? { ...group, excludeTerms: (group.excludeTerms || []).filter((item) => item !== term) }
        : group
    )))
  }

  function removeTrackedGroup(id) {
    setTrackedGroups((current) => current.filter((group) => group.id !== id || group.locked))
  }

  return (
    <section className="time-analysis-workbench">
      <div className="time-analysis-overview-group">
        <div className="time-analysis-hero">
          <div className="time-analysis-hero-main">
            <span>会议时间分析实验台</span>
            <div className="time-analysis-filter-row">
              <SelectControl
                label="季度"
                value={activeQuarterFilter}
                onChange={(value) => {
                  if (value === 'custom') {
                    setDateDraft({ dateStart: filters.dateStart || '', dateEnd: filters.dateEnd || '' })
                  } else {
                    setDateDraft({ dateStart: '', dateEnd: '' })
                  }
                  setFilters((current) => ({ ...current, quarter: value, date: 'all', dateStart: '', dateEnd: '' }))
                  setSelectedSeries('')
                }}
              >
                <option value="all">全部季度</option>
                <option value="custom">自定义日期</option>
                {quarters.map((quarter) => (
                  <option value={quarter} key={quarter}>{quarter}</option>
                ))}
              </SelectControl>
              <label className="time-analysis-date-field">
                <span>开始</span>
                <input
                  type="date"
                  value={dateDraft.dateStart || ''}
                  disabled={!isCustomDateRange}
                  onChange={(event) => setDateDraft((current) => ({ ...current, dateStart: event.target.value }))}
                />
              </label>
              <label className="time-analysis-date-field">
                <span>结束</span>
                <input
                  type="date"
                  value={dateDraft.dateEnd || ''}
                  disabled={!isCustomDateRange}
                  onChange={(event) => setDateDraft((current) => ({ ...current, dateEnd: event.target.value }))}
                />
              </label>
              <button
                className="time-analysis-range-reset"
                type="button"
                onClick={() => {
                  setFilters((current) => ({
                    ...current,
                    quarter: 'custom',
                    dateStart: dateDraft.dateStart,
                    dateEnd: dateDraft.dateEnd,
                    date: 'all',
                  }))
                  setSelectedSeries('')
                }}
                disabled={!isCustomDateRange || isDateRangeInvalid}
                title={isDateRangeInvalid ? '结束日期不能早于开始日期' : '确认自定义日期范围'}
              >
                确认
              </button>
            </div>
          </div>
          <div className="time-analysis-hero-side">
            <input
              ref={fileInputRef}
              className="time-analysis-file-input"
              type="file"
              accept=".xlsx,.xls,.csv,.tsv,.txt"
              onChange={handleFileImport}
            />
            <button className="ghost-button" type="button" onClick={() => fileInputRef.current?.click()}>
              <Upload size={15} />
              导入表格
            </button>
            <button className="ghost-button" type="button" onClick={handleCopyCleanData}>
              <Copy size={15} />
              复制标准表
            </button>
            <button className="ghost-button" type="button" onClick={handleDownloadCleanData}>
              <FileDown size={15} />
              下载TSV
            </button>
            <button className="ghost-button" type="button" onClick={handleDownloadExcel}>
              <FileDown size={15} />
              下载Excel
            </button>
            <button className="primary-button" type="button" onClick={handleExportReport}>
              <FileDown size={15} />
              复制报告摘要
            </button>
          </div>
        </div>

        <ExcelOverviewSummary
          selectedQuarter={selectedQuarter}
          overview={overview}
          statusItems={statusItems}
          onSelectStatus={(label) => patchFilter('status', filters.status === label ? 'all' : label)}
        />
        <OverviewTrendSection
          mode={overviewTrendMode}
          onModeChange={setOverviewTrendMode}
          trend={trend}
          monthTrend={monthTrend}
          selectedQuarter={selectedQuarter}
          selectedMonth={selectedTrendMonth}
          visibleTrendMetrics={visibleTrendMetrics}
          onToggleTrendMetric={toggleTrendMetric}
          activeBenchmarkQuarter={activeBenchmarkQuarter}
          benchmarkOptions={benchmarkOptions}
          resolvedBenchmarkQuarter={resolvedBenchmarkQuarter}
          sameQuarterBenchmark={sameQuarterBenchmark}
          comparisonRows={comparisonRows}
          onSelectQuarter={selectTrendQuarter}
          onSelectMonth={selectTrendMonth}
          onSelectBenchmark={setBenchmarkQuarter}
        />
      </div>

      {copyNotice ? <p className="time-analysis-copy-notice">{copyNotice}</p> : null}
      {sharePreview ? (
        <div className="time-analysis-share-preview">
          <div>
            <strong>复盘摘要预览</strong>
            <button className="ghost-button" type="button" onClick={() => setSharePreview('')}>收起</button>
          </div>
          <textarea readOnly value={sharePreview} rows={10} />
        </div>
      ) : null}

      <ExcelStyleDashboard
        overview={overview}
        typeSummary={typeSummary}
        locationSummary={locationSummary}
        trackedMeetingReports={trackedMeetingReports}
        trackedGroups={trackedGroups}
        newGroupName={newTrackedGroupName}
        newGroupKeywords={newTrackedGroupKeywords}
        onNewGroupNameChange={setNewTrackedGroupName}
        onNewGroupKeywordsChange={setNewTrackedGroupKeywords}
        onAddTrackedGroup={addTrackedGroup}
        onUpdateTrackedGroupLabel={updateTrackedGroupLabel}
        onAddTrackedGroupTerms={addTrackedGroupTerms}
        onRemoveTrackedGroupTerm={removeTrackedGroupTerm}
        onRemoveTrackedGroupItem={removeTrackedGroupItem}
        onRestoreTrackedGroupItem={restoreTrackedGroupItem}
        onRemoveTrackedGroup={removeTrackedGroup}
        onSelectType={openTypeDetail}
        onSelectLocation={openLocationDetail}
        onSelectTrackedMeeting={openTrackedMeetingDetail}
      />

      {detailModal ? (
        <RecordDetailModal detail={detailModal} onClose={() => setDetailModal(null)} />
      ) : null}

      <div className="time-analysis-panel time-analysis-input-panel">
        <PanelHead icon={Table2} title="会议明细" meta={`${visibleTableRecords.length}/${tableRecords.length} 条`} />
        {(importNotice || lastDataSnapshot) ? (
          <div className="time-analysis-import-feedback">
            {importNotice ? <p className="time-analysis-import-notice">{importNotice}</p> : null}
            {lastDataSnapshot ? (
              <button className="ghost-button" type="button" onClick={restoreDataSnapshot}>
                <RotateCcw size={15} />
                撤销{lastDataSnapshot.reason}
              </button>
            ) : null}
          </div>
        ) : null}
        <DataQualityPanel
          quality={dataQuality}
          activeType={qualityFilter}
          onSelectType={(type) => setQualityFilter((current) => (current === type ? 'all' : type))}
        />
        <EditableGrid
          records={visibleTableRecords}
          quality={dataQuality}
          sort={tableSort}
          onSort={toggleTableSort}
          onCellChange={(rowId, key, value) => setRecords((current) => updateRecordCell(current, rowId, key, value))}
          onAddRow={() => {
            setRecords((current) => [...current, createBlankRecord(current.length, {
              date: filters.month === 'all' ? getDefaultDateForQuarter(activeQuarterFilter) : `${filters.month}-01`,
              meetingType: filters.meetingType === 'all' ? undefined : filters.meetingType,
              locationType: filters.locationType === 'all' ? undefined : filters.locationType,
            })])
            setFilters((current) => ({ ...current, keyword: '' }))
            setQualityFilter('all')
          }}
          onDeleteRow={(rowId) => {
            setRecords((current) => current.filter((record) => record.id !== rowId))
            setQualityFilter('all')
          }}
        />
      </div>

      <details className="time-analysis-advanced-section">
        <summary>
          <span>更多分析</span>
        </summary>
        <div className="time-analysis-advanced-content">
          <QuickSlicesPanel slices={quickSlices} onSelect={applyQuickSlice} />

          <SavedViewsPanel
            viewReports={savedViewReports}
            canSave={sliceReview.visible}
            onSave={saveCurrentView}
            onApply={applySavedView}
            onDelete={deleteSavedView}
          />

          <SliceReviewPanel review={sliceReview} />

          <HealthScorePanel health={healthScore} onSelect={handleHealthSelect} />

          <div className="time-analysis-main-grid">
        <div className="time-analysis-panel time-analysis-story-panel">
          <PanelHead icon={Sparkles} title="季度结论" meta={selectedQuarter || '全部'} />
          <div className="time-analysis-narratives">
            {narratives.map((item) => (
              <p key={item}>{item}</p>
            ))}
          </div>
          <div className="time-analysis-status-grid">
            {statusItems.map((item) => (
              <button
                className={`time-analysis-status-card time-analysis-status-${item.tone}`}
                key={item.key}
                type="button"
                onClick={() => patchFilter('status', filters.status === item.label ? 'all' : item.label)}
              >
                <span>{item.label}</span>
                <strong>{item.count}</strong>
                <em>{formatPercent(item.percent)}</em>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="time-analysis-chart-grid">
        <div className="time-analysis-panel">
          <PanelHead icon={TrendingUp} title="季度趋势" />
          <TrendMetricTabs
            metrics={TREND_METRICS}
            activeKey={activeTrendMetric.key}
            currentPoint={selectedTrendPoint}
            onSelect={setTrendMetricKey}
          />
          <QuarterPlaybackControls
            isPlaying={isQuarterPlayback}
            currentIndex={selectedQuarterIndex}
            total={trend.length}
            selectedQuarter={selectedQuarter}
            onPrevious={() => stepQuarter(-1)}
            onNext={() => stepQuarter(1)}
            onToggle={() => setIsQuarterPlayback((current) => !current)}
          />
          <LineChart
            data={trend}
            activeQuarter={selectedQuarter}
            onSelectQuarter={(quarter) => patchFilter('quarter', quarter)}
            series={[activeTrendMetric]}
          />
          <QuarterInsightStrip
            summary={quarterSummary}
            metricInsights={trendMetricInsights}
            quarters={trend.map((item) => item.quarter)}
            selectedQuarter={selectedQuarter}
            activeBenchmarkQuarter={activeBenchmarkQuarter}
            benchmarkOptions={benchmarkOptions}
            resolvedBenchmarkQuarter={resolvedBenchmarkQuarter}
            sameQuarterBenchmark={sameQuarterBenchmark}
            onSelectQuarter={(quarter) => patchFilter('quarter', quarter)}
            onSelectBenchmark={setBenchmarkQuarter}
          />
        </div>
        <div className="time-analysis-panel">
          <PanelHead icon={BarChart3} title="会议类型结构" meta={`${filteredRecords.length} 条`} />
          <HorizontalBars
            data={typeSummary.slice(0, 8)}
            total={overview.actualMinutes}
            valueKey="actualMinutes"
            onSelect={(label) => patchFilter('meetingType', filters.meetingType === label ? 'all' : label)}
          />
        </div>
        <div className="time-analysis-panel">
          <PanelHead icon={BarChart3} title="地点与形式" />
          <DonutLikeBars
            data={locationSummary}
            total={overview.actualMinutes}
            onSelect={(label) => patchFilter('locationType', filters.locationType === label ? 'all' : label)}
          />
        </div>
      </div>

      <MonthlyBreakdownPanel
        items={monthlyBreakdown}
        activeMonth={filters.month}
        onSelect={(month) => {
          setFilters((current) => ({
            ...current,
            month: filters.month === month ? 'all' : month,
            date: 'all',
          }))
          setSelectedSeries('')
        }}
      />

      <QuarterCalendarPanel
        calendar={quarterCalendar}
        activeDate={filters.date}
        onSelect={(date) => {
          setFilters((current) => ({
            ...current,
            date: filters.date === date ? 'all' : date,
          }))
          setSelectedSeries('')
        }}
      />

      <TimeRhythmPanel
        rhythm={rhythmInsights}
        filters={filters}
        onSelectWeekday={(weekday) => patchFilter('weekday', filters.weekday === weekday ? 'all' : weekday)}
        onSelectHourBucket={(hourBucket) => patchFilter('hourBucket', filters.hourBucket === hourBucket ? 'all' : hourBucket)}
        onSelectRhythmCell={(weekday, hourBucket) => {
          const isSameCell = filters.weekday === weekday && filters.hourBucket === hourBucket
          setFilters((current) => ({
            ...current,
            weekday: isSameCell ? 'all' : weekday,
            hourBucket: isSameCell ? 'all' : hourBucket,
          }))
          setSelectedSeries('')
        }}
        onClear={() => setFilters((current) => ({ ...current, weekday: 'all', hourBucket: 'all' }))}
      />

      <div className="time-analysis-panel time-analysis-delta-panel">
        <div className="time-analysis-delta-head">
          <PanelHead icon={BarChart3} title="结构变化归因" meta={quarterSummary.previousQuarter ? `${selectedQuarter} vs ${quarterSummary.previousQuarter}` : '暂无基准'} />
          <div className="time-analysis-delta-tools">
            <label className="time-analysis-benchmark-select">
              <span>基准</span>
              <select value={activeBenchmarkQuarter} onChange={(event) => setBenchmarkQuarter(event.target.value)}>
                <option value="previous">上一季度</option>
                {benchmarkOptions.map((quarter) => (
                  <option value={quarter} key={quarter}>{quarter}</option>
                ))}
              </select>
            </label>
            <div className="time-analysis-segmented">
              {STRUCTURE_DIMENSIONS.map((dimension) => (
                <button
                  className={compareDimension === dimension.key ? 'time-analysis-segmented-active' : ''}
                  type="button"
                  key={dimension.key}
                  onClick={() => setCompareDimension(dimension.key)}
                >
                  {dimension.shortLabel}
                </button>
              ))}
            </div>
          </div>
        </div>
        <StructureDeltaList
          items={structureDeltas}
          dimension={compareDimension}
          onSelect={(item) => patchFilter(item.filterKey, filters[item.filterKey] === item.filterValue ? 'all' : item.filterValue)}
        />
      </div>

      <div className="time-analysis-ranking-grid">
        <RankingPanel title="最耗时会议" items={topHeavy} value={(item) => formatMinutes(item.actualMinutes)} onSelect={handleSelectSeries} />
        <RankingPanel title="最容易超时" items={topOver} value={(item) => `${formatNumber(item.avgDiff)} 分钟/场`} onSelect={handleSelectSeries} />
        <RankingPanel title="最不稳定" items={topUnstable} value={(item) => formatPercent(item.cv * 100)} onSelect={handleSelectSeries} />
      </div>

      {selectedSeriesAnalysis ? (
        <SeriesDrawer
          analysis={selectedSeriesAnalysis}
          records={selectedSeriesRecords}
          onClose={() => {
            setSelectedSeries('')
            setFilters((current) => ({ ...current, keyword: '' }))
          }}
        />
      ) : null}

      <ScheduleActionPanel actions={scheduleActions} impact={scheduleImpact} onSelect={handleSelectSeries} />
      <ScheduleSimulationPanel
        simulation={scheduleSimulation}
        assumptions={simulationAssumptions}
        onChange={updateSimulationAssumption}
      />

      <div className="time-analysis-panel time-analysis-recommendation-panel">
        <PanelHead icon={Sparkles} title="下季度排期建议" meta={`${quarterRecords.length} 条样本`} />
        <div className="time-analysis-recommendation-list">
          {seriesAnalysis
            .filter((item) => item.count >= 2)
            .sort((left, right) => Math.abs(right.avgDiff) + right.cv * 20 - (Math.abs(left.avgDiff) + left.cv * 20))
            .slice(0, 8)
            .map((item) => (
              <div className="time-analysis-recommendation-row" key={item.label}>
                <div>
                  <strong>{item.label}</strong>
                  <span>{item.count} 场 · 平均 {formatNumber(item.avgActual)} 分钟 · 偏差 {formatNumber(item.avgDiff)} 分钟</span>
                </div>
                <p>{item.recommendation}</p>
              </div>
            ))}
        </div>
      </div>

      <BriefingPanel cards={briefingCards} onSelect={handleBriefingSelect} />

      <ReportReadinessPanel readiness={reportReadiness} onSelect={handleReportReadinessAction} />

      <ReportOutlinePanel
        items={reportOutline}
        activeKey={activeReportStepKey}
        isPlaying={isReportPlayback}
        onSelect={selectReportStep}
        onPrevious={() => stepReportOutline(-1)}
        onNext={() => stepReportOutline(1)}
        onTogglePlayback={() => setIsReportPlayback((current) => !current)}
        onCopy={handleCopyReportOutline}
      />

      <div className="time-analysis-panel time-analysis-report-panel">
        <PanelHead icon={FileDown} title="季度报告页" meta="跨季度对比 / 结构归因 / 建议" />
        <div className="time-analysis-report-layout">
          <div className="time-analysis-report-summary">
            <strong>{selectedQuarter || '全部季度'} 复盘摘要</strong>
            {narratives.map((item) => (
              <p key={item}>{item}</p>
            ))}
            <p>{formatQualitySentence(dataQuality)}</p>
            <button className="primary-button" type="button" onClick={handleDownloadReport}>
              <FileDown size={15} />
              下载报告 Markdown
            </button>
          </div>
          <div className="time-analysis-comparison-table-wrap">
            <table className="time-analysis-comparison-table">
              <thead>
                <tr>
                  <th>指标</th>
                  {comparisonRows.quarters.map((quarter) => (
                    <th key={quarter} className={quarter === selectedQuarter ? 'time-analysis-current-quarter' : ''}>{quarter}</th>
                  ))}
                  <th>较基准</th>
                </tr>
              </thead>
              <tbody>
                {comparisonRows.rows.map((row) => (
                  <tr key={row.label}>
                    <td>{row.label}</td>
                    {row.values.map((item) => (
                      <td key={`${row.label}-${item.quarter}`} className={item.quarter === selectedQuarter ? 'time-analysis-current-quarter' : ''}>{item.value}</td>
                    ))}
                    <td className={row.deltaValue >= 0 ? 'time-analysis-cell-hot' : 'time-analysis-cell-cool'}>{row.delta}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
        </div>
      </details>
    </section>
  )
}

function buildVisibleTrendWindow(trend, selectedQuarter, maxPoints = 10) {
  if (!Array.isArray(trend) || trend.length <= maxPoints) return trend || []
  const activeIndex = trend.findIndex((item) => item.quarter === selectedQuarter)
  const targetIndex = activeIndex >= 0 ? activeIndex : trend.length - 1
  const halfWindow = Math.floor(maxPoints / 2)
  const start = Math.max(0, Math.min(targetIndex - halfWindow, trend.length - maxPoints))
  return trend.slice(start, start + maxPoints)
}

function mergeImportedTimeRecords(currentRecords, importedRecords, sourceId) {
  const knownFingerprints = new Set(currentRecords.map(getTimeRecordFingerprint))
  const additions = importedRecords
    .filter((record) => {
      const fingerprint = getTimeRecordFingerprint(record)
      if (knownFingerprints.has(fingerprint)) return false
      knownFingerprints.add(fingerprint)
      return true
    })
    .map((record, index) => ({
      ...record,
      id: `${sourceId}-${index}-${record.id}`,
    }))

  return additions.length > 0 ? [...currentRecords, ...additions] : currentRecords
}

function getTimeRecordFingerprint(record) {
  return [
    record.date,
    record.title,
    record.meetingType,
    record.locationType,
    record.plannedStart,
    record.plannedEnd,
    record.actualStart,
    record.actualEnd,
    Math.round(Number(record.plannedMinutes) || 0),
    Math.round(Number(record.actualMinutes) || 0),
  ].join('|')
}

function buildMonthTrend(records) {
  const months = getUniqueOptions(records, 'month')
  return months.map((month) => {
    const items = records.filter((record) => record.month === month)
    return {
      month,
      quarter: formatMonthTick(month),
      ...calculateOverview(items),
    }
  })
}

function buildMonthComparisonRows(monthTrend, selectedMonth) {
  const activeIndex = monthTrend.findIndex((item) => item.month === selectedMonth)
  const endIndex = activeIndex >= 0 ? activeIndex : monthTrend.length - 1
  const startIndex = Math.max(0, endIndex - 4)
  const items = monthTrend.slice(startIndex, endIndex + 1)
  const metricRows = [
    { key: 'count', label: '日程数量', unit: 'count' },
    { key: 'plannedMinutes', label: '规划时长', unit: 'minutes' },
    { key: 'actualMinutes', label: '实际时长', unit: 'minutes' },
    { key: 'absDiffMinutes', label: '累计偏差', unit: 'minutes' },
    { key: 'onTimeRate', label: '准时率', unit: 'pct' },
  ]

  return {
    quarters: items.map((item) => item.quarter),
    rows: metricRows.map((metric) => ({
      label: metric.label,
      values: items.map((item) => ({
        quarter: item.quarter,
        value: formatQuarterTrendValue(metric, item[metric.key]),
      })),
      delta: 'N/A',
      deltaValue: 0,
    })),
  }
}

function getSelectedTrendMonth(filters, monthTrend) {
  if (filters.month && filters.month !== 'all') return filters.month
  if (filters.quarter === 'custom' && filters.dateStart) return filters.dateStart.slice(0, 7)
  return monthTrend.at(-1)?.month || ''
}

function getMonthEndDate(month) {
  const [yearText, monthText] = String(month || '').split('-')
  const year = Number(yearText)
  const monthIndex = Number(monthText)
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex)) return ''
  const endDate = new Date(Date.UTC(year, monthIndex, 0))
  const day = String(endDate.getUTCDate()).padStart(2, '0')
  return `${month}-${day}`
}

function formatMonthTick(month) {
  const [year, monthNumber] = String(month || '').split('-')
  if (!year || !monthNumber) return month || ''
  return `${year.slice(2)}/${monthNumber}`
}

function sortMeetingRecords(records, sort) {
  if (!sort?.key) return records
  const direction = sort.direction === 'desc' ? -1 : 1
  return [...records]
    .map((record, index) => ({ record, index }))
    .sort((left, right) => {
      const valueComparison = compareRecordValues(left.record, right.record, sort.key)
      if (valueComparison !== 0) return valueComparison * direction
      return left.index - right.index
    })
    .map((item) => item.record)
}

function compareRecordValues(left, right, key) {
  const numericKeys = new Set(['plannedMinutes', 'actualMinutes', 'diffMinutes', 'absDiffMinutes'])
  if (numericKeys.has(key)) {
    return Number(left[key] || 0) - Number(right[key] || 0)
  }

  const leftValue = String(left[key] || '')
  const rightValue = String(right[key] || '')
  const primary = leftValue.localeCompare(rightValue, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' })
  if (primary !== 0) return primary

  const leftFallback = `${left.date || ''}-${left.title || ''}`
  const rightFallback = `${right.date || ''}-${right.title || ''}`
  return leftFallback.localeCompare(rightFallback, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' })
}

function getTableSortLabel(sort) {
  const labels = {
    date: '日期',
    meetingType: '会议类型',
    title: '会议主题',
    locationType: '地点',
    plannedStart: '预计开始',
    plannedEnd: '预计结束',
    actualStart: '实际开始',
    actualEnd: '实际结束',
    plannedMinutes: '预计时长',
    actualMinutes: '实际时长',
    diffMinutes: '差值',
    status: '状态',
    remark: '备注',
  }
  const label = labels[sort?.key] || '日期'
  return `按${label}${sort?.direction === 'desc' ? '降序' : '升序'}排列`
}

async function parseWorkbookFile(file) {
  const XLSX = await import('xlsx')
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, {
    type: 'array',
    cellDates: true,
    cellFormula: false,
  })
  const sheets = workbook.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json(workbook.Sheets[name], {
      header: 1,
      raw: true,
      defval: '',
    }),
  }))
  return pickMeetingRowsFromSheets(sheets)
}

function SelectControl({ label, value, onChange, children }) {
  return (
    <label className="time-analysis-select">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
    </label>
  )
}

function KpiCard({ label, value, unit = '', accent = 'neutral' }) {
  return (
    <div className={`time-analysis-kpi time-analysis-kpi-${accent}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {unit ? <em>{unit}</em> : null}
    </div>
  )
}

function ExcelOverviewSummary({ selectedQuarter, overview, statusItems, onSelectStatus }) {
  const overTimeItems = statusItems.filter((item) => ['lightOver', 'mediumOver', 'seriousOver'].includes(item.key))
  const earlyItems = statusItems.filter((item) => ['veryEarly', 'mediumEarly', 'lightEarly'].includes(item.key))
  const onTimeItem = statusItems.find((item) => item.key === 'onTime') || { count: 0, percent: 0 }
  const statusCards = [...earlyItems, onTimeItem, ...overTimeItems]

  return (
    <section className="time-analysis-excel-band time-analysis-excel-summary" aria-label="日程时长统计总览">
      <div className="time-analysis-excel-title">
        <span>{selectedQuarter || '全部季度'}</span>
        <strong>日程时长统计总览</strong>
      </div>
      <div className="time-analysis-excel-kpis">
        <div className="time-analysis-excel-count-card">
          <span>日程数量</span>
          <strong>
            {formatNumber(overview.count, 0)}
            <em>个</em>
          </strong>
        </div>
        <ExcelMetricCard label="总规划时长" value={formatNumber(overview.plannedMinutes, 0)} unit="分钟" />
        <ExcelMetricCard label="总实际时长" value={formatNumber(overview.actualMinutes, 0)} unit="分钟" tone="green" />
        <ExcelMetricCard label="差值" value={formatNumber(overview.diffMinutes, 0)} unit="分钟" tone={overview.diffMinutes > 0 ? 'orange' : 'green'} />
        <ExcelMetricCard label="差值占规划时长" value={formatPercent(overview.diffPercent)} tone={Math.abs(overview.diffPercent) > 2 ? 'orange' : 'green'} />
        <ExcelMetricCard
          label="累计差值"
          value={formatNumber(overview.absDiffMinutes, 0)}
          unit="分钟"
          sub={`${formatNumber(overview.avgAbsDiffMinutes)} 分钟/个`}
          tone="purple"
        />
      </div>
      <StatusOverview items={statusCards} onSelectStatus={onSelectStatus} />
    </section>
  )
}

function OverviewTrendSection({
  mode,
  onModeChange,
  trend,
  monthTrend,
  selectedQuarter,
  selectedMonth,
  visibleTrendMetrics,
  onToggleTrendMetric,
  activeBenchmarkQuarter,
  benchmarkOptions,
  resolvedBenchmarkQuarter,
  sameQuarterBenchmark,
  comparisonRows,
  onSelectQuarter,
  onSelectMonth,
  onSelectBenchmark,
}) {
  const trendSeries = TREND_METRICS.filter((item) => visibleTrendMetrics[item.key])
  const isMonthMode = mode === 'month'
  const chartData = isMonthMode ? monthTrend : trend
  const activeLabel = isMonthMode
    ? monthTrend.find((item) => item.month === selectedMonth)?.quarter || monthTrend.at(-1)?.quarter
    : selectedQuarter
  const visibleTrend = buildVisibleTrendWindow(chartData, activeLabel, isMonthMode ? 12 : 10)
  const currentTrend = trend.find((item) => item.quarter === selectedQuarter) || trend.at(-1)
  const benchmarkTrend = trend.find((item) => item.quarter === resolvedBenchmarkQuarter)
  const countDelta = currentTrend && benchmarkTrend ? currentTrend.count - benchmarkTrend.count : null
  const actualDelta = currentTrend && benchmarkTrend ? currentTrend.actualMinutes - benchmarkTrend.actualMinutes : null
  const currentMonthTrend = monthTrend.find((item) => item.month === selectedMonth) || monthTrend.at(-1)
  const currentMonthIndex = currentMonthTrend ? monthTrend.findIndex((item) => item.month === currentMonthTrend.month) : -1
  const previousMonthTrend = currentMonthIndex > 0 ? monthTrend[currentMonthIndex - 1] : null
  const monthComparisonRows = buildMonthComparisonRows(monthTrend, currentMonthTrend?.month)
  const monthCountDelta = currentMonthTrend && previousMonthTrend ? currentMonthTrend.count - previousMonthTrend.count : null
  const monthActualDelta = currentMonthTrend && previousMonthTrend ? currentMonthTrend.actualMinutes - previousMonthTrend.actualMinutes : null

  return (
    <section className="time-analysis-overview-trend" aria-label="趋势与对比总览">
      <div className="time-analysis-panel time-analysis-excel-panel">
        <div className="time-analysis-trend-head-row">
          <PanelHead icon={TrendingUp} title={isMonthMode ? '跨月趋势' : '跨季度趋势'} />
          <div className="time-analysis-segmented time-analysis-trend-mode-switch" aria-label="趋势视图">
            <button
              className={!isMonthMode ? 'time-analysis-segmented-active' : ''}
              type="button"
              onClick={() => onModeChange?.('quarter')}
            >
              季度
            </button>
            <button
              className={isMonthMode ? 'time-analysis-segmented-active' : ''}
              type="button"
              onClick={() => onModeChange?.('month')}
            >
              月份
            </button>
          </div>
        </div>
        <div className="time-analysis-trend-toggle-row" aria-label="趋势图显示指标">
          {TREND_METRICS.map((metric) => (
            <button
              className={visibleTrendMetrics[metric.key] ? 'time-analysis-toggle-chip time-analysis-toggle-chip-on' : 'time-analysis-toggle-chip'}
              type="button"
              onClick={() => onToggleTrendMetric?.(metric.key)}
              key={metric.key}
              style={{ '--chip-color': metric.color }}
            >
              {metric.label}
            </button>
          ))}
        </div>
        <LineChart
          data={visibleTrend}
          activeQuarter={activeLabel}
          onSelectQuarter={(label) => {
            if (isMonthMode) {
              const item = chartData.find((point) => point.quarter === label)
              if (item?.month) onSelectMonth?.(item.month)
              return
            }
            onSelectQuarter?.(label)
          }}
          series={trendSeries}
          showAllLabels
          showValueLabel={false}
          showPointLabels
        />
      </div>

      <div className="time-analysis-panel time-analysis-excel-panel">
        {isMonthMode ? (
          <>
            <PanelHead icon={BarChart3} title="月度对比" />
            <div className="time-analysis-excel-benchmark">
              <div>
                <span>日程数量变化</span>
                <strong>{monthCountDelta === null ? 'N/A' : formatDelta(monthCountDelta, 'count')}</strong>
              </div>
              <div>
                <span>实际时长变化</span>
                <strong>{monthActualDelta === null ? 'N/A' : formatDelta(monthActualDelta, 'minutes')}</strong>
              </div>
            </div>
            <ExcelComparisonTable rows={monthComparisonRows.rows} quarters={monthComparisonRows.quarters} />
          </>
        ) : (
          <>
            <PanelHead icon={BarChart3} title="同环比" />
            <div className="time-analysis-excel-benchmark">
              <div>
                <span>日程数量变化</span>
                <strong>{countDelta === null ? 'N/A' : formatDelta(countDelta, 'count')}</strong>
              </div>
              <div>
                <span>实际时长变化</span>
                <strong>{actualDelta === null ? 'N/A' : formatDelta(actualDelta, 'minutes')}</strong>
              </div>
            </div>
            <div className="time-analysis-trend-benchmark">
              <span>对比基准</span>
              <div className="time-analysis-trend-benchmark-actions">
                <button
                  className={activeBenchmarkQuarter === 'previous' ? 'time-analysis-benchmark-chip time-analysis-benchmark-chip-active' : 'time-analysis-benchmark-chip'}
                  type="button"
                  onClick={() => onSelectBenchmark?.('previous')}
                  disabled={benchmarkOptions.length === 0}
                >
                  环比
                </button>
                <button
                  className={activeBenchmarkQuarter === sameQuarterBenchmark ? 'time-analysis-benchmark-chip time-analysis-benchmark-chip-active' : 'time-analysis-benchmark-chip'}
                  type="button"
                  onClick={() => sameQuarterBenchmark && onSelectBenchmark?.(sameQuarterBenchmark)}
                  disabled={!sameQuarterBenchmark}
                  title={sameQuarterBenchmark ? `同季去年：${sameQuarterBenchmark}` : '没有同季去年数据'}
                >
                  同比
                </button>
                <label>
                  <em>指定</em>
                  <select value={activeBenchmarkQuarter} onChange={(event) => onSelectBenchmark?.(event.target.value)} disabled={benchmarkOptions.length === 0}>
                    <option value="previous">上一季度</option>
                    {benchmarkOptions.map((quarter) => (
                      <option value={quarter} key={quarter}>{quarter}</option>
                    ))}
                  </select>
                </label>
              </div>
              <strong>{resolvedBenchmarkQuarter || '暂无'}</strong>
            </div>
            <ExcelComparisonTable rows={comparisonRows.rows} quarters={comparisonRows.quarters} />
          </>
        )}
      </div>
    </section>
  )
}

function ExcelStyleDashboard({
  overview,
  typeSummary,
  locationSummary,
  trackedMeetingReports,
  trackedGroups,
  newGroupName,
  newGroupKeywords,
  onNewGroupNameChange,
  onNewGroupKeywordsChange,
  onAddTrackedGroup,
  onUpdateTrackedGroupLabel,
  onAddTrackedGroupTerms,
  onRemoveTrackedGroupTerm,
  onRemoveTrackedGroupItem,
  onRestoreTrackedGroupItem,
  onRemoveTrackedGroup,
  onSelectType,
  onSelectLocation,
  onSelectTrackedMeeting,
}) {
  return (
    <div className="time-analysis-excel-dashboard">
      <section className="time-analysis-excel-grid" aria-label="数量与时长视角">
        <FlippableSummaryCard
          icon={BarChart3}
          title="日程数量视角"
          rows={typeSummary.slice(0, 9)}
          total={overview.count}
          mode="count"
          onSelect={onSelectType}
        />
        <FlippableSummaryCard
          icon={BarChart3}
          title="日程时长视角"
          rows={typeSummary.slice(0, 9)}
          total={overview.actualMinutes}
          mode="minutes"
          onSelect={onSelectType}
        />
        <FlippableSummaryCard
          icon={BarChart3}
          title="地点形式"
          rows={locationSummary}
          total={overview.actualMinutes}
          mode="minutes"
          onSelect={onSelectLocation}
        />
      </section>

      <section className="time-analysis-panel time-analysis-excel-panel">
        <PanelHead icon={BarChart3} title="重点会议" />
        <TrackedMeetingPanel
          reports={trackedMeetingReports}
          groups={trackedGroups}
          newGroupName={newGroupName}
          newGroupKeywords={newGroupKeywords}
          onNewGroupNameChange={onNewGroupNameChange}
          onNewGroupKeywordsChange={onNewGroupKeywordsChange}
          onAdd={onAddTrackedGroup}
          onUpdateLabel={onUpdateTrackedGroupLabel}
          onAddTerms={onAddTrackedGroupTerms}
          onRemoveTerm={onRemoveTrackedGroupTerm}
          onRemoveItem={onRemoveTrackedGroupItem}
          onRestoreItem={onRestoreTrackedGroupItem}
          onRemove={onRemoveTrackedGroup}
          onSelectMeeting={onSelectTrackedMeeting}
        />
      </section>

    </div>
  )
}

function FlippableSummaryCard({ icon, title, rows, total, mode, onSelect }) {
  const [isFlipped, setIsFlipped] = useState(false)
  const viewLabel = isFlipped ? '返回表格' : '查看饼图'

  return (
    <div className={`time-analysis-panel time-analysis-excel-panel time-analysis-flip-card ${isFlipped ? 'is-flipped' : ''}`}>
      <div className="time-analysis-flip-inner">
        <div className="time-analysis-flip-face time-analysis-flip-front">
          <SummaryFlipHead
            icon={icon}
            title={title}
            buttonLabel={viewLabel}
            onToggle={() => setIsFlipped((current) => !current)}
          />
          <ExcelSummaryTable rows={rows} total={total} mode={mode} onSelect={onSelect} />
        </div>
        <div className="time-analysis-flip-face time-analysis-flip-back">
          <SummaryFlipHead
            icon={icon}
            title={title}
            buttonLabel={viewLabel}
            onToggle={() => setIsFlipped((current) => !current)}
          />
          <SummaryPieChart rows={rows} total={total} mode={mode} onSelect={onSelect} />
        </div>
      </div>
    </div>
  )
}

function SummaryFlipHead({ icon, title, buttonLabel, onToggle }) {
  return (
    <div className="time-analysis-flip-head">
      <div>
        {createElement(icon, { size: 17 })}
        <strong>{title}</strong>
      </div>
      <button className="time-analysis-flip-button" type="button" onClick={onToggle}>
        <RotateCcw size={14} />
        {buttonLabel}
      </button>
    </div>
  )
}

function SummaryPieChart({ rows, total, mode, onSelect }) {
  const segments = useMemo(() => buildPieSegments(rows, total, mode), [rows, total, mode])
  const [activeIndex, setActiveIndex] = useState(0)
  const safeActiveIndex = activeIndex < segments.length ? activeIndex : 0
  const activeSegment = segments[safeActiveIndex] || segments[0]

  if (segments.length === 0) {
    return <div className="time-analysis-pie-empty">暂无可展示数据</div>
  }

  return (
    <div className="time-analysis-pie-layout">
      <div className="time-analysis-pie-figure">
        <svg viewBox="0 0 180 180" role="img" aria-label="占比饼图">
          {segments.map((segment, index) => {
            const path = describePieSlice(90, 90, 72, segment.startAngle, segment.endAngle)
            const isFullCircle = segment.percent >= 99.99
            return isFullCircle ? (
              <circle
                className={index === safeActiveIndex ? 'is-active' : ''}
                cx="90"
                cy="90"
                fill={segment.color}
                key={segment.label}
                onClick={() => onSelect?.(segment.label)}
                onMouseEnter={() => setActiveIndex(index)}
                r="72"
              />
            ) : (
              <path
                className={index === safeActiveIndex ? 'is-active' : ''}
                d={path}
                fill={segment.color}
                key={segment.label}
                onClick={() => onSelect?.(segment.label)}
                onMouseEnter={() => setActiveIndex(index)}
              />
            )
          })}
        </svg>
        <div className="time-analysis-pie-readout">
          <span>{activeSegment.label}</span>
          <strong>{mode === 'count' ? `${formatNumber(activeSegment.value, 0)} 个` : formatMinutes(activeSegment.value)}</strong>
          <em>{formatPercent(activeSegment.percent)}</em>
        </div>
      </div>
      <div className="time-analysis-pie-legend">
        {segments.map((segment, index) => (
          <button
            className={index === safeActiveIndex ? 'is-active' : ''}
            key={segment.label}
            type="button"
            onClick={() => onSelect?.(segment.label)}
            onMouseEnter={() => setActiveIndex(index)}
          >
            <i style={{ background: segment.color }} />
            <span>{segment.label}</span>
            <strong>{formatPercent(segment.percent)}</strong>
          </button>
        ))}
      </div>
    </div>
  )
}

function buildPieSegments(rows, total, mode) {
  const totalValue = Number(total) > 0 ? Number(total) : rows.reduce((sum, row) => sum + getSummaryValue(row, mode), 0)
  if (totalValue <= 0) return []
  const segments = rows
    .map((row, index) => {
      const value = getSummaryValue(row, mode)
      return {
        label: row.label,
        value,
        percent: (value / totalValue) * 100,
        color: CHART_COLORS[index % CHART_COLORS.length],
      }
    })
    .filter((segment) => segment.value > 0)

  const visibleTotal = segments.reduce((sum, segment) => sum + segment.value, 0)
  if (visibleTotal > 0 && totalValue - visibleTotal > 0.01) {
    segments.push({
      label: '其他',
      value: totalValue - visibleTotal,
      percent: ((totalValue - visibleTotal) / totalValue) * 100,
      color: '#94a3b8',
    })
  }
  let startAngle = 0
  return segments.map((segment) => {
    const endAngle = startAngle + (segment.percent / 100) * 360
    const nextSegment = { ...segment, startAngle, endAngle }
    startAngle = endAngle
    return nextSegment
  })
}

function getSummaryValue(row, mode) {
  return Number(mode === 'count' ? row.count : row.actualMinutes) || 0
}

function describePieSlice(cx, cy, radius, startAngle, endAngle) {
  const start = polarPoint(cx, cy, radius, endAngle)
  const end = polarPoint(cx, cy, radius, startAngle)
  const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1'
  return [
    `M ${cx} ${cy}`,
    `L ${start.x} ${start.y}`,
    `A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`,
    'Z',
  ].join(' ')
}

function polarPoint(cx, cy, radius, angleInDegrees) {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180
  return {
    x: cx + radius * Math.cos(angleInRadians),
    y: cy + radius * Math.sin(angleInRadians),
  }
}

function RecordDetailModal({ detail, onClose }) {
  return (
    <div
      className="time-analysis-modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose?.()
      }}
      role="presentation"
    >
      <div className="time-analysis-modal time-analysis-detail-modal" role="dialog" aria-modal="true" aria-label={detail.title}>
        <div className="time-analysis-modal-head">
          <div>
            <strong>{detail.title}</strong>
            <span>{detail.windowLabel} · {detail.sourceLabel} · {formatNumber(detail.records.length, 0)} 条原始记录</span>
          </div>
          <button className="ghost-button" type="button" onClick={onClose}>关闭</button>
        </div>
        <div className="time-analysis-detail-summary">
          <div>
            <span>日程数量</span>
            <strong>{formatNumber(detail.overview.count, 0)}</strong>
            <em>个</em>
          </div>
          <div>
            <span>总规划时长</span>
            <strong>{formatNumber(detail.overview.plannedMinutes, 0)}</strong>
            <em>分钟</em>
          </div>
          <div>
            <span>总实际时长</span>
            <strong>{formatNumber(detail.overview.actualMinutes, 0)}</strong>
            <em>分钟</em>
          </div>
          <div>
            <span>净差值</span>
            <strong>{formatNumber(detail.overview.diffMinutes, 0)}</strong>
            <em>分钟</em>
          </div>
        </div>
        <div className="time-analysis-detail-table-wrap">
          <table className="time-analysis-detail-table">
            <thead>
              <tr>
                <th>#</th>
                <th>日期</th>
                <th>会议类型</th>
                <th>会议主题</th>
                <th>公司/线上</th>
                <th>预计开始</th>
                <th>预计结束</th>
                <th>实际开始</th>
                <th>实际结束</th>
                <th>预计</th>
                <th>实际</th>
                <th>差值</th>
                <th>状态</th>
                <th>备注</th>
              </tr>
            </thead>
            <tbody>
              {detail.records.map((record, index) => (
                <tr key={record.id}>
                  <td>{index + 1}</td>
                  <td>{record.date}</td>
                  <td>{record.meetingType}</td>
                  <td className="time-analysis-detail-title-cell">{record.title}</td>
                  <td>{record.locationType}</td>
                  <td>{record.plannedStart}</td>
                  <td>{record.plannedEnd}</td>
                  <td>{record.actualStart}</td>
                  <td>{record.actualEnd}</td>
                  <td>{formatNumber(record.plannedMinutes, 0)}</td>
                  <td>{formatNumber(record.actualMinutes, 0)}</td>
                  <td className={record.diffMinutes > 5 ? 'time-analysis-cell-hot' : record.diffMinutes < -5 ? 'time-analysis-cell-cool' : ''}>
                    {formatNumber(record.diffMinutes, 0)}
                  </td>
                  <td>{record.status}</td>
                  <td className="time-analysis-detail-remark-cell">{record.remark}</td>
                </tr>
              ))}
              {detail.records.length === 0 ? (
                <tr>
                  <td colSpan={14} className="time-analysis-detail-empty">当前时间窗口内没有匹配的原始记录</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function TrackedMeetingPanel({
  reports,
  groups,
  newGroupName,
  newGroupKeywords,
  onNewGroupNameChange,
  onNewGroupKeywordsChange,
  onAdd,
  onUpdateLabel,
  onAddTerms,
  onRemoveTerm,
  onRemoveItem,
  onRestoreItem,
  onRemove,
  onSelectMeeting,
}) {
  const [termDrafts, setTermDrafts] = useState({})
  const [isConfigOpen, setIsConfigOpen] = useState(false)

  function updateTermDraft(id, value) {
    setTermDrafts((current) => ({ ...current, [id]: value }))
  }

  function submitTerms(id) {
    const value = termDrafts[id] || ''
    onAddTerms?.(id, value)
    setTermDrafts((current) => ({ ...current, [id]: '' }))
  }

  return (
    <div className="time-analysis-tracked-panel">
      <div className="time-analysis-tracked-toolbar">
        <div>
          <strong>所有常规会议时长一览表</strong>
        </div>
        <button className="ghost-button" type="button" onClick={() => setIsConfigOpen(true)}>
          <Plus size={15} />
          维护分类
        </button>
      </div>
      <TrackedExcelTable reports={reports} onRemoveItem={onRemoveItem} onSelectMeeting={onSelectMeeting} />
      {isConfigOpen ? (
        <div className="time-analysis-modal-backdrop" role="presentation" onMouseDown={() => setIsConfigOpen(false)}>
          <div
            aria-modal="true"
            className="time-analysis-modal time-analysis-tracked-modal"
            role="dialog"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="time-analysis-modal-head">
              <div>
                <strong>维护会议分类</strong>
              </div>
              <button className="icon-button" type="button" onClick={() => setIsConfigOpen(false)} aria-label="关闭维护分类">
                ×
              </button>
            </div>
            <div className="time-analysis-tracked-config-grid">
              {groups.map((group) => (
                <div className="time-analysis-tracked-config-card" key={group.id}>
                  <div className="time-analysis-tracked-config-head">
                    <label>
                      <span>大类名称</span>
                      <input
                        value={group.label}
                        onChange={(event) => onUpdateLabel?.(group.id, event.target.value)}
                        placeholder="例如：常规会议 1-1"
                      />
                    </label>
                    {!group.locked ? (
                      <button className="icon-button" type="button" onClick={() => onRemove?.(group.id)} title="删除大类" aria-label={`删除${group.label}`}>
                        <Trash2 size={14} />
                      </button>
                    ) : null}
                  </div>
                  <div className="time-analysis-tracked-config-terms">
                    <span>包含条目</span>
                    <div>
                      {(group.terms || []).map((term) => (
                        <button type="button" key={term} onClick={() => onRemoveTerm?.(group.id, term)} title="移除条目">
                          {term}
                          <em>×</em>
                        </button>
                      ))}
                      {(group.terms || []).length === 0 ? <strong>暂无条目</strong> : null}
                    </div>
                  </div>
                  {(group.excludeTerms || []).length > 0 ? (
                    <div className="time-analysis-tracked-config-terms time-analysis-tracked-config-excludes">
                      <span>已移出</span>
                      <div>
                        {group.excludeTerms.map((term) => (
                          <button type="button" key={term} onClick={() => onRestoreItem?.(group.id, term)} title="恢复到当前大类">
                            {term}
                            <em>↺</em>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <div className="time-analysis-tracked-config-add">
                    <input
                      value={termDrafts[group.id] || ''}
                      onChange={(event) => updateTermDraft(group.id, event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') submitTerms(group.id)
                      }}
                      placeholder="输入会议名称，多个用逗号分隔"
                    />
                    <button className="ghost-button" type="button" onClick={() => submitTerms(group.id)}>
                      <Plus size={14} />
                      加条目
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="time-analysis-tracked-editor">
              <label>
                <span>分类名称</span>
                <input
                  value={newGroupName}
                  onChange={(event) => onNewGroupNameChange?.(event.target.value)}
                  placeholder="例如：战略会"
                />
              </label>
              <label>
                <span>会议名称关键词</span>
                <input
                  value={newGroupKeywords}
                  onChange={(event) => onNewGroupKeywordsChange?.(event.target.value)}
                  placeholder="多个关键词用逗号分隔"
                />
              </label>
              <button className="ghost-button" type="button" onClick={onAdd}>
                <Plus size={15} />
                添加分类
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function TrackedExcelTable({ reports, onRemoveItem, onSelectMeeting }) {
  return (
    <div className="time-analysis-tracked-excel-wrap">
      <table className="time-analysis-tracked-excel-table" aria-label="所有常规会议时长一览表">
        <colgroup>
          <col className="time-analysis-tracked-col-group" />
          <col className="time-analysis-tracked-col-name" />
          <col className="time-analysis-tracked-col-short" />
          <col className="time-analysis-tracked-col-short" />
          <col className="time-analysis-tracked-col-medium" />
          <col className="time-analysis-tracked-col-medium" />
          <col className="time-analysis-tracked-col-medium" />
          <col className="time-analysis-tracked-col-medium" />
          <col className="time-analysis-tracked-col-medium" />
          <col className="time-analysis-tracked-col-medium" />
          <col className="time-analysis-tracked-col-status" />
          <col className="time-analysis-tracked-col-action" />
        </colgroup>
        <thead>
          <tr>
            <th>会议大类</th>
            <th>具体会议</th>
            <th>计划</th>
            <th>数量</th>
            <th>平均</th>
            <th>总时长</th>
            <th>累计偏差</th>
            <th>平均偏差</th>
            <th>标准差</th>
            <th>离散</th>
            <th>状态分布</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {reports.flatMap((report) => {
            const rows = report.series.length > 0 ? report.series : [buildEmptySeriesRow()]
            return rows.map((item, index) => (
              <tr key={`${report.id}-${item.label}-${index}`}>
                {index === 0 ? (
                  <td className="time-analysis-tracked-group-cell" rowSpan={rows.length}>
                    <strong>{report.label}</strong>
                    <span>{formatNumber(report.count, 0)} 个 / {formatNumber(report.actualMinutes, 0)} 分钟</span>
                  </td>
                ) : null}
                <td className="time-analysis-tracked-name-cell">
                  <button type="button" onClick={() => onSelectMeeting?.(item.label)}>
                    {item.label}
                  </button>
                </td>
                <td>{formatNumber(item.plannedStandard, 0)}</td>
                <td>{formatNumber(item.count, 0)}</td>
                <td>{item.count > 0 ? formatNumber(item.avgActual) : '#DIV/0!'}</td>
                <td>{item.count > 0 ? formatNumber(item.actualMinutes, 0) : '#DIV/0!'}</td>
                <td className={getMetricToneClass(item.diffMinutes, 40, 80)}>{formatNumber(item.diffMinutes, 0)}</td>
                <td className={getMetricToneClass(item.avgDiff, 8, 15)}>{item.count > 0 ? formatNumber(item.avgDiff) : '#DIV/0!'}</td>
                <td className={getMetricToneClass(item.stdDev, 8, 15)}>{item.count > 1 ? formatNumber(item.stdDev) : '#DIV/0!'}</td>
                <td className={getMetricToneClass(item.cv, 0.15, 0.3)}>{item.count > 1 ? formatPercent(item.cv * 100) : '#DIV/0!'}</td>
                <td className="time-analysis-tracked-status-cell"><StatusDistribution item={item} /></td>
                <td className="time-analysis-tracked-action-cell">
                  {item.count > 0 ? (
                    <button
                      className="icon-button"
                      type="button"
                      onClick={() => onRemoveItem?.(report.id, item.label)}
                      aria-label={`从${report.label}移出${item.label}`}
                      title="从当前大类移出"
                    >
                      <Trash2 size={14} />
                    </button>
                  ) : null}
                </td>
              </tr>
            ))
          })}
        </tbody>
      </table>
    </div>
  )
}

function StatusOverview({ items, onSelectStatus }) {
  const [activeKey, setActiveKey] = useState('')
  const onTimeItem = items.find((item) => item.key === 'onTime') || { label: '准时/基本准时', count: 0, percent: 0, tone: 'success' }
  const activeItem = activeKey ? items.find((item) => item.key === activeKey) || onTimeItem : onTimeItem
  const visibleItems = items.filter((item) => item.count > 0)
  const title = items.map((item) => `${item.label}: ${formatNumber(item.count, 0)} / ${formatPercent(item.percent, 2)}`).join('；')
  const totalCount = items.reduce((total, item) => total + item.count, 0)

  return (
    <div className="time-analysis-status-overview" title={title}>
      <div className="time-analysis-status-overview-head">
        <span>结束状态分布</span>
        <strong>{formatNumber(totalCount, 0)} 个</strong>
      </div>
      <div className="time-analysis-status-bar time-analysis-status-overview-bar" aria-label={title}>
        {items.map((item) => (
          item.count > 0 ? (
            <button
              className={`time-analysis-status-segment time-analysis-status-segment-${item.tone || 'neutral'} ${activeKey === item.key ? 'is-active' : ''}`}
              key={item.key || item.label}
              style={{ width: `${Math.max(item.percent, 2)}%` }}
              type="button"
              onClick={() => onSelectStatus?.(item.label)}
              onMouseEnter={() => setActiveKey(item.key)}
              onMouseLeave={() => setActiveKey('')}
              onPointerEnter={() => setActiveKey(item.key)}
              onPointerLeave={() => setActiveKey('')}
              aria-label={`${item.label}: ${formatNumber(item.count, 0)} 个，${formatPercent(item.percent, 2)}`}
            />
          ) : null
        ))}
      </div>
      <span className={`time-analysis-status-readout time-analysis-status-main-${activeItem.tone || 'success'}`}>
        {activeItem.label} {formatNumber(activeItem.count, 0)} 个 / {formatPercent(activeItem.percent, 0)}
      </span>
      <div className="time-analysis-status-legend" aria-label="结束状态颜色说明">
        {visibleItems.map((item) => (
          <button
            className={`time-analysis-status-legend-item time-analysis-status-main-${item.tone || 'neutral'}`}
            key={item.key || item.label}
            type="button"
            title={`${item.label}: ${formatNumber(item.count, 0)} 个，${formatPercent(item.percent, 2)}`}
            onClick={() => onSelectStatus?.(item.label)}
            onMouseEnter={() => setActiveKey(item.key)}
            onMouseLeave={() => setActiveKey('')}
            onPointerEnter={() => setActiveKey(item.key)}
            onPointerLeave={() => setActiveKey('')}
            aria-label={`${item.label}: ${formatNumber(item.count, 0)} 个，${formatPercent(item.percent, 2)}`}
          >
            <i className={`time-analysis-status-dot time-analysis-status-dot-${item.tone || 'neutral'}`} />
            <span>{item.label}</span>
            <strong>{formatPercent(item.percent, 0)}</strong>
          </button>
        ))}
      </div>
    </div>
  )
}

function StatusDistribution({ item }) {
  const [activeKey, setActiveKey] = useState('')
  if (!item.count) return <span className="time-analysis-status-empty">#DIV/0!</span>
  const stats = STATUS_RULES
    .map((status) => ({
      ...status,
      ...(item.statusStats[status.key] || { count: 0, percent: 0 }),
    }))
  const onTime = stats.find((status) => status.key === 'onTime') || { label: '准时/基本准时', count: 0, percent: 0, tone: 'success' }
  const activeStatus = activeKey ? stats.find((status) => status.key === activeKey) || onTime : onTime
  const title = stats
    .map((status) => `${status.label}: ${formatNumber(status.count, 0)} / ${formatPercent(status.percent, 2)}`)
    .join('；')

  return (
    <div className="time-analysis-status-distribution" title={title}>
      <div className="time-analysis-status-bar" aria-label={title}>
        {stats.map((status) => (
          status.count > 0 ? (
            <button
              className={`time-analysis-status-segment time-analysis-status-segment-${status.tone} ${activeKey === status.key ? 'is-active' : ''}`}
              key={status.key}
              style={{ width: `${Math.max(status.percent, 3)}%` }}
              type="button"
              onMouseEnter={() => setActiveKey(status.key)}
              onMouseLeave={() => setActiveKey('')}
              onPointerEnter={() => setActiveKey(status.key)}
              onPointerLeave={() => setActiveKey('')}
              aria-label={`${status.label}: ${formatNumber(status.count, 0)} 个，${formatPercent(status.percent, 2)}`}
            />
          ) : null
        ))}
      </div>
      <span className={`time-analysis-status-readout time-analysis-status-main-${activeStatus.tone || 'success'}`}>
        {activeStatus.label} {formatNumber(activeStatus.count, 0)} 个 / {formatPercent(activeStatus.percent, 0)}
      </span>
    </div>
  )
}

function getMetricToneClass(value, warn, hot) {
  if (!Number.isFinite(value)) return ''
  if (value >= hot) return 'time-analysis-metric-hot'
  if (value >= warn) return 'time-analysis-metric-warm'
  return 'time-analysis-metric-good'
}

function ExcelMetricCard({ label, value, unit = '', sub = '', tone = 'neutral' }) {
  return (
    <div className={`time-analysis-excel-metric time-analysis-excel-metric-${tone}`}>
      <span>{label}</span>
      <strong>
        {value}
        {unit ? <em>{unit}</em> : null}
      </strong>
      {sub ? <small>{sub}</small> : null}
    </div>
  )
}

function ExcelSummaryTable({ rows, total, mode, onSelect }) {
  return (
    <div className="time-analysis-excel-table-wrap">
      <table className="time-analysis-excel-table">
        <thead>
          <tr>
            <th>{mode === 'count' ? '会议类型' : '分类'}</th>
            <th>{mode === 'count' ? '数量' : '时长'}</th>
            <th>占比</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const value = mode === 'count' ? row.count : row.actualMinutes
            const percent = total > 0 ? (value / total) * 100 : 0
            return (
              <tr key={row.label} onClick={() => onSelect?.(row.label)}>
                <td>{row.label}</td>
                <td>{mode === 'count' ? `${formatNumber(row.count, 0)} 个` : formatMinutes(row.actualMinutes)}</td>
                <td>
                  <span className="time-analysis-excel-mini-bar">
                    <i style={{ width: `${Math.max(2, percent)}%` }} />
                  </span>
                  {formatPercent(percent)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function ExcelComparisonTable({ rows, quarters }) {
  return (
    <div className="time-analysis-comparison-table-wrap time-analysis-excel-comparison-wrap">
      <table className="time-analysis-comparison-table">
        <thead>
          <tr>
            <th>指标</th>
            {quarters.map((quarter) => (
              <th key={quarter}>{quarter}</th>
            ))}
            <th>较基准</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <td>{row.label}</td>
              {row.values.map((item) => (
                <td key={`${row.label}-${item.quarter}`}>{item.value}</td>
              ))}
              <td className={row.deltaValue >= 0 ? 'time-analysis-cell-hot' : 'time-analysis-cell-cool'}>{row.delta}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PanelHead({ icon, title, meta }) {
  return (
    <div className="time-analysis-panel-head">
      <div>
        {createElement(icon, { size: 17 })}
        <strong>{title}</strong>
      </div>
      {meta ? <span>{meta}</span> : null}
    </div>
  )
}

function HealthScorePanel({ health, onSelect }) {
  const radius = 42
  const circumference = Math.PI * 2 * radius
  const offset = circumference * (1 - health.score / 100)

  return (
    <div className="time-analysis-panel time-analysis-health-panel">
      <PanelHead icon={BarChart3} title="季度健康雷达" meta={health.summary} />
      <div className="time-analysis-health-layout">
        <div className={`time-analysis-health-score time-analysis-health-${health.tone}`}>
          <svg viewBox="0 0 120 120" aria-label={`季度健康分 ${health.score}`}>
            <circle cx="60" cy="60" r={radius} />
            <circle
              cx="60"
              cy="60"
              r={radius}
              style={{
                strokeDasharray: circumference,
                strokeDashoffset: offset,
              }}
            />
          </svg>
          <div>
            <strong>{health.score}</strong>
            <span>{health.grade}</span>
          </div>
        </div>
        <div className="time-analysis-health-dimensions">
          {health.dimensions.map((dimension, index) => (
            <button
              className="time-analysis-health-dimension"
              type="button"
              key={dimension.key}
              onClick={() => onSelect?.(dimension)}
              disabled={!dimension.filter}
            >
              <span>
                <b>{dimension.label}</b>
                <em>{dimension.score}</em>
              </span>
              <i>
                <strong style={{ width: `${dimension.score}%`, background: HEALTH_DIMENSION_COLORS[index % HEALTH_DIMENSION_COLORS.length] }} />
              </i>
              <small>{dimension.evidence}</small>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function QuickSlicesPanel({ slices, onSelect }) {
  if (slices.length === 0) return null

  return (
    <div className="time-analysis-quick-slices">
      <div className="time-analysis-quick-slices-head">
        <strong>快捷切片</strong>
        <span>点击进入重点视角</span>
      </div>
      <div className="time-analysis-quick-slice-list">
        {slices.map((slice) => (
          <button
            className={`time-analysis-quick-slice time-analysis-quick-slice-${slice.tone}`}
            type="button"
            key={slice.key}
            onClick={() => onSelect?.(slice)}
          >
            <span>{slice.badge}</span>
            <strong>{slice.title}</strong>
            <em>{slice.meta}</em>
          </button>
        ))}
      </div>
    </div>
  )
}

function SavedViewsPanel({ viewReports, canSave, onSave, onApply, onDelete }) {
  return (
    <div className="time-analysis-saved-views">
      <div className="time-analysis-saved-views-head">
        <div>
          <strong>复盘视角</strong>
          <span>{viewReports.length > 0 ? `${viewReports.length} 个已保存，指标实时刷新` : '保存常用切片，后续一键复用'}</span>
        </div>
        <button className="ghost-button" type="button" onClick={onSave} disabled={!canSave}>
          保存当前视角
        </button>
      </div>
      {viewReports.length > 0 ? (
        <div className="time-analysis-saved-view-list">
          {viewReports.map((report) => (
            <div className="time-analysis-saved-view" key={report.id}>
              <button type="button" onClick={() => onApply?.(report.view)}>
                <strong>{report.title}</strong>
                <span>{report.overview.count} 条 · {formatMinutes(report.overview.actualMinutes)} · 准时率 {formatPercent(report.overview.onTimeRate)}</span>
                <em>占季度时长 {formatPercent(report.actualShareOfScope)}</em>
              </button>
              <button className="icon-button" type="button" onClick={() => onDelete?.(report.id)} aria-label={`删除${report.title}`} title="删除视角">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function ReportReadinessPanel({ readiness, onSelect }) {
  return (
    <div className={`time-analysis-panel time-analysis-readiness-panel time-analysis-readiness-${readiness.tone}`}>
      <PanelHead icon={FileDown} title="报告就绪度" meta={readiness.summary} />
      <div className="time-analysis-readiness-layout">
        <div className="time-analysis-readiness-score">
          <span>{readiness.grade}</span>
          <strong>{readiness.score}</strong>
          <em>/100</em>
        </div>
        <div className="time-analysis-readiness-list">
          {readiness.items.map((item) => (
            <button
              className={`time-analysis-readiness-item time-analysis-readiness-item-${item.status}`}
              type="button"
              key={item.key}
              onClick={() => onSelect?.(item)}
            >
              <span>{item.label}</span>
              <strong>{item.metric}</strong>
              <em>{item.body}</em>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function ReportOutlinePanel({ items, activeKey, isPlaying, onSelect, onPrevious, onNext, onTogglePlayback, onCopy }) {
  if (items.length === 0) return null
  const activeItem = items.find((item) => item.key === activeKey) || items[0]
  const activeIndex = Math.max(0, items.findIndex((item) => item.key === activeItem.key))
  const progress = items.length > 1 ? ((activeIndex + 1) / items.length) * 100 : 100

  return (
    <div className="time-analysis-panel time-analysis-outline-panel">
      <PanelHead icon={FileDown} title="汇报大纲" meta="从看板到报告" />
      <div className={isPlaying ? 'time-analysis-outline-controls time-analysis-outline-controls-on' : 'time-analysis-outline-controls'}>
        <div className="time-analysis-outline-control-actions">
          <button className="icon-button" type="button" onClick={onPrevious} aria-label="上一页大纲" title="上一页大纲" disabled={items.length <= 1}>
            <SkipBack size={15} />
          </button>
          <button className="ghost-button time-analysis-outline-play-button" type="button" onClick={onTogglePlayback} disabled={items.length <= 1}>
            {isPlaying ? <Pause size={15} /> : <Play size={15} />}
            {isPlaying ? '暂停演示' : '播放演示'}
          </button>
          <button className="icon-button" type="button" onClick={onNext} aria-label="下一页大纲" title="下一页大纲" disabled={items.length <= 1}>
            <SkipForward size={15} />
          </button>
          <button className="ghost-button time-analysis-outline-copy-button" type="button" onClick={onCopy}>
            <Copy size={15} />
            复制大纲
          </button>
        </div>
        <div className="time-analysis-outline-progress" aria-label={`汇报大纲进度 ${activeIndex + 1}/${items.length}`}>
          <i style={{ width: `${progress}%` }} />
        </div>
        <span>{activeItem.label} · {activeIndex + 1}/{items.length}</span>
      </div>
      <div className="time-analysis-outline-layout">
        <div className="time-analysis-outline-steps">
          {items.map((item, index) => (
            <button
              className={item.key === activeItem.key ? 'time-analysis-outline-step time-analysis-outline-step-active' : 'time-analysis-outline-step'}
              type="button"
              key={item.key}
              onClick={() => onSelect?.(item.key)}
            >
              <span>{String(index + 1).padStart(2, '0')}</span>
              <strong>{item.label}</strong>
              <em>{item.metric}</em>
            </button>
          ))}
        </div>
        <div className={`time-analysis-outline-card time-analysis-outline-card-${activeItem.tone}`}>
          <div className="time-analysis-outline-card-head">
            <span>{activeItem.label}</span>
            <strong>{activeItem.title}</strong>
            <em>{activeItem.subtitle}</em>
          </div>
          <ul>
            {activeItem.bullets.map((bullet) => (
              <li key={bullet}>{bullet}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

function SliceReviewPanel({ review }) {
  if (!review.visible) return null

  return (
    <div className="time-analysis-panel time-analysis-slice-panel">
      <PanelHead icon={BarChart3} title="当前切片复盘" meta={review.title} />
      <div className="time-analysis-slice-layout">
        <div className="time-analysis-slice-summary">
          <div>
            <span>切片占比</span>
            <strong>{formatPercent(review.shareOfScope)}</strong>
            <em>{review.overview.count} / {review.scopeOverview.count} 条</em>
          </div>
          <div>
            <span>实际时长</span>
            <strong>{formatMinutes(review.overview.actualMinutes)}</strong>
            <em>占季度 {formatPercent(review.actualShareOfScope)}</em>
          </div>
          <div>
            <span>准时率</span>
            <strong>{formatPercent(review.overview.onTimeRate)}</strong>
            <em>平均偏差 {formatNumber(review.overview.avgAbsDiffMinutes)} 分钟</em>
          </div>
          <div>
            <span>净差值</span>
            <strong>{formatDelta(review.overview.diffMinutes, 'minutes')}</strong>
            <em>{formatPercent(review.overview.diffPercent)}</em>
          </div>
        </div>
        <div className="time-analysis-slice-records">
          <strong>最重明细</strong>
          {review.topRecords.length > 0 ? review.topRecords.map((record) => (
            <div className="time-analysis-slice-record" key={record.id}>
              <span>{formatDateLabel(record.date)}</span>
              <strong>{record.title}</strong>
              <em>{formatMinutes(record.actualMinutes)} · {record.status}</em>
            </div>
          )) : (
            <p>当前筛选下暂无明细。</p>
          )}
        </div>
      </div>
    </div>
  )
}

function DataQualityPanel({ quality, activeType, onSelectType }) {
  return (
    <div className={quality.totalIssues > 0 ? 'time-analysis-quality-panel time-analysis-quality-panel-alert' : 'time-analysis-quality-panel'}>
      <div className="time-analysis-quality-head">
        <strong>数据质量</strong>
        <span>{quality.totalIssues > 0 ? `${quality.totalIssues} 个问题` : '无明显问题'}</span>
        <em>{quality.checkedCount} 行</em>
      </div>
      <div className="time-analysis-quality-grid">
        {quality.items.map((item) => (
          <button
            key={item.type}
            className={activeType === item.type ? 'time-analysis-quality-item time-analysis-quality-item-active' : 'time-analysis-quality-item'}
            type="button"
            onClick={() => onSelectType(item.type)}
            disabled={item.count === 0}
          >
            <span>{item.label}</span>
            <strong>{item.count}</strong>
          </button>
        ))}
      </div>
    </div>
  )
}

function EditableGrid({ records, quality, sort, onSort, onCellChange, onAddRow, onDeleteRow }) {
  return (
    <div className="time-analysis-grid-shell">
      <div className="time-analysis-grid-actions">
        <span>{getTableSortLabel(sort)}</span>
        <button className="ghost-button" type="button" onClick={onAddRow}>
          <Plus size={15} />
          新增行
        </button>
      </div>
      <div className="time-analysis-grid-scroll">
        <table className="time-analysis-data-grid">
          <thead>
            <tr>
              <th style={{ width: 42 }}>#</th>
              {TIME_ANALYSIS_COLUMNS.map((column) => (
                <SortableTableHeader
                  columnKey={column.key}
                  label={column.label}
                  sort={sort}
                  width={column.width}
                  onSort={onSort}
                  key={column.key}
                />
              ))}
              <SortableTableHeader columnKey="plannedMinutes" label="预计" sort={sort} width={82} onSort={onSort} />
              <SortableTableHeader columnKey="actualMinutes" label="实际" sort={sort} width={82} onSort={onSort} />
              <SortableTableHeader columnKey="diffMinutes" label="差值" sort={sort} width={82} onSort={onSort} />
              <SortableTableHeader columnKey="status" label="状态" sort={sort} width={116} onSort={onSort} />
              <th style={{ width: 52 }} />
            </tr>
          </thead>
          <tbody>
            {records.map((record, index) => (
              <tr key={record.id} className={quality.issuesById[record.id]?.length ? 'time-analysis-row-has-issue' : ''}>
                <td>
                  <div className="time-analysis-row-index">
                    <span>{index + 1}</span>
                    {quality.issuesById[record.id]?.length ? (
                      <b title={quality.issuesById[record.id].map((issue) => issue.label).join('、')}>!</b>
                    ) : null}
                  </div>
                </td>
                {TIME_ANALYSIS_COLUMNS.map((column) => (
                  <td key={column.key}>
                    <input
                      value={record[column.key] || ''}
                      onChange={(event) => onCellChange(record.id, column.key, event.target.value)}
                    />
                  </td>
                ))}
                <td>{Math.round(record.plannedMinutes)}</td>
                <td>{Math.round(record.actualMinutes)}</td>
                <td className={record.diffMinutes > 5 ? 'time-analysis-cell-hot' : record.diffMinutes < -5 ? 'time-analysis-cell-cool' : ''}>
                  {record.diffMinutes}
                </td>
                <td>{record.status}</td>
                <td>
                  <button className="icon-button" type="button" onClick={() => onDeleteRow(record.id)} aria-label="删除行" title="删除行">
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SortableTableHeader({ columnKey, label, sort, width, onSort }) {
  const isActive = sort?.key === columnKey
  const directionLabel = sort?.direction === 'desc' ? '降序' : '升序'

  return (
    <th className={isActive ? 'time-analysis-sort-th time-analysis-sort-th-active' : 'time-analysis-sort-th'} style={{ width }}>
      <button type="button" onClick={() => onSort?.(columnKey)} title={`按${label}${isActive && sort.direction === 'asc' ? '降序' : '升序'}排列`}>
        <span>{label}</span>
        <b>{isActive ? (sort.direction === 'asc' ? '↑' : '↓') : '↕'}</b>
      </button>
      {isActive ? <em>{directionLabel}</em> : null}
    </th>
  )
}

function TrendMetricTabs({ metrics, activeKey, currentPoint, onSelect }) {
  return (
    <div className="time-analysis-trend-metric-tabs" role="tablist" aria-label="趋势指标">
      {metrics.map((metric) => (
        <button
          className={metric.key === activeKey ? 'time-analysis-trend-metric-tab time-analysis-trend-metric-tab-active' : 'time-analysis-trend-metric-tab'}
          type="button"
          role="tab"
          aria-selected={metric.key === activeKey}
          key={metric.key}
          onClick={() => onSelect?.(metric.key)}
          style={{ '--trend-color': metric.color }}
        >
          <span>{metric.label}</span>
          <strong>{formatQuarterTrendValue(metric, currentPoint?.[metric.key])}</strong>
        </button>
      ))}
    </div>
  )
}

function QuarterPlaybackControls({
  isPlaying,
  currentIndex,
  total,
  selectedQuarter,
  onPrevious,
  onNext,
  onToggle,
}) {
  const progress = total > 1 ? ((currentIndex + 1) / total) * 100 : 100

  return (
    <div className={isPlaying ? 'time-analysis-quarter-playback time-analysis-quarter-playback-on' : 'time-analysis-quarter-playback'}>
      <div className="time-analysis-quarter-playback-actions">
        <button className="icon-button" type="button" onClick={onPrevious} aria-label="上一季度" title="上一季度" disabled={total <= 1}>
          <SkipBack size={15} />
        </button>
        <button className="ghost-button time-analysis-play-button" type="button" onClick={onToggle} disabled={total <= 1}>
          {isPlaying ? <Pause size={15} /> : <Play size={15} />}
          {isPlaying ? '暂停回放' : '播放回放'}
        </button>
        <button className="icon-button" type="button" onClick={onNext} aria-label="下一季度" title="下一季度" disabled={total <= 1}>
          <SkipForward size={15} />
        </button>
      </div>
      <div className="time-analysis-quarter-playback-track" aria-label={`季度进度 ${currentIndex + 1}/${total}`}>
        <i style={{ width: `${progress}%` }} />
      </div>
      <span>{selectedQuarter || '暂无季度'} · {total > 0 ? `${currentIndex + 1}/${total}` : '0/0'}</span>
    </div>
  )
}

function LineChart({
  data,
  series,
  activeQuarter,
  onSelectQuarter,
  showAllLabels = false,
  showValueLabel = true,
  showPointLabels = false,
  maxAxisLabels = 8,
}) {
  const width = 680
  const height = 260
  const padding = 34
  const domainBySeries = series.reduce((map, item) => {
    const values = data.map((point) => Number(point[item.key] || 0)).filter(Number.isFinite)
    const rawMin = Math.min(...values, 0)
    const rawMax = Math.max(...values, 0)
    const range = rawMax - rawMin || 1
    const pad = range * 0.12
    return {
      ...map,
      [item.key]: {
        min: rawMin < 0 ? rawMin - pad : 0,
        max: rawMax + pad,
      },
    }
  }, {})
  const xStep = data.length > 1 ? (width - padding * 2) / (data.length - 1) : 1
  const labelStep = showAllLabels ? 1 : Math.max(1, Math.ceil(data.length / maxAxisLabels))
  const primarySeries = series[0]
  const primaryDomain = primarySeries ? domainBySeries[primarySeries.key] : null
  const zeroY = primaryDomain && primaryDomain.min < 0 && primaryDomain.max > 0
    ? height - padding - ((0 - primaryDomain.min) / (primaryDomain.max - primaryDomain.min)) * (height - padding * 2)
    : null

  function pointFor(index, value, key) {
    const x = padding + index * xStep
    const domain = domainBySeries[key] || { min: 0, max: 1 }
    const range = domain.max - domain.min || 1
    const y = height - padding - ((Number(value || 0) - domain.min) / range) * (height - padding * 2)
    return [x, y]
  }

  return (
    <div className="time-analysis-line-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="季度趋势图">
        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} />
        <line x1={padding} y1={padding} x2={padding} y2={height - padding} />
        {zeroY ? <line className="time-analysis-line-zero" x1={padding} y1={zeroY} x2={width - padding} y2={zeroY} /> : null}
        {series.map((line, lineIndex) => {
          const points = data.map((point, index) => pointFor(index, point[line.key], line.key).join(',')).join(' ')
          const activeIndex = data.findIndex((point) => point.quarter === activeQuarter)
          const activePoint = activeIndex >= 0 ? data[activeIndex] : null
          const activePosition = activePoint ? pointFor(activeIndex, activePoint[line.key], line.key) : null
          const labelOffset = lineIndex % 2 === 0 ? -10 - Math.floor(lineIndex / 2) * 10 : 16 + Math.floor(lineIndex / 2) * 10
          return (
            <g key={line.key}>
              <polyline points={points} fill="none" stroke={line.color} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
              {data.map((point, index) => {
                const [x, y] = pointFor(index, point[line.key], line.key)
                return (
                  <g
                    key={`${line.key}-${point.quarter}`}
                    className={point.quarter === activeQuarter ? 'time-analysis-line-point time-analysis-line-point-active' : 'time-analysis-line-point'}
                    role="button"
                    tabIndex="0"
                    onClick={() => onSelectQuarter?.(point.quarter)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') onSelectQuarter?.(point.quarter)
                    }}
                  >
                    <title>{`${point.quarter} ${line.label}: ${formatQuarterTrendValue(line, point[line.key])}`}</title>
                    <circle cx={x} cy={y} r="12" fill="transparent" />
                    <circle cx={x} cy={y} r="4" fill={line.color} />
                    {showPointLabels ? (
                      <text
                        className="time-analysis-line-point-label"
                        x={x}
                        y={Math.max(padding + 8, Math.min(height - padding - 8, y + labelOffset))}
                        textAnchor="middle"
                        style={{ fill: line.color }}
                      >
                        {formatQuarterTrendShortValue(line, point[line.key])}
                      </text>
                    ) : null}
                  </g>
                )
              })}
              {showValueLabel && activePoint && activePosition ? (
                <text
                  className="time-analysis-line-value-label"
                  x={activePosition[0]}
                  y={Math.max(padding + 12, activePosition[1] - 14)}
                  textAnchor="middle"
                >
                  {formatQuarterTrendValue(line, activePoint[line.key])}
                </text>
              ) : null}
            </g>
          )
        })}
        {data.map((point, index) => {
          const shouldShowLabel = point.quarter === activeQuarter || index === 0 || index === data.length - 1 || index % labelStep === 0
          if (!shouldShowLabel) return null
          const [x] = pointFor(index, 0, series[0].key)
          return (
            <text
              key={point.quarter}
              className={point.quarter === activeQuarter ? 'time-analysis-line-label time-analysis-line-label-active' : 'time-analysis-line-label'}
              x={x}
              y={height - 8}
              textAnchor="middle"
              onClick={() => onSelectQuarter?.(point.quarter)}
            >
              {point.quarter}
            </text>
          )
        })}
      </svg>
      <div className="time-analysis-chart-legend">
        {series.map((line) => (
          <span key={line.key}>
            <i style={{ background: line.color }} />
            {line.label}
          </span>
        ))}
      </div>
    </div>
  )
}

function QuarterInsightStrip({
  summary,
  metricInsights,
  quarters,
  selectedQuarter,
  activeBenchmarkQuarter,
  benchmarkOptions,
  resolvedBenchmarkQuarter,
  sameQuarterBenchmark,
  onSelectQuarter,
  onSelectBenchmark,
}) {
  return (
    <div className="time-analysis-trend-controls">
      <div className="time-analysis-quarter-chip-row">
        {quarters.map((quarter) => (
          <button
            className={quarter === selectedQuarter ? 'time-analysis-quarter-chip time-analysis-quarter-chip-active' : 'time-analysis-quarter-chip'}
            type="button"
            key={quarter}
            onClick={() => onSelectQuarter?.(quarter)}
          >
            {quarter}
          </button>
        ))}
      </div>
      <div className="time-analysis-trend-benchmark">
        <span>对比基准</span>
        <div className="time-analysis-trend-benchmark-actions">
          <button
            className={activeBenchmarkQuarter === 'previous' ? 'time-analysis-benchmark-chip time-analysis-benchmark-chip-active' : 'time-analysis-benchmark-chip'}
            type="button"
            onClick={() => onSelectBenchmark?.('previous')}
            disabled={benchmarkOptions.length === 0}
          >
            环比
          </button>
          <button
            className={activeBenchmarkQuarter === sameQuarterBenchmark ? 'time-analysis-benchmark-chip time-analysis-benchmark-chip-active' : 'time-analysis-benchmark-chip'}
            type="button"
            onClick={() => sameQuarterBenchmark && onSelectBenchmark?.(sameQuarterBenchmark)}
            disabled={!sameQuarterBenchmark}
            title={sameQuarterBenchmark ? `同季去年：${sameQuarterBenchmark}` : '没有同季去年数据'}
          >
            同比
          </button>
          <label>
            <em>指定</em>
            <select value={activeBenchmarkQuarter} onChange={(event) => onSelectBenchmark?.(event.target.value)} disabled={benchmarkOptions.length === 0}>
              <option value="previous">上一季度</option>
              {benchmarkOptions.map((quarter) => (
                <option value={quarter} key={quarter}>{quarter}</option>
              ))}
            </select>
          </label>
        </div>
        <strong>{resolvedBenchmarkQuarter ? `当前较 ${resolvedBenchmarkQuarter}` : '暂无可比基准'}</strong>
      </div>
      <div className="time-analysis-trend-insights">
        {metricInsights.items.map((item) => (
          <div className={`time-analysis-trend-insight time-analysis-trend-insight-${item.tone}`} key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <em>{item.meta || (summary.previousQuarter ? `较 ${summary.previousQuarter}` : '暂无基准')}</em>
          </div>
        ))}
      </div>
    </div>
  )
}

function HorizontalBars({ data, total, valueKey, onSelect }) {
  const maxValue = Math.max(1, ...data.map((item) => item[valueKey] || 0))
  return (
    <div className="time-analysis-bars">
      {data.map((item, index) => (
        <button className="time-analysis-bar-row" key={item.label} type="button" onClick={() => onSelect?.(item.label)}>
          <div className="time-analysis-bar-label">
            <strong>{item.label}</strong>
            <span>{item.count} 场 · {formatPercent(total > 0 ? (item[valueKey] / total) * 100 : 0)}</span>
          </div>
          <div className="time-analysis-bar-track">
            <i style={{ width: `${Math.max(4, (item[valueKey] / maxValue) * 100)}%`, background: CHART_COLORS[index % CHART_COLORS.length] }} />
          </div>
          <em>{formatMinutes(item[valueKey])}</em>
        </button>
      ))}
    </div>
  )
}

function DonutLikeBars({ data, total, onSelect }) {
  return (
    <div className="time-analysis-donut-bars">
      {data.map((item, index) => (
        <button key={item.label} className="time-analysis-donut-item" type="button" onClick={() => onSelect?.(item.label)}>
          <span style={{ background: CHART_COLORS[index % CHART_COLORS.length] }} />
          <strong>{item.label}</strong>
          <em>{formatPercent(total > 0 ? (item.actualMinutes / total) * 100 : 0)}</em>
        </button>
      ))}
    </div>
  )
}

function MonthlyBreakdownPanel({ items, activeMonth, onSelect }) {
  const peakMonth = [...items].sort((left, right) => right.actualMinutes - left.actualMinutes)[0]

  return (
    <div className="time-analysis-panel time-analysis-month-panel">
      <PanelHead icon={BarChart3} title="月度拆解" meta={peakMonth ? `峰值 ${peakMonth.label}` : '季度内走势'} />
      <div className="time-analysis-month-list">
        {items.map((item) => (
          <button
            className={activeMonth === item.month ? 'time-analysis-month-card time-analysis-month-card-active' : 'time-analysis-month-card'}
            type="button"
            key={item.month}
            onClick={() => onSelect?.(item.month)}
          >
            <div className="time-analysis-month-head">
              <strong>{item.label}</strong>
              <span>{formatDelta(item.deltaActualMinutes, 'minutes')}</span>
            </div>
            <div className="time-analysis-month-metrics">
              <div>
                <span>日程</span>
                <strong>{item.count}</strong>
              </div>
              <div>
                <span>实际时长</span>
                <strong>{formatMinutes(item.actualMinutes)}</strong>
              </div>
              <div>
                <span>准时率</span>
                <strong>{formatPercent(item.onTimeRate)}</strong>
              </div>
            </div>
            <div className="time-analysis-month-bar">
              <i style={{ width: `${Math.max(4, item.percentOfQuarter)}%` }} />
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

function QuarterCalendarPanel({ calendar, activeDate, onSelect }) {
  return (
    <div className="time-analysis-panel time-analysis-calendar-panel">
      <PanelHead icon={CalendarDays} title="季度日历热力图" meta={calendar.peakDay ? `峰值 ${formatDateLabel(calendar.peakDay.date)}` : '按日期追溯'} />
      <div className="time-analysis-calendar-summary">
        <div>
          <span>最高负荷日</span>
          <strong>{calendar.peakDay ? formatDateLabel(calendar.peakDay.date) : 'N/A'}</strong>
          <em>{calendar.peakDay ? `${calendar.peakDay.count} 场 / ${formatMinutes(calendar.peakDay.actualMinutes)}` : '暂无数据'}</em>
        </div>
        <div>
          <span>有会日期</span>
          <strong>{calendar.activeDayCount}</strong>
          <em>天</em>
        </div>
        <div>
          <span>日均负荷</span>
          <strong>{formatNumber(calendar.averageMinutes, 0)}</strong>
          <em>分钟/有会日</em>
        </div>
      </div>
      <div className="time-analysis-calendar-weekdays">
        {calendar.weekdayLabels.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      <div className="time-analysis-calendar-grid">
        {calendar.slots.map((day, index) => (
          day ? (
            <button
              className={activeDate === day.date ? 'time-analysis-calendar-day time-analysis-calendar-day-active' : 'time-analysis-calendar-day'}
              type="button"
              key={day.date}
              onClick={() => onSelect?.(day.date)}
              style={{ '--calendar-alpha': Math.max(0.08, day.intensity) }}
              aria-label={`${formatDateLabel(day.date)}: ${day.count} 场 / ${formatMinutes(day.actualMinutes)}`}
              title={`${formatDateLabel(day.date)}: ${day.count} 场 / ${formatMinutes(day.actualMinutes)}`}
            >
              <span>{Number(day.date.slice(-2))}</span>
              <strong>{day.count}</strong>
              <em>{formatMinutes(day.actualMinutes)}</em>
            </button>
          ) : (
            <i className="time-analysis-calendar-empty" key={`empty-${index}`} />
          )
        ))}
      </div>
    </div>
  )
}

function TimeRhythmPanel({ rhythm, filters, onSelectWeekday, onSelectHourBucket, onSelectRhythmCell, onClear }) {
  const hasActiveRhythmFilter = filters.weekday !== 'all' || filters.hourBucket !== 'all'

  return (
    <div className="time-analysis-panel time-analysis-rhythm-panel">
      <div className="time-analysis-rhythm-head">
        <PanelHead icon={TrendingUp} title="时间节奏" meta="星期 / 时段 / 排期拥挤度" />
        <button className="ghost-button" type="button" onClick={onClear} disabled={!hasActiveRhythmFilter}>
          清除节奏筛选
        </button>
      </div>
      <div className="time-analysis-rhythm-summary">
        <div>
          <span>最集中星期</span>
          <strong>{rhythm.peakWeekday?.label || 'N/A'}</strong>
          <em>{rhythm.peakWeekday ? `${rhythm.peakWeekday.count} 场 / ${formatMinutes(rhythm.peakWeekday.actualMinutes)}` : '暂无数据'}</em>
        </div>
        <div>
          <span>最集中时段</span>
          <strong>{rhythm.peakBucket?.label || 'N/A'}</strong>
          <em>{rhythm.peakBucket ? `${rhythm.peakBucket.count} 场 / ${rhythm.peakBucket.range}` : '暂无数据'}</em>
        </div>
        <div>
          <span>日均会议负荷</span>
          <strong>{formatNumber(rhythm.dailyAverageMinutes, 0)}</strong>
          <em>分钟/有会工作日</em>
        </div>
      </div>
      <div className="time-analysis-rhythm-layout">
        <div className="time-analysis-rhythm-section">
          <strong>星期分布</strong>
          <div className="time-analysis-weekday-grid">
            {rhythm.weekdays.map((item) => (
              <button
                className={filters.weekday === item.key ? 'time-analysis-weekday-item time-analysis-weekday-item-active' : 'time-analysis-weekday-item'}
                type="button"
                key={item.key}
                onClick={() => onSelectWeekday(item.key)}
              >
                <span>{item.label}</span>
                <b>{item.count}</b>
                <i style={{ height: `${Math.max(4, item.percent)}%` }} />
                <em>{formatMinutes(item.actualMinutes)}</em>
              </button>
            ))}
          </div>
        </div>
        <div className="time-analysis-rhythm-section">
          <strong>时段分布</strong>
          <div className="time-analysis-hour-list">
            {rhythm.hourBuckets.map((item) => (
              <button
                className={filters.hourBucket === item.key ? 'time-analysis-hour-row time-analysis-hour-row-active' : 'time-analysis-hour-row'}
                type="button"
                key={item.key}
                onClick={() => onSelectHourBucket(item.key)}
              >
                <div>
                  <strong>{item.label}</strong>
                  <span>{item.range}</span>
                </div>
                <div className="time-analysis-hour-track">
                  <i style={{ width: `${Math.max(4, item.percent)}%` }} />
                </div>
                <em>{item.count} 场 · {formatPercent(item.percent)}</em>
              </button>
            ))}
          </div>
        </div>
      </div>
      <RhythmHeatmap
        rhythm={rhythm}
        filters={filters}
        onSelectCell={onSelectRhythmCell}
      />
    </div>
  )
}

function RhythmHeatmap({ rhythm, filters, onSelectCell }) {
  return (
    <div className="time-analysis-heatmap-section">
      <div className="time-analysis-heatmap-head">
        <strong>排期热力图</strong>
        <span>颜色越深，实际时长越集中</span>
      </div>
      <div className="time-analysis-heatmap-grid" style={{ '--heatmap-columns': rhythm.hourBuckets.length }}>
        <div className="time-analysis-heatmap-corner" />
        {rhythm.hourBuckets.map((bucket) => (
          <div className="time-analysis-heatmap-axis" key={bucket.key}>
            <strong>{bucket.label}</strong>
            <span>{bucket.range}</span>
          </div>
        ))}
        {rhythm.heatmapRows.map((row) => (
          <FragmentRow
            key={row.key}
            row={row}
            filters={filters}
            onSelectCell={onSelectCell}
          />
        ))}
      </div>
    </div>
  )
}

function FragmentRow({ row, filters, onSelectCell }) {
  return (
    <>
      <div className="time-analysis-heatmap-weekday">{row.label}</div>
      {row.cells.map((cell) => {
        const intensity = Math.max(0.08, cell.intensity)
        const isActive = filters.weekday === cell.weekday && filters.hourBucket === cell.hourBucket
        return (
          <button
            className={isActive ? 'time-analysis-heatmap-cell time-analysis-heatmap-cell-active' : 'time-analysis-heatmap-cell'}
            type="button"
            key={`${cell.weekday}-${cell.hourBucket}`}
            onClick={() => onSelectCell?.(cell.weekday, cell.hourBucket)}
            style={{
              '--heatmap-alpha': intensity,
            }}
            aria-label={`${row.label} ${cell.bucketLabel}: ${cell.count} 场 / ${formatMinutes(cell.actualMinutes)}`}
            title={`${row.label} ${cell.bucketLabel}: ${cell.count} 场 / ${formatMinutes(cell.actualMinutes)}`}
          >
            <strong>{cell.count}</strong>
            <span>{formatMinutes(cell.actualMinutes)}</span>
          </button>
        )
      })}
    </>
  )
}

function StructureDeltaList({ items, dimension, onSelect }) {
  const label = getStructureDimensionLabel(dimension)

  if (items.length === 0) {
    return (
      <div className="time-analysis-empty-state">
        暂无可对比的{label}数据。
      </div>
    )
  }

  return (
    <div className="time-analysis-delta-list">
      {items.slice(0, 8).map((item) => (
        <button className="time-analysis-delta-row" key={item.label} type="button" onClick={() => onSelect?.(item)}>
          <div className="time-analysis-delta-label">
            <strong>{item.label}</strong>
            <span>
              {item.currentCount} 场 / {formatMinutes(item.currentMinutes)}
              {item.previousCount > 0 ? ` · 基准 ${item.previousCount} 场` : ' · 基准无记录'}
            </span>
          </div>
          <div className="time-analysis-delta-bar">
            <i
              className={item.deltaMinutes >= 0 ? 'time-analysis-delta-bar-hot' : 'time-analysis-delta-bar-cool'}
              style={{ width: `${Math.max(6, Math.min(100, Math.abs(item.deltaSharePoint) * 3 + Math.abs(item.deltaMinutes) / Math.max(1, item.maxAbsDeltaMinutes) * 70))}%` }}
            />
          </div>
          <div className={item.deltaMinutes >= 0 ? 'time-analysis-delta-value time-analysis-cell-hot' : 'time-analysis-delta-value time-analysis-cell-cool'}>
            <strong>{formatDelta(item.deltaMinutes, 'minutes')}</strong>
            <span>{formatDelta(item.deltaSharePoint, 'pct')} 占比</span>
          </div>
        </button>
      ))}
    </div>
  )
}

function RankingPanel({ title, items, value, onSelect }) {
  return (
    <div className="time-analysis-panel">
      <PanelHead icon={BarChart3} title={title} meta="Top 6" />
      <div className="time-analysis-ranking-list">
        {items.map((item, index) => (
          <button className="time-analysis-ranking-row" key={item.label} type="button" onClick={() => onSelect?.(item.label)}>
            <span>{index + 1}</span>
            <div>
              <strong>{item.label}</strong>
              <em>{item.count} 场 · {item.recommendation}</em>
            </div>
            <b>{value(item)}</b>
          </button>
        ))}
      </div>
    </div>
  )
}

function ScheduleActionPanel({ actions, impact, onSelect }) {
  return (
    <div className="time-analysis-panel time-analysis-action-panel">
      <PanelHead icon={Sparkles} title="排期优化行动" meta={`${actions.length} 个建议`} />
      <div className="time-analysis-action-impact-grid">
        <KpiCard label="可释放时长" value={formatNumber(impact.releaseMinutes, 0)} unit="分钟" accent="green" />
        <KpiCard label="建议预留 buffer" value={formatNumber(impact.bufferMinutes, 0)} unit="分钟" accent="orange" />
        <KpiCard label="拆分候选" value={formatNumber(impact.splitMinutes, 0)} unit="分钟" accent="blue" />
        <KpiCard label="需稳定对象" value={impact.stabilizeCount} unit="个" accent="purple" />
      </div>
      {actions.length > 0 ? (
        <div className="time-analysis-action-list">
          {actions.map((action) => (
            <button className={`time-analysis-action-card time-analysis-action-${action.tone}`} type="button" key={`${action.kind}-${action.label}`} onClick={() => onSelect?.(action.label)}>
              <div className="time-analysis-action-head">
                <span>{action.badge}</span>
                <strong>{action.label}</strong>
              </div>
              <p>{action.advice}</p>
              <div className="time-analysis-action-metrics">
                <span>{action.count} 场</span>
                <span>均长 {formatNumber(action.avgActual)} 分钟</span>
                <span>{action.impact}</span>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="time-analysis-empty-state">当前筛选下没有足够重复样本生成排期行动。</div>
      )}
    </div>
  )
}

function ScheduleSimulationPanel({ simulation, assumptions, onChange }) {
  return (
    <div className="time-analysis-panel time-analysis-simulation-panel">
      <PanelHead icon={TrendingUp} title="下季度方案模拟" meta="可调参数" />
      <div className="time-analysis-simulation-grid">
        <KpiCard label="当前规划时长" value={formatNumber(simulation.currentPlannedMinutes, 0)} unit="分钟" accent="blue" />
        <KpiCard label="调整后规划时长" value={formatNumber(simulation.adjustedPlannedMinutes, 0)} unit="分钟" accent="green" />
        <KpiCard label="预计实际负荷" value={formatNumber(simulation.projectedActualMinutes, 0)} unit="分钟" accent="orange" />
        <KpiCard label="预计差值率" value={formatPercent(simulation.projectedDiffPercent)} unit="" accent="purple" />
      </div>
      <div className="time-analysis-simulation-controls">
        <SimulationSlider
          label="缩短执行率"
          value={assumptions.shortenRate}
          min={0}
          max={100}
          step={5}
          suffix="%"
          onChange={(value) => onChange('shortenRate', value)}
        />
        <SimulationSlider
          label="buffer 执行率"
          value={assumptions.bufferRate}
          min={0}
          max={150}
          step={5}
          suffix="%"
          onChange={(value) => onChange('bufferRate', value)}
        />
        <SimulationSlider
          label="实际负荷变化"
          value={assumptions.actualLoadChange}
          min={-30}
          max={30}
          step={5}
          suffix="%"
          signed
          onChange={(value) => onChange('actualLoadChange', value)}
        />
      </div>
      <div className="time-analysis-simulation-note">
        <strong>{simulation.projectedDiffMinutes > 0 ? '仍有超时压力' : '计划容量可覆盖'}</strong>
        <span>当前假设下，调整后预计净差值为 {formatDelta(simulation.projectedDiffMinutes, 'minutes')}，计划盘子较当前 {formatDelta(simulation.plannedDelta, 'minutes')}。</span>
      </div>
      <div className="time-analysis-simulation-steps">
        <span>缩短动作释放 {formatMinutes(simulation.appliedReleaseMinutes)}</span>
        <span>buffer 动作增加 {formatMinutes(simulation.appliedBufferMinutes)}</span>
        <span>拆分候选累计 {formatMinutes(simulation.splitMinutes)}</span>
        <span>稳定对象 {simulation.stabilizeCount} 个</span>
      </div>
    </div>
  )
}

function BriefingPanel({ cards, onSelect }) {
  return (
    <div className="time-analysis-panel time-analysis-briefing-panel">
      <PanelHead icon={Sparkles} title="汇报叙事" meta={`${cards.length} 条主线`} />
      <div className="time-analysis-briefing-grid">
        {cards.map((card) => (
          <button
            className={`time-analysis-briefing-card time-analysis-briefing-${card.tone}`}
            type="button"
            key={card.title}
            onClick={() => onSelect?.(card)}
            disabled={!card.filter}
          >
            <span>{card.kicker}</span>
            <strong>{card.title}</strong>
            <p>{card.body}</p>
            <em>{card.evidence}</em>
          </button>
        ))}
      </div>
    </div>
  )
}

function SimulationSlider({ label, value, min, max, step, suffix, signed = false, onChange }) {
  const displayValue = signed && value > 0 ? `+${value}${suffix}` : `${value}${suffix}`

  return (
    <label className="time-analysis-simulation-slider">
      <span>
        <b>{label}</b>
        <em>{displayValue}</em>
      </span>
      <div className="time-analysis-simulation-slider-control">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <input
          aria-label={`${label}数值`}
          className="time-analysis-simulation-number"
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      </div>
    </label>
  )
}

function SeriesDrawer({ analysis, records, onClose }) {
  return (
    <div className="time-analysis-panel time-analysis-series-panel">
      <div className="time-analysis-series-head">
        <div>
          <span>会议钻取</span>
          <strong>{analysis.label}</strong>
        </div>
        <button className="ghost-button" type="button" onClick={onClose}>收起</button>
      </div>
      <div className="time-analysis-series-metrics">
        <KpiCard label="出现次数" value={analysis.count} unit="场" accent="blue" />
        <KpiCard label="累计时长" value={formatNumber(analysis.actualMinutes, 0)} unit="分钟" accent="green" />
        <KpiCard label="平均偏差" value={formatNumber(analysis.avgDiff)} unit="分钟/场" accent={analysis.avgDiff > 0 ? 'orange' : 'green'} />
        <KpiCard label="离散系数" value={formatPercent(analysis.cv * 100)} accent="purple" />
      </div>
      <p className="time-analysis-series-advice">{analysis.recommendation}</p>
      <div className="time-analysis-series-table-wrap">
        <table className="time-analysis-series-table">
          <thead>
            <tr>
              <th>日期</th>
              <th>类型</th>
              <th>地点</th>
              <th>预计</th>
              <th>实际</th>
              <th>差值</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {records.map((record) => (
              <tr key={record.id}>
                <td>{record.date}</td>
                <td>{record.meetingType}</td>
                <td>{record.locationType}</td>
                <td>{record.plannedStart}-{record.plannedEnd}</td>
                <td>{record.actualStart}-{record.actualEnd}</td>
                <td>{record.diffMinutes}</td>
                <td>{record.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function readStoredRecords() {
  const stored = readJson(STORAGE_KEY, null)
  if (IS_PUBLIC_EMPTY_BUILD) return Array.isArray(stored) ? stored : []

  const bundledRecords = parsePastedMeetings(TIME_RECORD_V1_CSV)
  if (Array.isArray(stored) && stored.length > 0) {
    const normalizedStored = stored.map((record, index) => ({
      ...record,
      id: record.id || `stored-time-record-${index}`,
    }))
    return mergeImportedTimeRecords(normalizedStored, bundledRecords, 'time-record-v1-final')
  }
  return mergeImportedTimeRecords(parseSampleRecords(), bundledRecords, 'time-record-v1-final')
}

function readStoredTrackedGroups() {
  const stored = readJson(TRACKED_GROUPS_STORAGE_KEY, null)
  if (!Array.isArray(stored) || stored.length === 0) return DEFAULT_TRACKED_MEETING_GROUPS
  const defaultGroupIds = new Set(DEFAULT_TRACKED_MEETING_GROUPS.map((group) => group.id))
  const normalized = stored
    .map(normalizeTrackedGroup)
    .filter((group) => group.id && group.label)
  const defaultGroups = DEFAULT_TRACKED_MEETING_GROUPS.map((defaultGroup) => {
    const storedGroup = normalized.find((group) => group.id === defaultGroup.id)
    if (!storedGroup) return defaultGroup
    return {
      ...defaultGroup,
      label: storedGroup.label || defaultGroup.label,
      meetingType: storedGroup.meetingType || defaultGroup.meetingType,
      terms: storedGroup.terms.length > 0 ? storedGroup.terms : defaultGroup.terms,
      excludeTerms: storedGroup.excludeTerms,
      locked: true,
    }
  })
  const customGroups = normalized.filter((group) => !defaultGroupIds.has(group.id))
  return [...defaultGroups, ...customGroups]
}

function normalizeTrackedGroup(group) {
  if (!group || typeof group !== 'object') {
    return {
      id: '',
      label: '',
      meetingType: '',
      terms: [],
      excludeTerms: [],
      matchMode: 'any',
      locked: false,
    }
  }

  return {
    id: group.id || `tracked-${crypto.randomUUID()}`,
    label: String(group.label || '').trim(),
    meetingType: String(group.meetingType || '').trim(),
    terms: Array.isArray(group.terms) ? group.terms.map(String).filter(Boolean) : splitTerms(group.keywords),
    excludeTerms: Array.isArray(group.excludeTerms) ? group.excludeTerms.map(String).filter(Boolean) : [],
    matchMode: group.matchMode || 'any',
    locked: Boolean(group.locked),
  }
}

function readStoredFilters() {
  return readJson(FILTER_STORAGE_KEY, {})
}

function readStoredSavedViews() {
  const stored = readJson(SAVED_VIEWS_STORAGE_KEY, [])
  if (!Array.isArray(stored)) return []
  return stored
    .filter((item) => item?.id && item?.filters)
    .slice(0, 8)
}

function readJson(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function persistJson(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // localStorage may be unavailable in private or restricted contexts.
  }
}

function splitTerms(value) {
  return String(value || '')
    .split(/[,，、\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function buildTrackedMeetingReports(records, groups) {
  if (!Array.isArray(groups) || groups.length === 0) return []

  const matchedRecordIds = new Set()
  const normalizedGroups = groups.map(normalizeTrackedGroup).filter((group) => group.id && group.label)
  const reportGroups = normalizedGroups.filter((group) => group.matchMode !== 'other')
  const reports = reportGroups.map((group) => {
    const items = records.filter((record) => matchesTrackedGroup(record, group))
    items.forEach((record) => matchedRecordIds.add(record.id))
    return buildTrackedMeetingReport(group, items)
  })
  const otherGroup = normalizedGroups.find((group) => group.matchMode === 'other') || DEFAULT_TRACKED_MEETING_GROUPS.at(-1)
  if (!otherGroup || otherGroup.matchMode !== 'other') return reports
  const otherItems = records.filter((record) => {
    if (matchedRecordIds.has(record.id)) return false
    return !otherGroup.meetingType || record.meetingType === otherGroup.meetingType
  })
  return [...reports, buildTrackedMeetingReport(otherGroup, otherItems)]
}

function matchesTrackedGroup(record, group) {
  if (group.meetingType && record.meetingType !== group.meetingType) return false
  const haystack = `${record.title || ''} ${record.seriesName || ''}`.toLowerCase()
  const excludeTerms = Array.isArray(group.excludeTerms) ? group.excludeTerms.filter(Boolean) : []
  if (excludeTerms.some((term) => haystack.includes(String(term).toLowerCase()))) return false
  const terms = Array.isArray(group.terms) ? group.terms.filter(Boolean) : []
  if (terms.length === 0) return false
  if (group.matchMode === 'listed') {
    return terms.some((term) => matchesTrackedTerm(record, term))
  }
  if (group.matchMode === 'all') {
    return terms.every((term) => haystack.includes(String(term).toLowerCase()))
  }
  return terms.some((term) => haystack.includes(String(term).toLowerCase()))
}

function matchesTrackedTerm(record, term) {
  const normalizedTerm = normalizeTrackedText(term)
  if (!normalizedTerm) return false
  return [record.seriesName, record.title]
    .map(normalizeTrackedText)
    .some((value) => value === normalizedTerm)
}

function normalizeTrackedText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase()
}

function buildTrackedMeetingReport(group, items) {
  const count = items.length
  const actualMinutes = sumRecords(items, 'actualMinutes')
  const plannedMinutes = sumRecords(items, 'plannedMinutes')
  const avgActual = count > 0 ? actualMinutes / count : 0
  const avgDiff = count > 0 ? sumRecords(items, 'absDiffMinutes') / count : 0
  const stdDev = calculateStandardDeviation(items.map((item) => item.diffMinutes))
  const cv = avgActual > 0 ? stdDev / avgActual : 0
  const series = buildTrackedSeriesRows(items, group)

  return {
    id: group.id,
    label: group.label,
    matchText: group.matchMode === 'other'
      ? `${group.meetingType ? `${group.meetingType} · ` : ''}未命中上方分类的会议`
      : `${group.meetingType ? `${group.meetingType} · ` : ''}${group.terms.join(group.matchMode === 'all' ? ' + ' : ' / ')}`,
    count,
    plannedMinutes,
    actualMinutes,
    avgActual,
    avgDiff,
    stdDev,
    cv,
    series,
    advice: buildTrackedMeetingAdvice({ count, avgDiff, stdDev, cv }),
  }
}

function buildTrackedSeriesRows(items, group) {
  if (group?.matchMode === 'listed' && Array.isArray(group.terms)) {
    return group.terms.map((term) => buildTrackedSeriesRow(
      term,
      items.filter((record) => matchesTrackedTerm(record, term)),
    ))
  }
  const map = new Map()
  items.forEach((record) => {
    const label = record.seriesName || record.title || '未命名会议'
    const current = map.get(label) || {
      label,
      count: 0,
      actualMinutes: 0,
      plannedMinutes: 0,
      diffMinutes: 0,
      absDiffMinutes: 0,
      diffValues: [],
      plannedValues: [],
      statusCounts: {},
    }
    current.count += 1
    current.actualMinutes += Number(record.actualMinutes || 0)
    current.plannedMinutes += Number(record.plannedMinutes || 0)
    current.diffMinutes += Number(record.diffMinutes || 0)
    current.absDiffMinutes += Number(record.absDiffMinutes || Math.abs(record.diffMinutes || 0))
    current.diffValues.push(Number(record.diffMinutes || 0))
    current.plannedValues.push(Number(record.plannedMinutes || 0))
    current.statusCounts[record.statusKey] = (current.statusCounts[record.statusKey] || 0) + 1
    map.set(label, current)
  })

  return Array.from(map.values())
    .map((item) => buildTrackedSeriesRow(item.label, [], item))
    .sort((left, right) => right.actualMinutes - left.actualMinutes)
}

function buildTrackedSeriesRow(label, records, existingItem = null) {
  const item = existingItem || records.reduce((current, record) => {
    current.count += 1
    current.actualMinutes += Number(record.actualMinutes || 0)
    current.plannedMinutes += Number(record.plannedMinutes || 0)
    current.diffMinutes += Number(record.diffMinutes || 0)
    current.absDiffMinutes += Number(record.absDiffMinutes || Math.abs(record.diffMinutes || 0))
    current.diffValues.push(Number(record.diffMinutes || 0))
    current.plannedValues.push(Number(record.plannedMinutes || 0))
    current.statusCounts[record.statusKey] = (current.statusCounts[record.statusKey] || 0) + 1
    return current
  }, {
    label,
    count: 0,
    actualMinutes: 0,
    plannedMinutes: 0,
    diffMinutes: 0,
    absDiffMinutes: 0,
    diffValues: [],
    plannedValues: [],
    statusCounts: {},
  })
  const avgActual = item.count > 0 ? item.actualMinutes / item.count : 0
  const stdDev = calculateStandardDeviation(item.diffValues)
  return {
    ...item,
    label,
    avgActual,
    diffMinutes: item.absDiffMinutes,
    avgDiff: item.count > 0 ? item.absDiffMinutes / item.count : 0,
    plannedStandard: DEFAULT_TRACKED_PLANNED_MINUTES[label] ?? mostFrequentNumber(item.plannedValues),
    stdDev,
    cv: avgActual > 0 ? stdDev / avgActual : 0,
    statusStats: buildStatusStats(item.statusCounts, item.count),
  }
}

function buildEmptySeriesRow() {
  return {
    label: '暂无明细',
    count: 0,
    plannedStandard: 0,
    actualMinutes: 0,
    avgActual: 0,
    diffMinutes: 0,
    avgDiff: 0,
    stdDev: 0,
    cv: 0,
    statusStats: buildStatusStats({}, 0),
  }
}

function buildStatusStats(statusCounts, total) {
  return STATUS_RULES.reduce((accumulator, status) => ({
    ...accumulator,
    [status.key]: {
      count: statusCounts[status.key] || 0,
      percent: total > 0 ? ((statusCounts[status.key] || 0) / total) * 100 : 0,
    },
  }), {})
}

function mostFrequentNumber(values) {
  const counts = new Map()
  values
    .map(Number)
    .filter(Number.isFinite)
    .forEach((value) => counts.set(value, (counts.get(value) || 0) + 1))
  if (counts.size === 0) return 0
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || right[0] - left[0])[0][0]
}

function buildTrackedMeetingAdvice({ count, avgDiff, stdDev, cv }) {
  if (count === 0) return '本季度没有命中明细，先确认关键词是否覆盖会议名称。'
  if (count < 3) return '样本较少，先继续记录，不急着调整规划时长。'
  if (cv >= 0.35) return `波动很高，标准差 ${formatNumber(stdDev)} 分钟；建议按议题复杂度拆分或单独预留缓冲。`
  if (cv >= 0.2) return `波动偏高，标准差 ${formatNumber(stdDev)} 分钟；建议复盘超时场次，必要时增加 15 分钟缓冲。`
  if (avgDiff > 15) return `整体偏超时，平均超出 ${formatNumber(avgDiff)} 分钟；建议上调默认规划时长。`
  if (avgDiff < -15) return `整体偏早结束，平均提前 ${formatNumber(Math.abs(avgDiff))} 分钟；可考虑压缩默认规划时长。`
  return '时长相对稳定，当前规划基本可沿用。'
}

function calculateStandardDeviation(values) {
  const usableValues = values.map(Number).filter(Number.isFinite)
  if (usableValues.length <= 1) return 0
  const avg = usableValues.reduce((total, value) => total + value, 0) / usableValues.length
  const variance = usableValues.reduce((total, value) => total + (value - avg) ** 2, 0) / (usableValues.length - 1)
  return Math.sqrt(variance)
}

function serializeRecords(records) {
  const header = [
    ...TIME_ANALYSIS_COLUMNS.map((column) => column.label),
    '季度',
    '预计用时',
    '实际用时',
    '差值',
    '会议状态',
  ]
  const rows = records.map((record) => [
    record.date,
    record.meetingType,
    record.title,
    record.locationType,
    record.plannedStart,
    record.plannedEnd,
    record.actualStart,
    record.actualEnd,
    record.remark,
    record.quarter,
    Math.round(record.plannedMinutes),
    Math.round(record.actualMinutes),
    record.diffMinutes,
    record.status,
  ])
  return [header, ...rows].map((row) => row.join('\t')).join('\n')
}

function downloadText(filename, content) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function getBenchmarkQuarterOptions(trend, selectedQuarter) {
  const selectedIndex = trend.findIndex((item) => item.quarter === selectedQuarter)
  const endIndex = selectedIndex >= 0 ? selectedIndex : trend.length - 1
  return trend
    .slice(0, Math.max(0, endIndex))
    .map((item) => item.quarter)
}

function getSameQuarterLastYear(selectedQuarter, benchmarkOptions) {
  const match = String(selectedQuarter || '').match(/^(\d{2})Q([1-4])$/)
  if (!match) return ''
  const previousYearQuarter = `${String(Number(match[1]) - 1).padStart(2, '0')}Q${match[2]}`
  return benchmarkOptions.includes(previousYearQuarter) ? previousYearQuarter : ''
}

function buildTrendMetricInsights(trend, selectedQuarter, benchmarkQuarter, metric) {
  const current = trend.find((item) => item.quarter === selectedQuarter) || trend.at(-1)
  const benchmark = trend.find((item) => item.quarter === benchmarkQuarter)
  const ranked = [...trend]
    .filter((item) => Number.isFinite(Number(item[metric.key])))
    .sort((left, right) => Number(right[metric.key] || 0) - Number(left[metric.key] || 0))
  const peak = ranked[0]
  const low = ranked.at(-1)
  const currentValue = Number(current?.[metric.key] || 0)
  const benchmarkValue = Number(benchmark?.[metric.key] || 0)
  const delta = benchmark ? currentValue - benchmarkValue : 0

  return {
    items: [
      {
        label: '当前季度',
        value: formatQuarterTrendValue(metric, currentValue),
        meta: current?.quarter || selectedQuarter || '暂无',
        tone: 'neutral',
      },
      {
        label: '较基准',
        value: benchmark ? formatTrendMetricDelta(delta, metric) : '暂无',
        meta: benchmark ? `较 ${benchmark.quarter}` : '暂无基准',
        tone: benchmark ? getTrendDeltaTone(delta, metric) : 'neutral',
      },
      {
        label: '区间高点',
        value: peak ? formatQuarterTrendValue(metric, peak[metric.key]) : '暂无',
        meta: peak?.quarter || '暂无',
        tone: 'hot',
      },
      {
        label: '区间低点',
        value: low ? formatQuarterTrendValue(metric, low[metric.key]) : '暂无',
        meta: low?.quarter || '暂无',
        tone: 'cool',
      },
    ],
  }
}

function buildComparisonRows(trend, selectedQuarter, benchmarkQuarter) {
  const selectedIndex = Math.max(0, trend.findIndex((item) => item.quarter === selectedQuarter))
  const start = Math.max(0, (selectedIndex >= 0 ? selectedIndex : trend.length - 1) - 4)
  const visible = trend.slice(start, Math.max(start + 1, selectedIndex + 1 || trend.length))
  const current = visible.find((item) => item.quarter === selectedQuarter) || visible.at(-1)
  const benchmark = trend.find((item) => item.quarter === benchmarkQuarter)
  const metrics = [
    { key: 'count', label: '日程数量', format: (value) => `${Math.round(value)} 个` },
    { key: 'plannedMinutes', label: '规划时长', format: (value) => `${Math.round(value)} 分钟` },
    { key: 'actualMinutes', label: '实际时长', format: (value) => `${Math.round(value)} 分钟` },
    { key: 'absDiffMinutes', label: '累计偏差', format: (value) => `${Math.round(value)} 分钟` },
    { key: 'onTimeRate', label: '准时率', format: (value) => formatPercent(value) },
  ]

  return {
    quarters: visible.map((item) => item.quarter),
    benchmarkQuarter: benchmark?.quarter || '',
    rows: metrics.map((metric) => {
      const deltaValue = benchmark && current ? Number(current[metric.key] || 0) - Number(benchmark[metric.key] || 0) : 0
      return {
        label: metric.label,
        values: visible.map((item) => ({ quarter: item.quarter, value: metric.format(item[metric.key] || 0) })),
        deltaValue,
        delta: benchmark ? formatDelta(deltaValue, metric.key === 'onTimeRate' ? 'pct' : '') : 'N/A',
      }
    }),
  }
}

function buildQuarterSummary(trend, selectedQuarter, benchmarkQuarter) {
  const selectedIndex = trend.findIndex((item) => item.quarter === selectedQuarter)
  const current = selectedIndex >= 0 ? trend[selectedIndex] : trend.at(-1)
  const previous = trend.find((item) => item.quarter === benchmarkQuarter) || null
  const countDelta = current && previous ? Number(current.count || 0) - Number(previous.count || 0) : 0
  const actualDelta = current && previous ? Number(current.actualMinutes || 0) - Number(previous.actualMinutes || 0) : 0
  const onTimeDelta = current && previous ? Number(current.onTimeRate || 0) - Number(previous.onTimeRate || 0) : 0

  return {
    currentQuarter: current?.quarter || selectedQuarter || '',
    previousQuarter: previous?.quarter || '',
    countDelta,
    actualDelta,
    onTimeDelta,
    countDeltaText: previous ? formatDelta(countDelta, 'count') : 'N/A',
    actualDeltaText: previous ? formatDelta(actualDelta, 'minutes') : 'N/A',
    onTimeDeltaText: previous ? formatDelta(onTimeDelta, 'pct') : 'N/A',
  }
}

function getStructureDimensionConfig(key) {
  return STRUCTURE_DIMENSIONS.find((item) => item.key === key) || STRUCTURE_DIMENSIONS[0]
}

function getStructureDimensionLabel(key, mode = 'label') {
  const config = getStructureDimensionConfig(key)
  return mode === 'short' ? config.shortLabel : config.label
}

function groupStructureSummary(records, config) {
  const map = new Map()
  records.forEach((record) => {
    const group = config.getGroup(record)
    const label = group.label || '未分类'
    const current = map.get(label) || {
      label,
      filterValue: group.value || label,
      count: 0,
      plannedMinutes: 0,
      actualMinutes: 0,
      absDiffMinutes: 0,
    }
    current.count += 1
    current.plannedMinutes += record.plannedMinutes
    current.actualMinutes += record.actualMinutes
    current.absDiffMinutes += record.absDiffMinutes
    map.set(label, current)
  })

  return Array.from(map.values()).sort((left, right) => right.actualMinutes - left.actualMinutes)
}

function buildStructureDeltas(currentRecords, previousRecords, dimension) {
  const config = getStructureDimensionConfig(dimension)
  const current = groupStructureSummary(currentRecords, config)
  const previous = groupStructureSummary(previousRecords, config)
  const currentTotal = current.reduce((total, item) => total + item.actualMinutes, 0)
  const previousTotal = previous.reduce((total, item) => total + item.actualMinutes, 0)
  const labels = Array.from(new Set([...current.map((item) => item.label), ...previous.map((item) => item.label)]))
  const rows = labels.map((label) => {
    const currentItem = current.find((item) => item.label === label) || { count: 0, actualMinutes: 0 }
    const previousItem = previous.find((item) => item.label === label) || { count: 0, actualMinutes: 0 }
    const currentShare = currentTotal > 0 ? (currentItem.actualMinutes / currentTotal) * 100 : 0
    const previousShare = previousTotal > 0 ? (previousItem.actualMinutes / previousTotal) * 100 : 0

    return {
      label,
      filterKey: config.filterKey,
      filterValue: currentItem.filterValue || previousItem.filterValue || label,
      currentCount: currentItem.count,
      previousCount: previousItem.count,
      currentMinutes: currentItem.actualMinutes,
      previousMinutes: previousItem.actualMinutes,
      deltaCount: currentItem.count - previousItem.count,
      deltaMinutes: currentItem.actualMinutes - previousItem.actualMinutes,
      currentShare,
      previousShare,
      deltaSharePoint: currentShare - previousShare,
    }
  })
  const maxAbsDeltaMinutes = Math.max(1, ...rows.map((item) => Math.abs(item.deltaMinutes)))

  return rows
    .map((item) => ({ ...item, maxAbsDeltaMinutes }))
    .sort((left, right) => Math.abs(right.deltaMinutes) + Math.abs(right.deltaSharePoint) * 25 - (Math.abs(left.deltaMinutes) + Math.abs(left.deltaSharePoint) * 25))
}

function buildMonthlyBreakdown(records) {
  const months = getUniqueOptions(records, 'month')
  const rows = months.map((month, index) => {
    const items = records.filter((record) => record.month === month)
    const overview = calculateOverview(items)
    const previous = index > 0 ? records.filter((record) => record.month === months[index - 1]) : []
    const previousOverview = calculateOverview(previous)

    return {
      month,
      label: formatMonthLabel(month),
      ...overview,
      deltaActualMinutes: index > 0 ? overview.actualMinutes - previousOverview.actualMinutes : 0,
    }
  })
  const totalActual = rows.reduce((total, item) => total + item.actualMinutes, 0)
  return rows.map((item) => ({
    ...item,
    percentOfQuarter: totalActual > 0 ? (item.actualMinutes / totalActual) * 100 : 0,
  }))
}

function buildQuarterCalendar(records, selectedQuarter) {
  const quarterRange = getQuarterDateRange(selectedQuarter)
  const days = quarterRange.length > 0
    ? quarterRange
    : getUniqueOptions(records, 'date').map((date) => ({ date }))
  const rows = days.map(({ date }) => {
    const items = records.filter((record) => record.date === date)
    const actualMinutes = items.reduce((total, record) => total + record.actualMinutes, 0)
    return {
      date,
      count: items.length,
      actualMinutes,
    }
  })
  const maxMinutes = Math.max(1, ...rows.map((day) => day.actualMinutes))
  const normalizedRows = rows.map((day) => ({
    ...day,
    intensity: day.actualMinutes > 0 ? day.actualMinutes / maxMinutes : 0,
  }))
  const firstWeekday = normalizedRows[0] ? getWeekdayOffset(normalizedRows[0].date) : 0
  const slots = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...normalizedRows,
  ]
  const activeDays = normalizedRows.filter((day) => day.count > 0)
  const peakDay = [...activeDays].sort((left, right) => right.actualMinutes - left.actualMinutes)[0] || null
  const totalMinutes = activeDays.reduce((total, day) => total + day.actualMinutes, 0)

  return {
    weekdayLabels: WEEKDAY_OPTIONS.map((item) => item.label.replace('周', '')),
    days: normalizedRows,
    slots,
    peakDay,
    activeDayCount: activeDays.length,
    averageMinutes: activeDays.length > 0 ? totalMinutes / activeDays.length : 0,
  }
}

function buildRhythmInsights(records) {
  const totalCount = records.length
  const totalMinutes = records.reduce((total, record) => total + record.actualMinutes, 0)
  const activeDates = new Set(records.map((record) => record.date).filter(Boolean))
  const weekdays = WEEKDAY_OPTIONS.map((option) => {
    const items = records.filter((record) => getRecordWeekdayKey(record) === option.key)
    const actualMinutes = items.reduce((total, record) => total + record.actualMinutes, 0)
    return {
      ...option,
      count: items.length,
      actualMinutes,
      percent: totalCount > 0 ? (items.length / totalCount) * 100 : 0,
    }
  })
  const hourBuckets = HOUR_BUCKETS.map((bucket) => {
    const items = records.filter((record) => getRecordHourBucketKey(record) === bucket.key)
    const actualMinutes = items.reduce((total, record) => total + record.actualMinutes, 0)
    return {
      ...bucket,
      count: items.length,
      actualMinutes,
      percent: totalCount > 0 ? (items.length / totalCount) * 100 : 0,
    }
  })
  const heatmapRawRows = WEEKDAY_OPTIONS.map((weekday) => ({
    ...weekday,
    cells: HOUR_BUCKETS.map((bucket) => {
      const items = records.filter(
        (record) => getRecordWeekdayKey(record) === weekday.key && getRecordHourBucketKey(record) === bucket.key,
      )
      return {
        weekday: weekday.key,
        hourBucket: bucket.key,
        bucketLabel: bucket.label,
        bucketRange: bucket.range,
        count: items.length,
        actualMinutes: items.reduce((total, record) => total + record.actualMinutes, 0),
      }
    }),
  }))
  const heatmapMaxMinutes = Math.max(1, ...heatmapRawRows.flatMap((row) => row.cells.map((cell) => cell.actualMinutes)))
  const heatmapRows = heatmapRawRows.map((row) => ({
    ...row,
    cells: row.cells.map((cell) => ({
      ...cell,
      intensity: cell.actualMinutes > 0 ? cell.actualMinutes / heatmapMaxMinutes : 0,
    })),
  }))
  const peakWeekday = [...weekdays].sort((left, right) => right.actualMinutes - left.actualMinutes)[0]
  const peakBucket = [...hourBuckets].sort((left, right) => right.actualMinutes - left.actualMinutes)[0]

  return {
    totalCount,
    totalMinutes,
    dailyAverageMinutes: activeDates.size > 0 ? totalMinutes / activeDates.size : 0,
    peakWeekday: peakWeekday?.count > 0 ? peakWeekday : null,
    peakBucket: peakBucket?.count > 0 ? peakBucket : null,
    weekdays,
    hourBuckets,
    heatmapRows,
  }
}

function buildScheduleActions(seriesAnalysis) {
  const candidates = seriesAnalysis
    .map((item) => {
      const earlyMinutes = Math.max(0, -item.avgDiff)
      const overMinutes = Math.max(0, item.avgDiff)
      const unstableScore = item.cv * item.avgActual
      const heavyScore = item.actualMinutes / Math.max(1, item.count)

      if (earlyMinutes >= 10 && item.count >= 3) {
        const saving = Math.round(Math.min(earlyMinutes, item.avgActual * 0.28) * item.count)
        return {
          ...item,
          kind: 'shorten',
          tone: 'cool',
          badge: '缩短',
          impactMinutes: saving,
          score: saving + item.count * 3,
          impact: `可释放约 ${formatMinutes(saving)}`,
          advice: `连续偏早结束，建议下季度将默认计划时长下调 ${Math.round(Math.min(earlyMinutes, 30))} 分钟，并观察是否影响议题完整度。`,
        }
      }

      if (overMinutes >= 8) {
        const buffer = Math.round(Math.min(Math.max(10, overMinutes), 30))
        return {
          ...item,
          kind: 'buffer',
          tone: 'hot',
          badge: '加 buffer',
          impactMinutes: buffer * item.count,
          score: overMinutes * item.count + item.absDiffMinutes * 0.2,
          impact: `建议预留 ${buffer} 分钟`,
          advice: `平均超时较明显，建议预留 ${buffer} 分钟 buffer，或提前拆出决策/同步议题。`,
        }
      }

      if (item.cv >= 0.35 && item.count >= 3) {
        return {
          ...item,
          kind: 'stabilize',
          tone: 'purple',
          badge: '稳定',
          impactMinutes: 0,
          score: unstableScore * item.count,
          impact: `离散系数 ${formatPercent(item.cv * 100)}`,
          advice: '时长波动偏高，建议固定议题模板、明确输入材料截止时间，并把临时议题移到会后跟进。',
        }
      }

      if (item.actualMinutes >= 600 || heavyScore >= 90) {
        return {
          ...item,
          kind: 'split',
          tone: 'green',
          badge: '拆分',
          impactMinutes: item.actualMinutes,
          score: item.actualMinutes,
          impact: `累计 ${formatMinutes(item.actualMinutes)}`,
          advice: '累计占用较高，建议评估是否拆成决策会和信息同步，或按参会人层级分层同步。',
        }
      }

      return null
    })
    .filter(Boolean)
    .sort((left, right) => right.score - left.score)

  const selected = []
  const usedLabels = new Set()
  const preferredKinds = ['buffer', 'shorten', 'stabilize', 'split']

  preferredKinds.forEach((kind) => {
    const next = candidates.find((item) => item.kind === kind && !usedLabels.has(item.label))
    if (next) {
      selected.push(next)
      usedLabels.add(next.label)
    }
  })

  candidates.forEach((item) => {
    if (selected.length >= 8 || usedLabels.has(item.label)) return
    selected.push(item)
    usedLabels.add(item.label)
  })

  return selected
    .slice(0, 8)
}

function buildScheduleImpact(actions) {
  return actions.reduce((impact, action) => {
    if (action.kind === 'shorten') {
      impact.releaseMinutes += action.impactMinutes || 0
    } else if (action.kind === 'buffer') {
      impact.bufferMinutes += action.impactMinutes || 0
    } else if (action.kind === 'split') {
      impact.splitMinutes += action.impactMinutes || 0
    } else if (action.kind === 'stabilize') {
      impact.stabilizeCount += 1
    }
    return impact
  }, {
    releaseMinutes: 0,
    bufferMinutes: 0,
    splitMinutes: 0,
    stabilizeCount: 0,
  })
}

function buildScheduleSimulation(overview, impact, assumptions = DEFAULT_SIMULATION_ASSUMPTIONS) {
  const appliedReleaseMinutes = impact.releaseMinutes * assumptions.shortenRate / 100
  const appliedBufferMinutes = impact.bufferMinutes * assumptions.bufferRate / 100
  const projectedActualMinutes = overview.actualMinutes * (1 + assumptions.actualLoadChange / 100)
  const adjustedPlannedMinutes = Math.max(0, overview.plannedMinutes - appliedReleaseMinutes + appliedBufferMinutes)
  const plannedDelta = adjustedPlannedMinutes - overview.plannedMinutes
  const projectedDiffMinutes = projectedActualMinutes - adjustedPlannedMinutes
  const projectedDiffPercent = adjustedPlannedMinutes > 0 ? (projectedDiffMinutes / adjustedPlannedMinutes) * 100 : 0

  return {
    assumptions,
    currentPlannedMinutes: overview.plannedMinutes,
    adjustedPlannedMinutes,
    plannedDelta,
    projectedActualMinutes,
    releaseMinutes: impact.releaseMinutes,
    bufferMinutes: impact.bufferMinutes,
    appliedReleaseMinutes,
    appliedBufferMinutes,
    splitMinutes: impact.splitMinutes,
    stabilizeCount: impact.stabilizeCount,
    projectedDiffMinutes,
    projectedDiffPercent,
  }
}

function normalizeSimulationAssumption(key, value) {
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue)) return DEFAULT_SIMULATION_ASSUMPTIONS[key]
  const ranges = {
    shortenRate: [0, 100],
    bufferRate: [0, 150],
    actualLoadChange: [-30, 30],
  }
  const [min, max] = ranges[key] || [0, 100]
  return Math.min(max, Math.max(min, Math.round(numericValue)))
}

function buildActiveFilterItems({ filters, activeQuarterFilter, selectedQuarter, qualityFilter }) {
  const items = []
  if (activeQuarterFilter === 'all') {
    items.push({ kind: 'filter', key: 'quarter', label: '季度', value: '全部季度' })
  } else if (activeQuarterFilter && activeQuarterFilter !== selectedQuarter) {
    items.push({ kind: 'filter', key: 'quarter', label: '季度', value: activeQuarterFilter })
  }
  if (filters.meetingType !== 'all') {
    items.push({ kind: 'filter', key: 'meetingType', label: '类型', value: filters.meetingType })
  }
  if (filters.month !== 'all') {
    items.push({ kind: 'filter', key: 'month', label: '月份', value: formatMonthLabel(filters.month) })
  }
  if (filters.date !== 'all') {
    items.push({ kind: 'filter', key: 'date', label: '日期', value: formatDateLabel(filters.date) })
  }
  if (filters.locationType !== 'all') {
    items.push({ kind: 'filter', key: 'locationType', label: '地点', value: filters.locationType })
  }
  if (filters.status !== 'all') {
    items.push({ kind: 'filter', key: 'status', label: '状态', value: filters.status })
  }
  if (filters.weekday !== 'all') {
    items.push({ kind: 'filter', key: 'weekday', label: '星期', value: WEEKDAY_OPTIONS.find((item) => item.key === filters.weekday)?.label || filters.weekday })
  }
  if (filters.hourBucket !== 'all') {
    const bucket = HOUR_BUCKETS.find((item) => item.key === filters.hourBucket)
    items.push({ kind: 'filter', key: 'hourBucket', label: '时段', value: bucket ? `${bucket.label} ${bucket.range}` : filters.hourBucket })
  }
  if (filters.keyword.trim()) {
    items.push({ kind: 'filter', key: 'keyword', label: '搜索', value: filters.keyword.trim() })
  }
  if (qualityFilter !== 'all') {
    items.push({ kind: 'quality', key: qualityFilter, label: '数据质量', value: getQualityLabel(qualityFilter) })
  }
  return items
}

function getQualityLabel(type) {
  return {
    missingRequired: '缺关键字段',
    missingTime: '缺时间',
    invalidDuration: '时长异常',
    durationMismatch: '分钟不一致',
    duplicate: '疑似重复',
  }[type] || type
}

function buildQuickSlices(records) {
  const slices = []
  const byDate = Array.from(groupByValue(records, 'date').entries())
    .map(([date, items]) => ({
      key: `date-${date}`,
      date,
      count: items.length,
      actualMinutes: sumRecords(items, 'actualMinutes'),
    }))
    .filter((item) => item.date)
    .sort((left, right) => right.actualMinutes - left.actualMinutes)
  const peakDay = byDate[0]
  if (peakDay) {
    slices.push({
      key: 'peak-day',
      badge: '峰值日',
      title: formatDateLabel(peakDay.date),
      meta: `${peakDay.count} 场 / ${formatMinutes(peakDay.actualMinutes)}`,
      tone: 'blue',
      filters: { date: peakDay.date },
    })
  }

  const slotRows = []
  WEEKDAY_OPTIONS.forEach((weekday) => {
    HOUR_BUCKETS.forEach((bucket) => {
      const items = records.filter((record) => getRecordWeekdayKey(record) === weekday.key && getRecordHourBucketKey(record) === bucket.key)
      const actualMinutes = sumRecords(items, 'actualMinutes')
      if (items.length > 0) {
        slotRows.push({
          weekday,
          bucket,
          count: items.length,
          actualMinutes,
        })
      }
    })
  })
  const peakSlot = slotRows.sort((left, right) => right.actualMinutes - left.actualMinutes)[0]
  if (peakSlot) {
    slices.push({
      key: 'peak-slot',
      badge: '高峰格',
      title: `${peakSlot.weekday.label} ${peakSlot.bucket.label}`,
      meta: `${peakSlot.count} 场 / ${formatMinutes(peakSlot.actualMinutes)}`,
      tone: 'green',
      filters: { weekday: peakSlot.weekday.key, hourBucket: peakSlot.bucket.key },
    })
  }

  const topType = groupSummary(records, 'meetingType')[0]
  if (topType) {
    slices.push({
      key: 'top-type',
      badge: '主类型',
      title: topType.label,
      meta: `${topType.count} 场 / ${formatMinutes(topType.actualMinutes)}`,
      tone: 'purple',
      filters: { meetingType: topType.label },
    })
  }

  const overStatus = statusSummary(records)
    .filter((item) => ['lightOver', 'mediumOver', 'seriousOver'].includes(item.key) && item.count > 0)
    .sort((left, right) => right.minutes - left.minutes)[0]
  if (overStatus) {
    slices.push({
      key: 'over-status',
      badge: '超时',
      title: overStatus.label,
      meta: `${overStatus.count} 场 / ${formatMinutes(overStatus.minutes)}`,
      tone: 'orange',
      filters: { status: overStatus.label },
    })
  }

  const longestRecord = [...records].sort((left, right) => Number(right.actualMinutes || 0) - Number(left.actualMinutes || 0))[0]
  if (longestRecord) {
    slices.push({
      key: 'longest-record',
      badge: '最长会',
      title: formatDateLabel(longestRecord.date),
      meta: `${formatMinutes(longestRecord.actualMinutes)} / ${longestRecord.seriesName || longestRecord.title}`,
      tone: 'slate',
      filters: { date: longestRecord.date, keyword: longestRecord.seriesName || longestRecord.title },
    })
  }

  return slices.slice(0, 5)
}

function buildSavedViewReports(savedViews, records) {
  return savedViews.map((view) => {
    const filtered = filterRecords(records, { ...DEFAULT_FILTERS, ...view.filters })
    const scope = filterRecords(records, { ...DEFAULT_FILTERS, quarter: view.filters?.quarter || 'all' })
    const overview = calculateOverview(filtered)
    const scopeOverview = calculateOverview(scope)
    const topRecord = [...filtered].sort((left, right) => Number(right.actualMinutes || 0) - Number(left.actualMinutes || 0))[0] || null
    return {
      ...view,
      view,
      overview,
      scopeOverview,
      actualShareOfScope: scopeOverview.actualMinutes > 0 ? (overview.actualMinutes / scopeOverview.actualMinutes) * 100 : 0,
      topRecord,
    }
  })
}

function buildReportReadiness({
  overview,
  quarterSummary,
  dataQuality,
  savedViewReports,
  structureDeltas,
  reportOutline,
}) {
  const firstIssue = dataQuality.items.find((item) => item.count > 0)
  const items = [
    {
      key: 'quality',
      label: '数据质量',
      status: overview.count === 0 ? 'block' : dataQuality.totalIssues > 0 ? 'warn' : 'ready',
      metric: dataQuality.totalIssues > 0 ? `${dataQuality.totalIssues} 个问题` : `${dataQuality.checkedCount} 行可用`,
      body: dataQuality.totalIssues > 0 ? `优先检查${firstIssue?.label || '异常明细'}` : '明细口径稳定',
      outlineKey: 'quality',
    },
    {
      key: 'compare',
      label: '跨期基准',
      status: quarterSummary.previousQuarter ? 'ready' : 'warn',
      metric: quarterSummary.previousQuarter ? `较 ${quarterSummary.previousQuarter}` : '暂无基准',
      body: quarterSummary.previousQuarter ? `实际时长 ${quarterSummary.actualDeltaText}` : '缺少历史季度对比',
      outlineKey: 'compare',
    },
    {
      key: 'structure',
      label: '结构归因',
      status: structureDeltas.length >= 3 ? 'ready' : structureDeltas.length > 0 ? 'warn' : 'block',
      metric: `${structureDeltas.length} 个变化项`,
      body: structureDeltas[0] ? `${structureDeltas[0].label} ${formatDelta(structureDeltas[0].deltaMinutes, 'minutes')}` : '暂无可对比结构',
      outlineKey: 'compare',
    },
    {
      key: 'focus',
      label: '专题切片',
      status: savedViewReports.length >= 2 ? 'ready' : savedViewReports.length === 1 ? 'warn' : 'block',
      metric: `${savedViewReports.length} 个视角`,
      body: savedViewReports.length > 0 ? `${savedViewReports[0].title} 已入库` : '还没有保存专题素材',
      outlineKey: 'focus',
    },
    {
      key: 'outline',
      label: '汇报大纲',
      status: reportOutline.length >= 6 ? 'ready' : 'warn',
      metric: `${reportOutline.length} 页`,
      body: reportOutline.length >= 6 ? '结构完整' : '建议补齐汇报页',
      outlineKey: reportOutline[0]?.key || 'overview',
    },
  ]
  const statusScores = { ready: 100, warn: 66, block: 25 }
  const score = Math.round(items.reduce((total, item) => total + statusScores[item.status], 0) / Math.max(1, items.length))
  const grade = score >= 86 ? '可定稿' : score >= 72 ? '可汇报' : score >= 56 ? '待补充' : '需整理'
  const tone = score >= 86 ? 'cool' : score >= 72 ? 'green' : score >= 56 ? 'amber' : 'hot'
  const blockerCount = items.filter((item) => item.status === 'block').length
  const warnCount = items.filter((item) => item.status === 'warn').length

  return {
    score,
    grade,
    tone,
    summary: blockerCount > 0 ? `${blockerCount} 项缺口` : warnCount > 0 ? `${warnCount} 项待确认` : '素材完整',
    items,
  }
}

function buildReportOutline({
  selectedQuarter,
  overview,
  healthScore,
  briefingCards,
  quarterSummary,
  rhythmInsights,
  savedViewReports,
  scheduleSimulation,
  dataQuality,
}) {
  const focusViews = savedViewReports.slice(0, 3)
  const primaryBriefing = briefingCards[0]
  const diagnosisBriefing = briefingCards.find((item) => item.kicker === '归因') || briefingCards[1]

  return [
    {
      key: 'overview',
      label: '开场总览',
      title: `${selectedQuarter || '本期'} 会议时间基本可控`,
      subtitle: `${overview.count} 个日程，健康分 ${healthScore.score}（${healthScore.grade}）`,
      metric: `${formatMinutes(overview.actualMinutes)}`,
      tone: healthScore.tone,
      bullets: [
        `实际时长 ${formatMinutes(overview.actualMinutes)}，规划时长 ${formatMinutes(overview.plannedMinutes)}。`,
        `净差值 ${formatDelta(overview.diffMinutes, 'minutes')}，差值率 ${formatPercent(overview.diffPercent)}。`,
        primaryBriefing ? `${primaryBriefing.title}：${primaryBriefing.evidence}` : `准时率 ${formatPercent(overview.onTimeRate)}。`,
      ],
    },
    {
      key: 'compare',
      label: '跨期变化',
      title: quarterSummary.previousQuarter ? `较 ${quarterSummary.previousQuarter} 的关键变化` : '暂无可用基准季度',
      subtitle: `日程 ${quarterSummary.countDeltaText}，实际时长 ${quarterSummary.actualDeltaText}`,
      metric: quarterSummary.actualDeltaText,
      tone: quarterSummary.actualDelta >= 0 ? 'hot' : 'cool',
      bullets: [
        `当前季度：${quarterSummary.currentQuarter || selectedQuarter || 'N/A'}。`,
        `准时率变化：${quarterSummary.onTimeDeltaText}。`,
        diagnosisBriefing ? `${diagnosisBriefing.title}：${diagnosisBriefing.evidence}` : '结构变化需要结合保存视角进一步展开。',
      ],
    },
    {
      key: 'focus',
      label: '专题切片',
      title: focusViews.length > 0 ? '重点视角已沉淀为报告素材' : '建议先保存重点切片',
      subtitle: focusViews.length > 0 ? `${focusViews.length} 个视角可用于复盘展开` : '从快捷切片或图表点击后保存视角',
      metric: focusViews.length > 0 ? `${focusViews.length} 个` : '待保存',
      tone: 'neutral',
      bullets: focusViews.length > 0
        ? focusViews.map((item) => `${item.title}：${item.overview.count} 场，${formatMinutes(item.overview.actualMinutes)}，准时率 ${formatPercent(item.overview.onTimeRate)}。`)
        : ['可保存峰值日、高峰格、主类型或超时状态作为报告专题。'],
    },
    {
      key: 'rhythm',
      label: '节奏拥挤',
      title: rhythmInsights.peakWeekday ? `${rhythmInsights.peakWeekday.label} 是会议负荷峰值` : '暂无明显节奏峰值',
      subtitle: rhythmInsights.peakBucket ? `${rhythmInsights.peakBucket.label}最集中` : '时段分布暂不明显',
      metric: `${formatNumber(rhythmInsights.dailyAverageMinutes, 0)} 分钟/日`,
      tone: rhythmInsights.dailyAverageMinutes >= 240 ? 'hot' : 'neutral',
      bullets: [
        rhythmInsights.peakWeekday ? `${rhythmInsights.peakWeekday.label}累计 ${formatMinutes(rhythmInsights.peakWeekday.actualMinutes)}，${rhythmInsights.peakWeekday.count} 场。` : '缺少星期维度峰值。',
        rhythmInsights.peakBucket ? `${rhythmInsights.peakBucket.label}时段累计 ${formatMinutes(rhythmInsights.peakBucket.actualMinutes)}，${rhythmInsights.peakBucket.count} 场。` : '缺少时段维度峰值。',
        `日均会议负荷 ${formatNumber(rhythmInsights.dailyAverageMinutes, 0)} 分钟/有会工作日。`,
      ],
    },
    {
      key: 'action',
      label: '下季行动',
      title: scheduleSimulation.projectedDiffMinutes > 0 ? '下季度仍需控超时' : '下季度计划可承接',
      subtitle: `预计实际负荷 ${formatMinutes(scheduleSimulation.projectedActualMinutes)}`,
      metric: formatDelta(scheduleSimulation.projectedDiffMinutes, 'minutes'),
      tone: scheduleSimulation.projectedDiffMinutes > 0 ? 'hot' : 'cool',
      bullets: [
        `调整后规划 ${formatMinutes(scheduleSimulation.adjustedPlannedMinutes)}。`,
        `预计差值 ${formatDelta(scheduleSimulation.projectedDiffMinutes, 'minutes')}，差值率 ${formatPercent(scheduleSimulation.projectedDiffPercent)}。`,
        `假设：缩短执行率 ${scheduleSimulation.assumptions.shortenRate}%，buffer 执行率 ${scheduleSimulation.assumptions.bufferRate}%。`,
      ],
    },
    {
      key: 'quality',
      label: '数据质量',
      title: dataQuality.totalIssues > 0 ? '存在待确认数据问题' : '数据质量可支撑复盘',
      subtitle: `${dataQuality.checkedCount} 行已检查`,
      metric: `${dataQuality.totalIssues} 个问题`,
      tone: dataQuality.totalIssues > 0 ? 'hot' : 'cool',
      bullets: [
        formatQualitySentence(dataQuality),
        dataQuality.totalIssues > 0 ? '建议先修正关键字段、时间缺失和疑似重复后再定稿。' : '当前可直接用于报告输出。',
      ],
    },
  ]
}

function buildReportOutlineMarkdown(items) {
  return [
    '# 会议时间复盘汇报大纲',
    '',
    ...items.flatMap((item, index) => [
      `## ${index + 1}. ${item.label}`,
      `- 标题：${item.title}`,
      `- 关键指标：${item.metric}`,
      `- 辅助说明：${item.subtitle}`,
      ...item.bullets.map((bullet) => `- ${bullet}`),
      '',
    ]),
  ].join('\n')
}

function groupByValue(records, key) {
  const map = new Map()
  records.forEach((record) => {
    const value = record[key] || ''
    if (!value) return
    const items = map.get(value) || []
    items.push(record)
    map.set(value, items)
  })
  return map
}

function sumRecords(records, key) {
  return records.reduce((total, record) => total + Number(record[key] || 0), 0)
}

function buildSliceReview(records, scopeRecords, filterItems) {
  const visibleItems = filterItems.filter((item) => !(item.key === 'quarter' && item.value !== '全部季度'))
  const overview = calculateOverview(records)
  const scopeOverview = calculateOverview(scopeRecords)
  const topRecords = [...records]
    .sort((left, right) => Number(right.actualMinutes || 0) - Number(left.actualMinutes || 0))
    .slice(0, 5)

  return {
    visible: visibleItems.length > 0,
    title: visibleItems.map((item) => `${item.label}:${item.value}`).join(' / '),
    overview,
    scopeOverview,
    shareOfScope: scopeOverview.count > 0 ? (overview.count / scopeOverview.count) * 100 : 0,
    actualShareOfScope: scopeOverview.actualMinutes > 0 ? (overview.actualMinutes / scopeOverview.actualMinutes) * 100 : 0,
    topRecords,
  }
}

function buildHealthScore({ overview, seriesAnalysis, rhythmInsights, scheduleSimulation }) {
  const weightedCvTotal = seriesAnalysis.reduce((total, item) => total + item.cv * item.count, 0)
  const weightedCount = seriesAnalysis.reduce((total, item) => total + item.count, 0)
  const averageCv = weightedCount > 0 ? weightedCvTotal / weightedCount : 0
  const peakWeekdayPressure = rhythmInsights.peakWeekday?.percent || 0
  const peakBucketPressure = rhythmInsights.peakBucket?.percent || 0

  const dimensions = [
    {
      key: 'onTime',
      label: '准时表现',
      score: clampScore(overview.onTimeRate),
      evidence: `${formatPercent(overview.onTimeRate)} 准时/基本准时`,
      filter: { key: 'status', value: '准时/基本准时' },
    },
    {
      key: 'accuracy',
      label: '规划准确',
      score: clampScore(100 - Math.abs(overview.diffPercent) * 5),
      evidence: `差值率 ${formatPercent(overview.diffPercent)}`,
      filter: overview.diffMinutes > 0 ? { key: 'status', value: '轻度超时' } : null,
    },
    {
      key: 'stability',
      label: '时长稳定',
      score: clampScore(100 - averageCv * 120),
      evidence: `加权离散 ${formatPercent(averageCv * 100)}`,
    },
    {
      key: 'rhythm',
      label: '节奏分散',
      score: clampScore(100 - Math.max(0, peakWeekdayPressure - 28) * 1.4 - Math.max(0, peakBucketPressure - 35) * 1.8),
      evidence: rhythmInsights.peakWeekday && rhythmInsights.peakBucket
        ? `${rhythmInsights.peakWeekday.label} ${formatPercent(peakWeekdayPressure)}，${rhythmInsights.peakBucket.label} ${formatPercent(peakBucketPressure)}`
        : '暂无明显峰值',
      filter: rhythmInsights.peakWeekday ? { key: 'weekday', value: rhythmInsights.peakWeekday.key } : null,
    },
    {
      key: 'capacity',
      label: '下季承接',
      score: clampScore(100 - Math.abs(scheduleSimulation.projectedDiffPercent) * 6),
      evidence: `模拟差值率 ${formatPercent(scheduleSimulation.projectedDiffPercent)}`,
    },
  ].map((item) => ({ ...item, score: Math.round(item.score) }))

  const score = Math.round(dimensions.reduce((total, item) => total + item.score, 0) / Math.max(1, dimensions.length))
  const grade = score >= 85 ? '健康' : score >= 70 ? '可控' : score >= 55 ? '承压' : '高风险'
  const tone = score >= 85 ? 'cool' : score >= 70 ? 'neutral' : 'hot'
  const weakest = [...dimensions].sort((left, right) => left.score - right.score)[0]

  return {
    score,
    grade,
    tone,
    summary: weakest ? `短板：${weakest.label}` : '暂无短板',
    dimensions,
  }
}

function clampScore(value) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, value))
}

function buildBriefingCards({
  overview,
  healthScore,
  quarterSummary,
  monthlyBreakdown,
  rhythmInsights,
  structureDeltas,
  compareDimension,
  scheduleSimulation,
}) {
  const topStructure = structureDeltas[0]
  const peakMonth = [...monthlyBreakdown].sort((left, right) => right.actualMinutes - left.actualMinutes)[0]
  const dimensionLabel = getStructureDimensionLabel(compareDimension, 'short')
  const loadTone = overview.diffMinutes > 0 ? 'hot' : 'cool'
  const simulationTone = scheduleSimulation.projectedDiffMinutes > 0 ? 'hot' : 'cool'

  return [
    {
      kicker: '总览',
      title: overview.diffMinutes > 0 ? '实际时长高于规划' : '规划容量覆盖实际',
      body: `${overview.count} 个日程实际消耗 ${formatMinutes(overview.actualMinutes)}，净差值 ${formatDelta(overview.diffMinutes, 'minutes')}，准时率 ${formatPercent(overview.onTimeRate)}。`,
      evidence: quarterSummary.previousQuarter
        ? `健康分 ${healthScore.score}，较 ${quarterSummary.previousQuarter}：实际时长 ${quarterSummary.actualDeltaText}，日程 ${quarterSummary.countDeltaText}`
        : `健康分 ${healthScore.score}，暂无可用基准季度`,
      tone: loadTone,
    },
    {
      kicker: '归因',
      title: topStructure ? `${topStructure.label} 是主要变化项` : '暂无结构变化项',
      body: topStructure
        ? `${dimensionLabel}维度中，${topStructure.label} 较基准${formatDelta(topStructure.deltaMinutes, 'minutes')}，占比${formatDelta(topStructure.deltaSharePoint, 'pct')}。`
        : '当前筛选下没有足够的结构对比数据。',
      evidence: topStructure ? `${topStructure.currentCount} 场 / ${formatMinutes(topStructure.currentMinutes)}` : '暂无可点击明细',
      tone: topStructure?.deltaMinutes >= 0 ? 'hot' : 'cool',
      filter: topStructure ? { key: topStructure.filterKey, value: topStructure.filterValue } : null,
    },
    {
      kicker: '节奏',
      title: rhythmInsights.peakWeekday ? `${rhythmInsights.peakWeekday.label} 是负荷峰值` : '暂无明显时间峰值',
      body: rhythmInsights.peakWeekday
        ? `${rhythmInsights.peakWeekday.label}累计 ${formatMinutes(rhythmInsights.peakWeekday.actualMinutes)}，${rhythmInsights.peakBucket ? `${rhythmInsights.peakBucket.label}时段最集中。` : '时段分布暂不明显。'}`
        : '当前筛选下缺少可用于节奏判断的日程。',
      evidence: peakMonth ? `${peakMonth.label}峰值 ${formatMinutes(peakMonth.actualMinutes)}，日均 ${formatNumber(rhythmInsights.dailyAverageMinutes, 0)} 分钟` : `日均 ${formatNumber(rhythmInsights.dailyAverageMinutes, 0)} 分钟`,
      tone: rhythmInsights.dailyAverageMinutes >= 240 ? 'hot' : 'neutral',
      filter: rhythmInsights.peakWeekday ? { key: 'weekday', value: rhythmInsights.peakWeekday.key } : null,
    },
    {
      kicker: '行动',
      title: scheduleSimulation.projectedDiffMinutes > 0 ? '下季度仍需控超时' : '下季度计划可承接',
      body: `按当前模拟，调整后规划 ${formatMinutes(scheduleSimulation.adjustedPlannedMinutes)}，预计实际负荷 ${formatMinutes(scheduleSimulation.projectedActualMinutes)}。`,
      evidence: `预计差值 ${formatDelta(scheduleSimulation.projectedDiffMinutes, 'minutes')}，差值率 ${formatPercent(scheduleSimulation.projectedDiffPercent)}`,
      tone: simulationTone,
    },
  ]
}

function buildShareSummary({
  selectedQuarter,
  overview,
  healthScore,
  briefingCards,
  quarterSummary,
  dataQuality,
  rhythmInsights,
  scheduleSimulation,
}) {
  return [
    `${selectedQuarter || '全部季度'} 会议时间复盘摘要`,
    '',
    `健康分：${healthScore.score}（${healthScore.grade}），${healthScore.summary}`,
    `日程数量：${overview.count} 个`,
    `规划/实际：${formatMinutes(overview.plannedMinutes)} / ${formatMinutes(overview.actualMinutes)}`,
    `净差值：${formatDelta(overview.diffMinutes, 'minutes')}，差值率 ${formatPercent(overview.diffPercent)}`,
    `准时率：${formatPercent(overview.onTimeRate)}，平均累计偏差 ${formatNumber(overview.avgAbsDiffMinutes)} 分钟/个`,
    '',
    '汇报主线：',
    ...briefingCards.map((item) => `- 【${item.kicker}】${item.title}：${item.body} ${item.evidence}`),
    '',
    '跨季度对比：',
    `- 基准季度：${quarterSummary.previousQuarter || '暂无'}`,
    `- 日程变化：${quarterSummary.countDeltaText}`,
    `- 实际时长变化：${quarterSummary.actualDeltaText}`,
    `- 准时率变化：${quarterSummary.onTimeDeltaText}`,
    '',
    '健康维度：',
    ...healthScore.dimensions.map((item) => `- ${item.label}：${item.score}，${item.evidence}`),
    '',
    '时间节奏：',
    `- 高峰星期：${rhythmInsights.peakWeekday ? `${rhythmInsights.peakWeekday.label}，${formatMinutes(rhythmInsights.peakWeekday.actualMinutes)}` : '暂无'}`,
    `- 高峰时段：${rhythmInsights.peakBucket ? `${rhythmInsights.peakBucket.label}，${formatMinutes(rhythmInsights.peakBucket.actualMinutes)}` : '暂无'}`,
    `- 日均会议负荷：${formatNumber(rhythmInsights.dailyAverageMinutes, 0)} 分钟/有会工作日`,
    '',
    '下季度模拟：',
    `- 调整后规划：${formatMinutes(scheduleSimulation.adjustedPlannedMinutes)}`,
    `- 预计实际负荷：${formatMinutes(scheduleSimulation.projectedActualMinutes)}`,
    `- 预计差值：${formatDelta(scheduleSimulation.projectedDiffMinutes, 'minutes')}（${formatPercent(scheduleSimulation.projectedDiffPercent)}）`,
    '',
    `数据质量：${dataQuality.totalIssues > 0 ? `${dataQuality.totalIssues} 个问题需要确认` : '未发现明显问题'}`,
  ].join('\n')
}

function buildMarkdownReport({
  selectedQuarter,
  overview,
  narratives,
  healthScore,
  briefingCards,
  comparisonRows,
  typeSummary,
  locationSummary,
  statusItems,
  seriesAnalysis,
  dataQuality,
  quarterSummary,
  structureDeltas,
  compareDimension,
  monthlyBreakdown,
  rhythmInsights,
  scheduleActions,
  scheduleImpact,
  scheduleSimulation,
  savedViewReports = [],
}) {
  const topRecommendations = seriesAnalysis
    .filter((item) => item.count >= 2)
    .sort((left, right) => Math.abs(right.avgDiff) + right.cv * 20 - (Math.abs(left.avgDiff) + left.cv * 20))
    .slice(0, 8)
  const qualityIssues = dataQuality.items.filter((item) => item.count > 0)
  const structureLabel = getStructureDimensionLabel(compareDimension)
  const topStructureDeltas = structureDeltas.slice(0, 8)

  return [
    `# ${selectedQuarter || '全部季度'} 会议时间分析报告`,
    '',
    '## 核心结论',
    ...narratives.map((item) => `- ${item}`),
    '',
    '## 汇报叙事',
    ...briefingCards.map((item) => `- 【${item.kicker}】${item.title}：${item.body} ${item.evidence}`),
    '',
    '## 核心指标',
    `- 日程数量：${overview.count} 个`,
    `- 规划时长：${formatMinutes(overview.plannedMinutes)}`,
    `- 实际时长：${formatMinutes(overview.actualMinutes)}`,
    `- 净差值：${formatMinutes(overview.diffMinutes)}`,
    `- 累计偏差：${formatMinutes(overview.absDiffMinutes)}`,
    `- 准时率：${formatPercent(overview.onTimeRate)}`,
    `- 健康分：${healthScore.score}（${healthScore.grade}）`,
    ...healthScore.dimensions.map((item) => `- ${item.label}：${item.score}，${item.evidence}`),
    '',
    '## 跨季度对比',
    `- 当前季度：${quarterSummary.currentQuarter || selectedQuarter || 'N/A'}`,
    `- 对比季度：${quarterSummary.previousQuarter || '暂无'}`,
    `- 日程变化：${quarterSummary.countDeltaText}`,
    `- 实际时长变化：${quarterSummary.actualDeltaText}`,
    `- 准时率变化：${quarterSummary.onTimeDeltaText}`,
    '',
    ['指标', ...comparisonRows.quarters, '较基准'].join(' | '),
    ['---', ...comparisonRows.quarters.map(() => '---'), '---'].join(' | '),
    ...comparisonRows.rows.map((row) => [row.label, ...row.values.map((item) => item.value), row.delta].join(' | ')),
    '',
    '## 数据质量',
    `- ${formatQualitySentence(dataQuality)}`,
    ...(qualityIssues.length > 0 ? qualityIssues.map((item) => `- ${item.label}：${item.count} 个`) : ['- 暂无需要人工确认的问题']),
    '',
    `## ${structureLabel}变化归因`,
    ...(topStructureDeltas.length > 0
      ? topStructureDeltas.map((item) => `- ${item.label}：实际时长${formatDelta(item.deltaMinutes, 'minutes')}，占比${formatDelta(item.deltaSharePoint, 'pct')}，场次${formatDelta(item.deltaCount, 'count')}`)
      : ['- 暂无可对比数据']),
    '',
    '## 保存视角素材',
    ...(savedViewReports.length > 0
      ? savedViewReports.map((item) => {
        const topRecord = item.topRecord ? `；最重明细：${formatDateLabel(item.topRecord.date)} ${item.topRecord.title}（${formatMinutes(item.topRecord.actualMinutes)}）` : ''
        return `- ${item.title}：${item.overview.count} 场，实际时长 ${formatMinutes(item.overview.actualMinutes)}，准时率 ${formatPercent(item.overview.onTimeRate)}，占季度时长 ${formatPercent(item.actualShareOfScope)}${topRecord}`
      })
      : ['- 暂无保存视角。可在看板中保存常用切片后纳入报告。']),
    '',
    '## 月度拆解',
    ...(monthlyBreakdown.length > 0
      ? monthlyBreakdown.map((item) => `- ${item.label}：${item.count} 场，实际时长 ${formatMinutes(item.actualMinutes)}，准时率 ${formatPercent(item.onTimeRate)}，较上月 ${formatDelta(item.deltaActualMinutes, 'minutes')}`)
      : ['- 暂无月度数据']),
    '',
    '## 时间节奏',
    `- 最集中星期：${rhythmInsights.peakWeekday ? `${rhythmInsights.peakWeekday.label}，${rhythmInsights.peakWeekday.count} 场，${formatMinutes(rhythmInsights.peakWeekday.actualMinutes)}` : '暂无数据'}`,
    `- 最集中时段：${rhythmInsights.peakBucket ? `${rhythmInsights.peakBucket.label}（${rhythmInsights.peakBucket.range}），${rhythmInsights.peakBucket.count} 场，${formatMinutes(rhythmInsights.peakBucket.actualMinutes)}` : '暂无数据'}`,
    `- 日均会议负荷：${formatNumber(rhythmInsights.dailyAverageMinutes, 0)} 分钟/有会工作日`,
    '',
    '## 排期优化行动',
    `- 影响预估：可释放 ${formatMinutes(scheduleImpact.releaseMinutes)}，建议预留 buffer ${formatMinutes(scheduleImpact.bufferMinutes)}，拆分候选累计 ${formatMinutes(scheduleImpact.splitMinutes)}，需稳定对象 ${scheduleImpact.stabilizeCount} 个。`,
    ...(scheduleActions.length > 0
      ? scheduleActions.slice(0, 8).map((item) => `- 【${item.badge}】${item.label}：${item.impact}。${item.advice}`)
      : ['- 当前筛选下没有足够重复样本生成排期行动。']),
    '',
    '## 下季度方案模拟',
    `- 模拟假设：缩短执行率 ${scheduleSimulation.assumptions.shortenRate}%，buffer 执行率 ${scheduleSimulation.assumptions.bufferRate}%，实际负荷变化 ${formatDelta(scheduleSimulation.assumptions.actualLoadChange, 'pct')}`,
    `- 当前规划时长：${formatMinutes(scheduleSimulation.currentPlannedMinutes)}`,
    `- 按行动调整后规划时长：${formatMinutes(scheduleSimulation.adjustedPlannedMinutes)}`,
    `- 预计实际负荷：${formatMinutes(scheduleSimulation.projectedActualMinutes)}`,
    `- 净计划调整：${formatDelta(scheduleSimulation.plannedDelta, 'minutes')}`,
    `- 按当前假设，预计差值：${formatDelta(scheduleSimulation.projectedDiffMinutes, 'minutes')}（${formatPercent(scheduleSimulation.projectedDiffPercent)}）`,
    '',
    '## 结构分布',
    ...typeSummary.slice(0, 8).map((item) => `- ${item.label}：${item.count} 场，${formatMinutes(item.actualMinutes)}`),
    '',
    '## 地点分布',
    ...locationSummary.map((item) => `- ${item.label}：${formatPercent(overview.actualMinutes > 0 ? (item.actualMinutes / overview.actualMinutes) * 100 : 0)}`),
    '',
    '## 状态分布',
    ...statusItems.map((item) => `- ${item.label}：${item.count} 场，${formatPercent(item.percent)}`),
    '',
    '## 下季度排期建议',
    ...topRecommendations.map((item) => `- ${item.label}：${item.recommendation}`),
    '',
  ].join('\n')
}

function formatQualitySentence(quality) {
  if (quality.totalIssues === 0) return `${quality.checkedCount} 行明细未发现明显数据质量问题。`
  const topItems = quality.items
    .filter((item) => item.count > 0)
    .map((item) => `${item.label} ${item.count}`)
    .join('、')
  return `${quality.checkedCount} 行明细中有 ${quality.totalIssues} 个问题需要确认：${topItems}。`
}

function formatDelta(value, unit) {
  if (!Number.isFinite(value) || value === 0) return '持平'
  const sign = value > 0 ? '+' : '-'
  const absolute = Math.abs(value)
  if (unit === 'pct') return `${sign}${formatPercent(absolute)}`
  if (unit === 'minutes') return `${sign}${formatMinutes(absolute)}`
  if (unit === 'count') return `${sign}${formatNumber(absolute, 0)} 个`
  return `${sign}${formatNumber(absolute, 0)}`
}

function formatQuarterTrendValue(metric, value) {
  const safeValue = Number(value || 0)
  if (metric.unit === 'pct') return formatPercent(safeValue)
  if (metric.unit === 'minutes') return formatMinutes(safeValue)
  if (metric.unit === 'count') return `${formatNumber(safeValue, 0)} 个`
  return formatNumber(safeValue, 0)
}

function formatQuarterTrendShortValue(metric, value) {
  const safeValue = Number(value || 0)
  if (metric.unit === 'pct') return formatPercent(safeValue, 0)
  if (metric.unit === 'minutes') return formatNumber(safeValue, 0)
  if (metric.unit === 'count') return formatNumber(safeValue, 0)
  return formatNumber(safeValue, 0)
}

function formatTrendMetricDelta(value, metric) {
  if (metric.unit === 'pct') {
    if (!Number.isFinite(value) || value === 0) return '持平'
    const sign = value > 0 ? '+' : '-'
    return `${sign}${formatNumber(Math.abs(value))} 个百分点`
  }
  if (metric.unit === 'minutes') return formatDelta(value, 'minutes')
  if (metric.unit === 'count') return formatDelta(value, 'count')
  return formatDelta(value)
}

function getTrendDeltaTone(value, metric) {
  if (!Number.isFinite(value) || value === 0 || metric.direction === 'neutral') return 'neutral'
  if (metric.direction === 'higher') return value > 0 ? 'cool' : 'hot'
  return value > 0 ? 'hot' : 'cool'
}

function formatMonthLabel(month) {
  const match = String(month || '').match(/^(\d{4})-(\d{2})$/)
  if (!match) return month || 'N/A'
  return `${Number(match[2])}月`
}

function formatDateLabel(date) {
  const match = String(date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return date || 'N/A'
  return `${Number(match[2])}月${Number(match[3])}日`
}

function getQuarterDateRange(quarter) {
  const match = String(quarter || '').match(/^(\d{2})Q([1-4])$/)
  if (!match) return []
  const year = Number(`20${match[1]}`)
  const startMonth = (Number(match[2]) - 1) * 3
  const days = []
  const cursor = new Date(year, startMonth, 1)
  const end = new Date(year, startMonth + 3, 1)

  while (cursor < end) {
    days.push({ date: formatDateForCalendar(cursor) })
    cursor.setDate(cursor.getDate() + 1)
  }

  return days
}

function getWeekdayOffset(date) {
  const match = String(date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return 0
  const day = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getDay()
  return (day + 6) % 7
}

function formatDateForCalendar(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

function analyzeDataQuality(records) {
  const duplicateKeys = new Map()
  records.forEach((record) => {
    const key = `${record.date}|${record.seriesName}|${record.plannedStart}`
    duplicateKeys.set(key, (duplicateKeys.get(key) || 0) + 1)
  })

  const issuesById = {}
  const issueTypes = [
    { type: 'missingRequired', label: '缺关键字段' },
    { type: 'missingTime', label: '缺时间' },
    { type: 'invalidDuration', label: '时长异常' },
    { type: 'durationMismatch', label: '分钟不一致' },
    { type: 'duplicate', label: '疑似重复' },
  ]
  const counts = Object.fromEntries(issueTypes.map((item) => [item.type, 0]))

  records.forEach((record) => {
    const issues = []
    if (!record.date || !record.title || record.title === '未命名日程') {
      issues.push({ type: 'missingRequired', label: '缺日期或会议主题' })
    }
    if (!record.plannedStart || !record.plannedEnd || !record.actualStart || !record.actualEnd) {
      issues.push({ type: 'missingTime', label: '缺预计/实际开始结束时间' })
    }
    if (record.plannedMinutes <= 0 || record.actualMinutes <= 0) {
      issues.push({ type: 'invalidDuration', label: '预计或实际时长小于等于 0' })
    }

    const plannedFromTime = calculateMinutesFromText(record.plannedStart, record.plannedEnd)
    const actualFromTime = calculateMinutesFromText(record.actualStart, record.actualEnd)
    if (
      (Number.isFinite(plannedFromTime) && Math.abs(plannedFromTime - record.plannedMinutes) > 1) ||
      (Number.isFinite(actualFromTime) && Math.abs(actualFromTime - record.actualMinutes) > 1)
    ) {
      issues.push({ type: 'durationMismatch', label: '开始结束时间与分钟数不一致' })
    }

    const duplicateKey = `${record.date}|${record.seriesName}|${record.plannedStart}`
    if (record.date && record.seriesName && duplicateKeys.get(duplicateKey) > 1) {
      issues.push({ type: 'duplicate', label: '同日期同会议同开始时间重复' })
    }

    if (issues.length > 0) {
      issuesById[record.id] = issues
      issues.forEach((issue) => {
        counts[issue.type] += 1
      })
    }
  })

  return {
    checkedCount: records.length,
    totalIssues: Object.values(counts).reduce((total, count) => total + count, 0),
    items: issueTypes.map((item) => ({ ...item, count: counts[item.type] })),
    issuesById,
  }
}

function calculateMinutesFromText(start, end) {
  const startMinutes = parseTimeToMinutes(start)
  const endMinutes = parseTimeToMinutes(end)
  if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes)) return NaN
  return (endMinutes < startMinutes ? endMinutes + 24 * 60 : endMinutes) - startMinutes
}

function parseTimeToMinutes(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{1,2})$/)
  if (!match) return NaN
  return Number(match[1]) * 60 + Number(match[2])
}

function getDefaultDateForQuarter(quarter) {
  const match = String(quarter || '').match(/^(\d{2})Q([1-4])$/)
  if (!match) return ''
  const year = `20${match[1]}`
  const month = (Number(match[2]) - 1) * 3 + 1
  return `${year}-${String(month).padStart(2, '0')}-01`
}
