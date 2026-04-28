const { ipcMain } = require('electron')
const crypto = require('crypto')
const { JobStore } = require('./job-store.cjs')
const { OpenAIClient, normalizeErrorMessage } = require('./openai-client.cjs')
const { GeminiClient, normalizeProviderError } = require('./gemini-client.cjs')
const { DeepSeekClient, normalizeDeepSeekError } = require('./deepseek-client.cjs')

const ACTIVE_STATUSES = new Set(['queued', 'submitting', 'submitted', 'polling', 'in_progress', 'retry_wait'])
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'expired'])

const MEETING_SCHEDULE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['scheduledMeetings', 'unscheduledMeetings', 'summary'],
  properties: {
    scheduledMeetings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['taskId', 'date', 'startTime', 'endTime', 'duration', 'frequency', 'aiReason'],
        properties: {
          taskId: { type: 'string' },
          date: { type: 'string' },
          startTime: { type: 'string' },
          endTime: { type: 'string' },
          duration: { type: 'number' },
          frequency: { type: 'string' },
          notes: { type: 'string' },
          aiReason: { type: 'string' },
        },
      },
    },
    unscheduledMeetings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['taskId', 'reason'],
        properties: {
          taskId: { type: 'string' },
          reason: { type: 'string' },
          type: { type: 'string' },
        },
      },
    },
    summary: {
      type: 'object',
      additionalProperties: false,
      required: ['unscheduledMeetings'],
      properties: {
        unscheduledMeetings: { type: 'number' },
      },
    },
  },
}

function toIsoNow() {
  return new Date().toISOString()
}

function createJobId() {
  return `job_${Date.now()}_${crypto.randomUUID()}`
}

function createImportedJobId() {
  return `imported_${Date.now()}_${crypto.randomUUID()}`
}

function sanitizeJob(job) {
  if (!job) return null

  return {
    id: job.id,
    batchId: job.batchId,
    provider: job.provider ?? 'openai',
    model: job.model,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    responseId: job.responseId ?? '',
    lastError: job.lastError ?? '',
    attemptCount: job.attemptCount ?? 0,
    promptVersion: job.promptVersion ?? 'v1',
    result: job.result ?? null,
    resultSummary: job.result?.summary ?? null,
    inputMeetings: job.requestSnapshot?.inputMeetings ?? null,
    exportBatch: job.requestSnapshot?.exportBatch ?? null,
  }
}

function getPollDelayMs(job) {
  const startedAt = new Date(job.createdAt || 0).getTime()
  const elapsedMs = Date.now() - startedAt

  if (elapsedMs < 60_000) return 5_000
  if (elapsedMs < 5 * 60_000) return 10_000
  return 20_000
}

function extractResponseText(response) {
  if (typeof response.output_text === 'string' && response.output_text.trim()) {
    return response.output_text
  }

  if (!Array.isArray(response.output)) {
    return ''
  }

  const chunks = []

  response.output.forEach((item) => {
    if (!Array.isArray(item.content)) return
    item.content.forEach((contentItem) => {
      if (typeof contentItem.text === 'string') {
        chunks.push(contentItem.text)
      }
      if (typeof contentItem.output_text === 'string') {
        chunks.push(contentItem.output_text)
      }
    })
  })

  return chunks.join('\n').trim()
}

function extractDeepSeekResponseText(response) {
  return response?.choices?.[0]?.message?.content?.trim() || ''
}

