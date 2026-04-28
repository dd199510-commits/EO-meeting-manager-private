const OPENAI_BASE_URL = 'https://api.openai.com/v1'

function normalizeErrorMessage(error, fallback = 'OpenAI 请求失败') {
  if (!error) return fallback
  if (typeof error === 'string') return error
  if (error.message) return error.message
  return fallback
}

class OpenAIClient {
  constructor({ apiKey, baseUrl = OPENAI_BASE_URL }) {
    this.apiKey = apiKey
    this.baseUrl = baseUrl
  }

  async request(path, options = {}) {
    if (!this.apiKey) {
      throw new Error('未检测到 OPENAI_API_KEY，无法提交 AI 排程任务。')
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...(options.headers ?? {}),
      },
    })

    if (!response.ok) {
      let errorMessage = `OpenAI 请求失败（${response.status}）`
      try {
        const parsed = await response.json()
        errorMessage = parsed.error?.message || errorMessage
      } catch {
        errorMessage = `${errorMessage} ${response.statusText}`.trim()
      }
      throw new Error(errorMessage)
    }

    return response.json()
  }

  async createBackgroundResponse(payload) {
    return this.request('/responses', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  }

  async retrieveResponse(responseId) {
    return this.request(`/responses/${responseId}`, {
      method: 'GET',
    })
  }
}

module.exports = {
  OpenAIClient,
  normalizeErrorMessage,
}
