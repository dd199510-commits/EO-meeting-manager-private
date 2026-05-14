import { useMemo, useState } from 'react'

const ACCESS_SESSION_KEY = 'meeting-manager:access-unlocked:v1'

function isAccessLockEnabled() {
  return import.meta.env.VITE_ENABLE_ACCESS_LOCK === 'true'
}

function getAccessPassword() {
  return String(import.meta.env.VITE_ACCESS_PASSWORD || 'ceo2026')
}

export function AccessGate({ children }) {
  const lockEnabled = useMemo(() => isAccessLockEnabled(), [])
  const [unlocked, setUnlocked] = useState(() => {
    if (!lockEnabled || typeof window === 'undefined') return true
    return window.sessionStorage.getItem(ACCESS_SESSION_KEY) === 'unlocked'
  })
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  if (unlocked) return children

  function handleSubmit(event) {
    event.preventDefault()
    if (password === getAccessPassword()) {
      window.sessionStorage.setItem(ACCESS_SESSION_KEY, 'unlocked')
      setUnlocked(true)
      return
    }

    setError('密码不对，请重新输入。')
    setPassword('')
  }

  return (
    <main className="access-gate">
      <form className="access-gate-panel" onSubmit={handleSubmit}>
        <div className="access-gate-mark" aria-hidden="true">
          <span />
        </div>
        <div className="access-gate-copy">
          <span>会议管理系统</span>
          <h1>输入访问密码</h1>
          <p>通过后才能进入页面，会议和排程数据需要自行导入。</p>
        </div>
        <label className="access-gate-field">
          <span>访问密码</span>
          <input
            autoFocus
            type="password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value)
              setError('')
            }}
            placeholder="请输入密码"
          />
        </label>
        {error ? <div className="access-gate-error">{error}</div> : null}
        <button className="access-gate-button" type="submit">
          进入
        </button>
      </form>
    </main>
  )
}