function createAiJobService(app, configStore) {
  const store = new JobStore(app)
  const timers = new Map()

  function getClient(provider = 'openai') {
    if (provider === 'gemini') {
      return new GeminiClient({
        apiKey: configStore.readApiKey('gemini') || process.env.GEMINI_API_KEY || '',
      })
    }

    if (provider === 'deepseek') {
      return new DeepSeekClient({
        apiKey: configStore.readApiKey('deepseek') || process.env.DEEPSEEK_API_KEY || '',
      })
    }

    return new OpenAIClient({
      apiKey: configStore.readApiKey('openai') || process.env.OPENAI_API_KEY || '',
    })
  }

  function persistJob(job) {
    const nextJob = {
      ...job,
      updatedAt: toIsoNow(),
    }
    store.upsertJob(nextJob)
    return nextJob
  }

  function schedulePoll(jobId, delayMs) {
    if (timers.has(jobId)) {
      clearTimeout(timers.get(jobId))
    }

    const timer = setTimeout(() => {
      timers.delete(jobId)
      pollJob(jobId).catch(() => {})
    }, delayMs)

    timers.set(jobId, timer)
  }

  async function submitJob(payload) {
    const createdAt = toIsoNow()
    const provider = payload.provider === 'gemini' ? 'gemini' : payload.provider === 'deepseek' ? 'deepseek' : 'openai'
    const draftJob = persistJob({
      id: createJobId(),
      batchId: payload.batchId,
      provider,
      model:
        payload.model ||
        (provider === 'gemini'
          ? 'gemini-3-pro-preview'
          : provider === 'deepseek'
            ? 'deepseek-v4-pro'
            : 'gpt-5.4'),
      status: 'submitting',
      createdAt,
      updatedAt: createdAt,
      attemptCount: 1,
      promptVersion: payload.promptVersion || 'v1',
      requestSnapshot: {
        prompt: payload.prompt,
        inputMeetings: payload.inputMeetings,
        preferences: payload.preferences,
        exportBatch: payload.exportBatch,
      },
      responseId: '',
      lastError: '',
      result: null,
    })

    try {
      if (provider === 'gemini') {
        const submittedJob = persistJob({
          ...draftJob,
          status: 'in_progress',
          responseId: `gemini-local-${draftJob.id}`,
        })

        processGeminiJob(submittedJob.id).catch(() => {})
        return sanitizeJob(submittedJob)
      }

      if (provider === 'deepseek') {
        const submittedJob = persistJob({
          ...draftJob,
          status: 'in_progress',
          responseId: `deepseek-local-${draftJob.id}`,
        })

        processDeepSeekJob(submittedJob.id).catch(() => {})
        return sanitizeJob(submittedJob)
      }

      const response = await getClient(provider).createBackgroundResponse({
        model: draftJob.model,
        background: true,
        store: true,
        input: draftJob.requestSnapshot.prompt,
        text: {
          format: {
            type: 'json_schema',
            name: 'meeting_schedule_result',
            strict: true,
            schema: MEETING_SCHEDULE_SCHEMA,
          },
        },
        metadata: {
          app: 'meeting-manager',
          batchId: draftJob.batchId,
          jobId: draftJob.id,
        },
      })

      const submittedJob = persistJob({
        ...draftJob,
        responseId: response.id,
        status: response.status || 'submitted',
      })

      schedulePoll(submittedJob.id, getPollDelayMs(submittedJob))
      return sanitizeJob(submittedJob)
    } catch (error) {
      const failedJob = persistJob({
        ...draftJob,
        status: 'failed',
        lastError:
          provider === 'gemini'
            ? normalizeProviderError(error)
            : provider === 'deepseek'
              ? normalizeDeepSeekError(error)
            : normalizeErrorMessage(error),
      })
      return sanitizeJob(failedJob)
    }
  }

  async function processGeminiJob(jobId) {
    const currentJob = store.getJob(jobId)
    if (!currentJob || currentJob.provider !== 'gemini' || TERMINAL_STATUSES.has(currentJob.status)) {
      return sanitizeJob(currentJob)
    }

    try {
      const response = await getClient('gemini').generateStructuredContent({
        model: currentJob.model,
        prompt: currentJob.requestSnapshot.prompt,
        schema: MEETING_SCHEDULE_SCHEMA,
      })

      const responseText =
        response.candidates?.[0]?.content?.parts
          ?.map((part) => part.text || '')
          .join('\n')
          .trim() || ''

      const parsedResult = JSON.parse(responseText)
      const completedJob = persistJob({
        ...currentJob,
        status: 'completed',
        responseStatus: 'completed',
        rawResponse: response,
        resultText: responseText,
        result: parsedResult,
      })
      return sanitizeJob(completedJob)
    } catch (error) {
      const failedJob = persistJob({
        ...currentJob,
        status: 'failed',
        lastError: normalizeProviderError(error),
      })
      return sanitizeJob(failedJob)
    }
  }

  async function processDeepSeekJob(jobId) {
    const currentJob = store.getJob(jobId)
    if (!currentJob || currentJob.provider !== 'deepseek' || TERMINAL_STATUSES.has(currentJob.status)) {
      return sanitizeJob(currentJob)
    }

    try {
      const response = await getClient('deepseek').createJsonCompletion({
        model: currentJob.model,
        prompt: currentJob.requestSnapshot.prompt,
      })

      const responseText = extractDeepSeekResponseText(response)
      const parsedResult = JSON.parse(responseText)
      const completedJob = persistJob({
        ...currentJob,
        status: 'completed',
        responseStatus: 'completed',
        rawResponse: response,
        resultText: responseText,
        result: parsedResult,
      })
      return sanitizeJob(completedJob)
    } catch (error) {
      const failedJob = persistJob({
        ...currentJob,
        status: 'failed',
        lastError: normalizeDeepSeekError(error),
      })
      return sanitizeJob(failedJob)
    }
  }

  async function pollJob(jobId) {
    const currentJob = store.getJob(jobId)
    if (!currentJob || !currentJob.responseId || TERMINAL_STATUSES.has(currentJob.status)) {
      return sanitizeJob(currentJob)
    }

    const pollingJob = persistJob({
      ...currentJob,
      status: 'polling',
      lastError: '',
    })

    try {
      const response = await getClient('openai').retrieveResponse(pollingJob.responseId)
      const nextStatus = response.status || 'submitted'

      if (nextStatus === 'completed') {
        try {
          const responseText = extractResponseText(response)
          const parsedResult = JSON.parse(responseText)
          const completedJob = persistJob({
            ...pollingJob,
            status: 'completed',
            responseStatus: nextStatus,
            rawResponse: response,
            resultText: responseText,
            result: parsedResult,
          })
          return sanitizeJob(completedJob)
        } catch (error) {
          const failedJob = persistJob({
            ...pollingJob,
            status: 'failed',
            responseStatus: nextStatus,
            rawResponse: response,
            lastError: `模型已返回结果，但解析 JSON 失败：${normalizeErrorMessage(error, '无可用错误信息')}`,
          })
          return sanitizeJob(failedJob)
        }
      }

      if (TERMINAL_STATUSES.has(nextStatus)) {
        const failedJob = persistJob({
          ...pollingJob,
          status: nextStatus,
          responseStatus: nextStatus,
          rawResponse: response,
          lastError: nextStatus === 'cancelled' ? '任务已取消。' : pollingJob.lastError,
        })
        return sanitizeJob(failedJob)
      }

      const nextJob = persistJob({
        ...pollingJob,
        status: nextStatus,
        responseStatus: nextStatus,
      })
      schedulePoll(nextJob.id, getPollDelayMs(nextJob))
      return sanitizeJob(nextJob)
    } catch (error) {
      const retryJob = persistJob({
        ...pollingJob,
        status: 'retry_wait',
        lastError: normalizeErrorMessage(error),
      })
      schedulePoll(retryJob.id, getPollDelayMs(retryJob))
      return sanitizeJob(retryJob)
    }
  }

  async function retryJob(jobId) {
    const currentJob = store.getJob(jobId)
    if (!currentJob?.requestSnapshot) {
      throw new Error('没有找到可重试的任务。')
    }

    const retryingJob = persistJob({
      ...currentJob,
      status: 'submitting',
      attemptCount: (currentJob.attemptCount ?? 0) + 1,
      lastError: '',
      responseId: '',
      result: null,
      resultText: '',
      rawResponse: null,
    })

    try {
      if (retryingJob.provider === 'gemini') {
        const submittedJob = persistJob({
          ...retryingJob,
          status: 'in_progress',
          responseId: `gemini-local-${retryingJob.id}-${retryingJob.attemptCount}`,
        })
        processGeminiJob(submittedJob.id).catch(() => {})
        return sanitizeJob(submittedJob)
      }

      if (retryingJob.provider === 'deepseek') {
        const submittedJob = persistJob({
          ...retryingJob,
          status: 'in_progress',
          responseId: `deepseek-local-${retryingJob.id}-${retryingJob.attemptCount}`,
        })
        processDeepSeekJob(submittedJob.id).catch(() => {})
        return sanitizeJob(submittedJob)
      }

      const response = await getClient().createBackgroundResponse({
        model: retryingJob.model,
        background: true,
        store: true,
        input: retryingJob.requestSnapshot.prompt,
        text: {
          format: {
            type: 'json_schema',
            name: 'meeting_schedule_result',
            strict: true,
            schema: MEETING_SCHEDULE_SCHEMA,
          },
        },
        metadata: {
          app: 'meeting-manager',
          batchId: retryingJob.batchId,
          jobId: retryingJob.id,
          retryAttempt: retryingJob.attemptCount,
        },
      })

      const submittedJob = persistJob({
        ...retryingJob,
        responseId: response.id,
        status: response.status || 'submitted',
      })
      schedulePoll(submittedJob.id, getPollDelayMs(submittedJob))
      return sanitizeJob(submittedJob)
    } catch (error) {
      const failedJob = persistJob({
        ...retryingJob,
        status: 'failed',
        lastError:
          retryingJob.provider === 'gemini'
            ? normalizeProviderError(error)
            : retryingJob.provider === 'deepseek'
              ? normalizeDeepSeekError(error)
            : normalizeErrorMessage(error),
      })
      return sanitizeJob(failedJob)
    }
  }

  function listJobs() {
    return store.listJobs().map(sanitizeJob)
  }

  function getJob(jobId) {
    return sanitizeJob(store.getJob(jobId))
  }

  function registerImportedJob(payload = {}) {
    const createdAt = toIsoNow()
    const provider =
      payload.provider === 'gemini'
        ? 'gemini'
        : payload.provider === 'deepseek'
          ? 'deepseek'
          : payload.provider === 'imported'
            ? 'imported'
            : 'openai'
    const nextJob = persistJob({
      id: payload.id || createImportedJobId(),
      batchId: payload.batchId || `imported-batch-${Date.now()}`,
      provider,
      model: payload.model || '导入方案',
      status: 'completed',
      createdAt,
      updatedAt: createdAt,
      attemptCount: 1,
      promptVersion: payload.promptVersion || 'imported',
      requestSnapshot: {
        prompt: '',
        inputMeetings: payload.inputMeetings ?? null,
        preferences: payload.preferences ?? null,
        exportBatch: payload.exportBatch ?? null,
      },
      responseId: `imported-local-${Date.now()}`,
      responseStatus: 'completed',
      lastError: '',
      result: payload.result ?? null,
      resultText: payload.result ? JSON.stringify(payload.result) : '',
      rawResponse: null,
    })

    return sanitizeJob(nextJob)
  }

  function initialize() {
    store.listJobs().forEach((job) => {
      if (ACTIVE_STATUSES.has(job.status) && job.responseId) {
        if (job.provider === 'gemini') {
          processGeminiJob(job.id).catch(() => {})
        } else if (job.provider === 'deepseek') {
          processDeepSeekJob(job.id).catch(() => {})
        } else {
          schedulePoll(job.id, 2_000)
        }
      }
    })

    ipcMain.handle('ai-jobs:list', async () => listJobs())
    ipcMain.handle('ai-jobs:get', async (_, jobId) => getJob(jobId))
    ipcMain.handle('ai-jobs:submit', async (_, payload) => submitJob(payload))
    ipcMain.handle('ai-jobs:retry', async (_, jobId) => retryJob(jobId))
    ipcMain.handle('ai-jobs:register-imported', async (_, payload) => registerImportedJob(payload))
  }

  return {
    initialize,
  }
}

module.exports = {
  createAiJobService,
}
