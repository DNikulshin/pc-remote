import http from 'node:http'
import { log as logger } from './utils/logger.js'
import { config, state, savePasswordHash, resetAgentConfig } from './utils/config.js'
import bcrypt from 'bcryptjs'
import QRCode from 'qrcode'

const PORT = 3535
let isOnline = false
let pendingLock = false
let pendingLockMessage: string | null = null
let pendingLogoff = false
type VolumeAction = 'UP' | 'DOWN' | 'MUTE'
let pendingVolume: VolumeAction | null = null
let pendingScreenshot = false
let screenshotResultCb: ((base64: string) => void) | null = null
let pendingNotification: string | null = null

export function setOnlineStatus(online: boolean) {
  isOnline = online
}

// Запрашивает блокировку через трей (сервис в session 0 не может вызвать LockWorkStation напрямую)
export function setPendingLock(message?: string, logoff = false) {
  pendingLock = true
  pendingLockMessage = message ?? null
  pendingLogoff = logoff
}

export function setPendingVolume(action: VolumeAction) {
  pendingVolume = action
}

export function setPendingScreenshot() {
  pendingScreenshot = true
}

export function onScreenshotResult(cb: (base64: string) => void) {
  screenshotResultCb = cb
}

export function setPendingNotification(message: string) {
  pendingNotification = message
}

function checkLocalToken(req: http.IncomingMessage): boolean {
  const token = req.headers['x-local-token']
  return typeof token === 'string' && token === state.localToken
}

async function parseBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (chunk: Buffer) => { data += chunk.toString() })
    req.on('end', () => {
      try { resolve(JSON.parse(data) as Record<string, unknown>) } catch { resolve({}) }
    })
  })
}

export function startLocalServer() {
  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '127.0.0.1')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    // GET /status
    if (req.method === 'GET' && req.url === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({
        online: isOnline,
        deviceId: config.deviceId,
        bound: !!state.agentToken,
        pendingLock,
        pendingLockMessage,
        pendingLogoff,
        pendingVolume,
        pendingScreenshot,
        pendingNotification,
      }))
      return
    }

    // GET /qr — HTML-страница с QR-кодом
    if (req.method === 'GET' && req.url === '/qr') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })

      if (state.agentToken && !state.secret) {
        res.end(boundHtml())
        return
      }

      if (!state.secret) {
        res.end(waitingHtml())
        return
      }

      try {
        const bindData = JSON.stringify({ deviceId: config.deviceId, secret: state.secret })
        const svg = await QRCode.toString(bindData, { type: 'svg', width: 256 })
        res.end(qrHtml(svg, config.deviceId))
      } catch {
        res.writeHead(500)
        res.end('QR generation failed')
      }
      return
    }

    // POST endpoints
    if (req.method !== 'POST') {
      res.writeHead(404)
      res.end()
      return
    }

    const body = await parseBody(req)

    // POST /setup-password — без токена, для установщика (первая установка и переустановка)
    if (req.url === '/setup-password') {
      const password = body['password'] as string | undefined
      if (!password) { res.writeHead(400); res.end(); return }
      const hash = await bcrypt.hash(password, 10)
      savePasswordHash(hash)
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: true }))
      return
    }

    // POST /verify-password — без токена (трей вызывает его первым для аутентификации)
    if (req.url === '/verify-password') {
      const password = body['password'] as string | undefined
      if (!password || !state.passwordHash) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ valid: false }))
        return
      }
      const valid = await bcrypt.compare(password, state.passwordHash)
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ valid }))
      return
    }

    // Все остальные POST-эндпоинты требуют X-Local-Token
    if (!checkLocalToken(req)) { res.writeHead(403); res.end(); return }

    // POST /change-password
    if (req.url === '/change-password') {
      const password = body['password'] as string | undefined
      if (!password) { res.writeHead(400); res.end(); return }
      const hash = await bcrypt.hash(password, 10)
      savePasswordHash(hash)
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: true }))
      return
    }

    // POST /ack-notification — трей подтверждает что уведомление показано
    if (req.url === '/ack-notification') {
      pendingNotification = null
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: true }))
      return
    }

    // POST /ack-lock — трей подтверждает что блокировка выполнена
    if (req.url === '/ack-lock') {
      pendingLock = false
      pendingLockMessage = null
      pendingLogoff = false
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: true }))
      return
    }

    // POST /ack-volume — трей подтверждает что команда громкости принята
    if (req.url === '/ack-volume') {
      pendingVolume = null
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: true }))
      return
    }

    // POST /ack-screenshot — трей подтверждает начало захвата скриншота
    if (req.url === '/ack-screenshot') {
      pendingScreenshot = false
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: true }))
      return
    }

    // POST /screenshot-result — трей отправляет готовый скриншот (base64)
    if (req.url === '/screenshot-result') {
      const image = body['image'] as string | undefined
      if (image && screenshotResultCb) {
        logger.info(`screenshot-result received imageLen=${image.length} — forwarding to backend`)
        screenshotResultCb(image)
      } else {
        logger.warn(`screenshot-result: image=${!!image} cb=${!!screenshotResultCb}`)
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: true }))
      return
    }

    // POST /reset — сброс привязки, требует пароль в теле
    if (req.url === '/reset') {
      const password = body['password'] as string | undefined
      if (!password || !state.passwordHash) { res.writeHead(401); res.end(); return }
      const valid = await bcrypt.compare(password, state.passwordHash)
      if (!valid) { res.writeHead(403); res.end(); return }
      resetAgentConfig()
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: true }))
      setTimeout(() => process.exit(0), 500)
      return
    }

    res.writeHead(404)
    res.end()
  })

  server.listen(PORT, '127.0.0.1', () => {
    logger.info(`Local HTTP server listening on localhost:${PORT}`)
  })

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      logger.warn(`Port ${PORT} already in use — local server not started`)
    } else {
      logger.error({ err }, 'Local server error')
    }
  })
}

const style = `
  body{font-family:Arial,sans-serif;background:#0f0f23;color:#fff;
    display:flex;flex-direction:column;align-items:center;
    justify-content:center;min-height:100vh;margin:0;gap:20px;padding:24px;box-sizing:border-box}
  h2{margin:0;font-size:24px}
  p{margin:0;color:#aaa;font-size:14px;text-align:center}
  .box{background:#1a1a2e;border-radius:16px;padding:24px;display:flex;
    align-items:center;justify-content:center}
  .id{font-family:monospace;font-size:12px;color:#6c63ff;background:#1a1a2e;
    padding:8px 16px;border-radius:8px;word-break:break-all;max-width:320px;text-align:center}
`

function qrHtml(svg: string, deviceId: string) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>PC Remote — QR</title><style>${style}</style></head><body>
<h2>Отсканируй QR-код</h2>
<div class="box">${svg}</div>
<p>Открой мобильное приложение → Добавить устройство</p>
<div class="id">${deviceId}</div>
<script>setInterval(()=>fetch('/status').then(r=>r.json()).then(d=>{
  if(d.bound&&!d.secret)location.reload()
}),3000)</script>
</body></html>`
}

function boundHtml() {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>PC Remote</title><style>${style}</style></head><body>
<h2>✅ Устройство привязано</h2>
<p>Для перепривязки используйте «Сбросить привязку» в меню трея.</p>
</body></html>`
}

function waitingHtml() {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>PC Remote</title><style>${style}</style></head><body>
<h2>⏳ Подождите...</h2>
<p>Агент запускается, QR-код скоро появится.</p>
<script>setTimeout(()=>location.reload(),3000)</script>
</body></html>`
}
