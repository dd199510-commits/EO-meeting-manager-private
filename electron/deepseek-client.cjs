const DEEPSEEK_BASE_URL = 'https://api.deepseek.com'

function normalizeDeepSeekError(error, fallback = 'DeepSeek 请求失败') {
  if (!error) return fallback
  if (typeof error === 'string') return error
  if (error.message) return error.message
  return fallback
}

class DeepSeekClient {
  constructor({ apiKey, baseUrl = DEEPSEEK_BASE_URL }) {
    this.apiKey = apiKey
    this.baseUrl = baseUrl.replace(/\/$/, '')
  }

  async request(path, options = {}) {
    if (!this.apiKey) {
      throw new Error('未检测到 DEEPSEEK_API_KEY，无法提交 AI 排程任务。')
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
      let errorMessage = `DeepSeek 请求失败（${response.status}）`
      try {
        const parsed = await response.json()
        errorMessage = parsed.error?.message || parsed.message || errorMessage
      } catch {
        errorMessage = `${errorMessage} ${response.statusText}`.trim()
      }
      throw new Error(errorMessage)
    }

    return response.json()
  }

  async createJsonCompletion({ model, prompt }) {
    return this.request('/chat/completions', {
      method: 'POST',
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content:
              '你是会议排程助手。必须只输出可解析的 JSON 对象，不要输出 Markdown、解释文字或代码块。',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 32768,
        reasoning_effort: 'high',
        thinking: {
          type: 'enabled',
        },
      }),
    })
  }
}

module.exports = {
  DeepSeekClient,
  normalizeDeepSeekError,
}
