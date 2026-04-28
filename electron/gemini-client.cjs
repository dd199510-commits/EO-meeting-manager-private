const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'

function normalizeProviderError(error, fallback = 'Gemini 请求失败') {
  if (!error) return fallback
  if (typeof error === 'string') return error
  if (error.message) return error.message
  return fallback
}

function toGeminiSchema(schema) {
  if (!schema || typeof schema !== 'object') return undefined

  if (Array.isArray(schema.type)) {
    const nextSchema = { ...schema, type: schema.type[0] }
    return toGeminiSchema(nextSchema)
  }

  const normalized = {}

  if (typeof schema.type === 'string') {
    normalized.type = schema.type.toUpperCase()
  }

  if (schema.description) normalized.description = schema.description
  if (schema.required) normalized.required = schema.required

  if (schema.properties && typeof schema.properties === 'object') {
    normalized.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([key, value]) => [key, toGeminiSchema(value)]),
    )
  }

  if (schema.items) {
    normalized.items = toGeminiSchema(schema.items)
  }

  if (Array.isArray(schema.enum)) {
    normalized.enum = schema.enum
  }

  return normalized
}

class GeminiClient {
  constructor({ apiKey, baseUrl = GEMINI_BASE_URL }) {
    this.apiKey = apiKey
    this.baseUrl = baseUrl
  }

  async request(path, options = {}) {
    if (!this.apiKey) {
      throw new Error('未检测到 Gemini API Key，无法提交 AI 排程任务。')
    }

    const separator = path.includes('?') ? '&' : '?'
    const response = await fetch(`${this.baseUrl}${path}${separator}key=${encodeURIComponent(this.apiKey)}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers ?? {}),
      },
    })

    if (!response.ok) {
      let errorMessage = `Gemini 请求失败（${response.status}）`
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

  async generateStructuredContent({ model, prompt, schema }) {
    return this.request(`/models/${model}:generateContent`, {
      method: 'POST',
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: toGeminiSchema(schema),
        },
      }),
    })
  }
}

module.exports = {
  GeminiClient,
  normalizeProviderError,
}
