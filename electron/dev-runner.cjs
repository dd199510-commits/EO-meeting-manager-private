const { execFileSync, spawn } = require('child_process')
const http = require('http')
const path = require('path')

const DEV_URL = process.env.ELECTRON_RENDERER_URL || 'http://127.0.0.1:4173'
const VITE_PORT = Number(new URL(DEV_URL).port || 4173)
const projectRoot = path.join(__dirname, '..')

function waitForServer(url, timeoutMs = 30_000) {
  const startedAt = Date.now()

  return new Promise((resolve, reject) => {
    function probe() {
      const request = http.get(url, (response) => {
        response.resume()
        resolve()
      })

      request.on('error', () => {
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`等待前端开发服务器超时：${url}`))
          return
        }

        setTimeout(probe, 500)
      })
    }

    probe()
  })
}

function canReachUrl(url, timeoutMs = 1_500) {
  return new Promise((resolve) => {
    const request = http.get(url, (response) => {
      response.resume()
      resolve(true)
    })

    request.setTimeout(timeoutMs, () => {
      request.destroy()
      resolve(false)
    })

    request.on('error', () => resolve(false))
  })
}

function clearPortIfOccupied(port) {
  try {
    const output = execFileSync('lsof', ['-ti', `tcp:${port}`], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()

    if (!output) return

    const pids = output
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean)

    for (const pid of pids) {
      try {
        process.kill(Number(pid), 'SIGTERM')
      } catch {
        // Ignore processes that exit between lookup and kill.
      }
    }
  } catch {
    // Ignore "no matching process" and environments without lsof.
  }
}

function spawnProcess(command, args, extraEnv = {}) {
  return spawn(command, args, {
    cwd: projectRoot,
    env: {
      ...process.env,
      ...extraEnv,
    },
    stdio: 'inherit',
    shell: false,
  })
}

async function main() {
  const hasExistingServer = await canReachUrl(DEV_URL)
  const vite =
    hasExistingServer
      ? null
      : (() => {
          clearPortIfOccupied(VITE_PORT)

          return spawnProcess(process.execPath, [
            path.join(projectRoot, 'node_modules/vite/bin/vite.js'),
            '--host',
            '127.0.0.1',
            '--port',
            String(VITE_PORT),
            '--strictPort',
          ])
        })()

  let electron = null
  let shuttingDown = false

  function shutdown(code = 0) {
    if (shuttingDown) return
    shuttingDown = true

    if (electron && !electron.killed) {
      electron.kill('SIGTERM')
    }
    if (vite && !vite.killed) {
      vite.kill('SIGTERM')
    }

    setTimeout(() => {
      process.exit(code)
    }, 200)
  }

  process.on('SIGINT', () => shutdown(0))
  process.on('SIGTERM', () => shutdown(0))

  if (vite) {
    vite.on('exit', (code) => {
      if (!shuttingDown) {
        shutdown(code ?? 1)
      }
    })
  }

  try {
    await waitForServer(DEV_URL)
  } catch (error) {
    console.error(error.message)
    shutdown(1)
    return
  }

  electron = spawnProcess(
    path.join(projectRoot, 'node_modules/.bin/electron'),
    ['.'],
    { ELECTRON_RENDERER_URL: DEV_URL },
  )

  electron.on('exit', (code) => {
    if (!shuttingDown) {
      shutdown(code ?? 0)
    }
  })
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
