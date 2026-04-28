const fs = require('fs')
const path = require('path')
const { safeStorage } = require('electron')

class ConfigStore {
  constructor(app) {
    this.filePath = path.join(app.getPath('userData'), 'ai-config.json')
  }

  ensureDirectory() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
  }

  readRaw() {
    this.ensureDirectory()
    if (!fs.existsSync(this.filePath)) {
      return {}
    }

    try {
      return JSON.parse(fs.readFileSync(this.filePath, 'utf8'))
    } catch {
      return {}
    }
  }

  writeRaw(data) {
    this.ensureDirectory()
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf8')
  }

  saveApiKey(provider, apiKey) {
    const current = this.readRaw()
    const keyName = this.getKeyName(provider)
    const next = {
      ...current,
      [keyName]: this.encrypt(apiKey),
      updatedAt: new Date().toISOString(),
    }
    this.writeRaw(next)
  }

  readApiKey(provider) {
    const current = this.readRaw()
    return this.decrypt(current[this.getKeyName(provider)])
  }

  deleteApiKey(provider) {
    const current = this.readRaw()
    const keyName = this.getKeyName(provider)
    this.writeRaw({
      ...current,
      [keyName]: null,
      updatedAt: new Date().toISOString(),
    })
  }

  getKeyName(provider) {
    if (provider === 'gemini') return 'geminiApiKey'
    if (provider === 'deepseek') return 'deepseekApiKey'
    return 'openaiApiKey'
  }

  encrypt(value) {
    if (!value) return null

    if (safeStorage.isEncryptionAvailable()) {
      const encryptedPayload = {
        mode: 'safeStorage',
        value: safeStorage.encryptString(value).toString('base64'),
      }

      if (this.decrypt(encryptedPayload) === value) {
        return encryptedPayload
      }
    }

    return {
      mode: 'plain',
      value,
    }
  }

  decrypt(payload) {
    if (!payload?.value) return ''

    if (payload.mode === 'safeStorage') {
      try {
        return safeStorage.decryptString(Buffer.from(payload.value, 'base64'))
      } catch {
        return ''
      }
    }

    return payload.value
  }

  getPublicConfig() {
    const current = this.readRaw()
    return {
      providers: {
        openai: {
          hasApiKey: Boolean(this.decrypt(current.openaiApiKey)),
        },
        gemini: {
          hasApiKey: Boolean(this.decrypt(current.geminiApiKey)),
        },
        deepseek: {
          hasApiKey: Boolean(this.decrypt(current.deepseekApiKey)),
        },
      },
      encryptionMode:
        current.openaiApiKey?.mode === 'safeStorage' ||
        current.geminiApiKey?.mode === 'safeStorage' ||
        current.deepseekApiKey?.mode === 'safeStorage'
          ? 'safeStorage'
          : safeStorage.isEncryptionAvailable()
            ? 'safeStorage'
            : 'plain',
      updatedAt: current.updatedAt ?? '',
    }
  }
}

module.exports = {
  ConfigStore,
}
