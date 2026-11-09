import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { api, BASE, registerUser } from './helpers.js'
import { randomUUID } from 'crypto'
import { io as socketClient, Socket } from 'socket.io-client'

// Подключается как агент и резолвится, когда WS-соединение установлено
// (к этому моменту бекенд уже погасил bootstrap-секрет)
async function connectAgent(agentToken: string): Promise<Socket> {
  return new Promise<Socket>((resolve, reject) => {
    const socket = socketClient(`${BASE}/agents`, {
      auth: { token: agentToken },
      transports: ['websocket'],
    })

    const timeout = setTimeout(() => {
      socket.disconnect()
      reject(new Error('WebSocket connection timed out'))
    }, 8000)

    socket.on('connect', () => {
      clearTimeout(timeout)
      resolve(socket)
    })

    socket.on('connect_error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })
  })
}

// Шлёт кадр от уже подключённого агента и резолвится, когда сервер
// подтвердил обработку (ack в `agent:screenshot`) — без фиксированных пауз
async function emitScreenshot(socket: Socket, image: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Screenshot ack timed out'))
    }, 5000)

    socket.emit(
      'agent:screenshot',
      { image, capturedAt: new Date().toISOString() },
      () => {
        clearTimeout(timeout)
        resolve()
      }
    )
  })
}

// Ждёт `server:command` на сокете; false — если событие не пришло за timeoutMs
function waitForCommand(socket: Socket, timeoutMs: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let timer: ReturnType<typeof setTimeout>

    const onCommand = () => {
      clearTimeout(timer)
      socket.off('server:command', onCommand)
      resolve(true)
    }

    timer = setTimeout(() => {
      socket.off('server:command', onCommand)
      resolve(false)
    }, timeoutMs)

    socket.on('server:command', onCommand)
  })
}

// Сентинел «событие не пришло за timeoutMs» — payload события может быть
// undefined (например, `server:unbind` приходит без данных)
const EVENT_TIMEOUT = Symbol('event-timeout')

// Ждёт произвольное событие; EVENT_TIMEOUT — если оно не пришло за timeoutMs
// (таймаут используется только для проверки ОТСУТСТВИЯ доставки)
function waitForEvent<T = unknown>(
  socket: Socket,
  event: string,
  timeoutMs: number
): Promise<T | typeof EVENT_TIMEOUT> {
  return new Promise<T | typeof EVENT_TIMEOUT>((resolve) => {
    let timer: ReturnType<typeof setTimeout>

    const onEvent = (payload: T) => {
      clearTimeout(timer)
      socket.off(event, onEvent)
      resolve(payload)
    }

    timer = setTimeout(() => {
      socket.off(event, onEvent)
      resolve(EVENT_TIMEOUT)
    }, timeoutMs)

    socket.on(event, onEvent)
  })
}

// Шлёт heartbeat и резолвится, когда сервер подтвердил обработку (ack)
async function emitHeartbeat(
  socket: Socket,
  payload: Record<string, unknown>
): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Heartbeat ack timed out'))
    }, 5000)

    socket.emit('agent:heartbeat', payload, (res?: unknown) => {
      clearTimeout(timeout)
      resolve(res)
    })
  })
}

// Шлёт локальных пользователей и ждёт ack обработки (без фиксированных пауз)
async function emitLocalUsers(
  socket: Socket,
  payload: Record<string, unknown>
): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Local users ack timed out'))
    }, 5000)

    socket.emit('agent:local:users', payload, (res?: unknown) => {
      clearTimeout(timeout)
      resolve(res)
    })
  })
}

// Ждёт, пока GET /:id/token начнёт отвечать ожидаемым статусом
async function waitForTokenStatus(
  deviceId: string,
  secret: string,
  expected: number,
  timeoutMs = 5000
): Promise<number> {
  const deadline = Date.now() + timeoutMs
  let status = (
    await api(`/api/devices/${deviceId}/token`, { headers: { 'x-device-secret': secret } })
  ).status

  while (status !== expected && Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 100))
    status = (
      await api(`/api/devices/${deviceId}/token`, { headers: { 'x-device-secret': secret } })
    ).status
  }

  return status
}

describe('Devices API', () => {
  let accessToken: string
  let deviceId: string
  let deviceSecret: string

  // Регистрируем юзера один раз для всего suite
  beforeAll(async () => {
    const user = await registerUser()
    accessToken = user.accessToken
  })

  // ─── /api/devices/init (публичный) ────────────────────────────────────────

  describe('POST /api/devices/init', () => {
    it('201 — агент регистрирует устройство', async () => {
      deviceId = randomUUID()
      const { status, body } = await api('/api/devices/init', {
        method: 'POST',
        body: JSON.stringify({ deviceId, timezone: 'Europe/Moscow' }),
      })
      expect(status).toBe(201)
      const b = body as Record<string, unknown>
      expect(b).toMatchObject({ deviceId, secret: expect.any(String) })
      deviceSecret = b['secret'] as string
    })

    it('400 — без deviceId', async () => {
      const { status } = await api('/api/devices/init', {
        method: 'POST',
        body: JSON.stringify({ timezone: 'UTC' }),
      })
      expect(status).toBe(400)
    })

    it('409 — повторная инициализация того же deviceId', async () => {
      const { status } = await api('/api/devices/init', {
        method: 'POST',
        body: JSON.stringify({ deviceId, timezone: 'UTC' }),
      })
      expect(status).toBe(409)
    })
  })

  // ─── /api/devices/bind ────────────────────────────────────────────────────

  describe('POST /api/devices/bind', () => {
    it('201 — привязывает устройство к юзеру', async () => {
      const { status, body } = await api('/api/devices/bind', {
        method: 'POST',
        token: accessToken,
        body: JSON.stringify({ deviceId, secret: deviceSecret, name: 'Test PC' }),
      })
      expect(status).toBe(201)
      const b = body as { device: { id: string } }
      expect(b.device.id).toBe(deviceId)
    })

    it('401 — без токена', async () => {
      const { status } = await api('/api/devices/bind', {
        method: 'POST',
        body: JSON.stringify({ deviceId: randomUUID(), secret: 'any', name: 'X' }),
      })
      expect(status).toBe(401)
    })

    it('403 — неверный secret', async () => {
      const newId = randomUUID()
      await api('/api/devices/init', {
        method: 'POST',
        body: JSON.stringify({ deviceId: newId }),
      })
      const { status } = await api('/api/devices/bind', {
        method: 'POST',
        token: accessToken,
        body: JSON.stringify({ deviceId: newId, secret: 'a'.repeat(32), name: 'X' }),
      })
      expect(status).toBe(403)
    })
  })

  // ─── GET /api/devices ─────────────────────────────────────────────────────

  describe('GET /api/devices', () => {
    it('200 — возвращает список устройств юзера', async () => {
      const { status, body } = await api('/api/devices', { token: accessToken })
      expect(status).toBe(200)
      expect(Array.isArray(body)).toBe(true)
      const list = body as Array<{ id: string }>
      expect(list.some((d) => d.id === deviceId)).toBe(true)
    })

    it('401 — без токена', async () => {
      const { status } = await api('/api/devices')
      expect(status).toBe(401)
    })
  })

  // ─── GET /api/devices/:id/token ───────────────────────────────────────────

  describe('GET /api/devices/:id/token', () => {
    let unboundId: string
    let unboundSecret: string
    let boundAgentToken: string

    beforeAll(async () => {
      unboundId = randomUUID()
      const initRes = await api('/api/devices/init', {
        method: 'POST',
        body: JSON.stringify({ deviceId: unboundId, timezone: 'UTC' }),
      })
      unboundSecret = (initRes.body as { secret: string }).secret
    })

    it('401 — без заголовка x-device-secret', async () => {
      const { status } = await api(`/api/devices/${unboundId}/token`)
      expect(status).toBe(401)
    })

    it('403 — неверный secret', async () => {
      const { status } = await api(`/api/devices/${unboundId}/token`, {
        headers: { 'x-device-secret': 'a'.repeat(64) },
      })
      expect(status).toBe(403)
    })

    it('404 — неизвестный deviceId', async () => {
      const { status } = await api(`/api/devices/${randomUUID()}/token`, {
        headers: { 'x-device-secret': unboundSecret },
      })
      expect(status).toBe(404)
    })

    it('200 — { agentToken: null } пока устройство не привязано', async () => {
      const { status, body } = await api(`/api/devices/${unboundId}/token`, {
        headers: { 'x-device-secret': unboundSecret },
      })
      expect(status).toBe(200)
      expect(body).toEqual({ agentToken: null })
    })

    it('200 — возвращает agentToken после привязки', async () => {
      const bindRes = await api('/api/devices/bind', {
        method: 'POST',
        token: accessToken,
        body: JSON.stringify({ deviceId: unboundId, secret: unboundSecret, name: 'Token PC' }),
      })
      expect(bindRes.status).toBe(201)
      boundAgentToken = (bindRes.body as { agentToken: string }).agentToken

      const { status, body } = await api(`/api/devices/${unboundId}/token`, {
        headers: { 'x-device-secret': unboundSecret },
      })
      expect(status).toBe(200)
      expect(body).toEqual({ agentToken: boundAgentToken })
    })

    it('200 — поллинг идемпотентен: после bind secret ещё валиден (агент не подключён)', async () => {
      // Гашение перенесено в WS-аутентификацию, поэтому повторный (и потерянный)
      // поллинг снова возвращает тот же токен
      const { status, body } = await api(`/api/devices/${unboundId}/token`, {
        headers: { 'x-device-secret': unboundSecret },
      })
      expect(status).toBe(200)
      expect(body).toEqual({ agentToken: boundAgentToken })
    })

    it('два параллельных GET /token — оба 200 и одинаковый agentToken', async () => {
      const parallelId = randomUUID()
      const initRes = await api('/api/devices/init', {
        method: 'POST',
        body: JSON.stringify({ deviceId: parallelId, timezone: 'UTC' }),
      })
      const parallelSecret = (initRes.body as { secret: string }).secret
      const bindRes = await api('/api/devices/bind', {
        method: 'POST',
        token: accessToken,
        body: JSON.stringify({ deviceId: parallelId, secret: parallelSecret, name: 'Parallel PC' }),
      })
      expect(bindRes.status).toBe(201)
      const expectedToken = (bindRes.body as { agentToken: string }).agentToken

      const [first, second] = await Promise.all([
        api(`/api/devices/${parallelId}/token`, {
          headers: { 'x-device-secret': parallelSecret },
        }),
        api(`/api/devices/${parallelId}/token`, {
          headers: { 'x-device-secret': parallelSecret },
        }),
      ])

      expect(first.status).toBe(200)
      expect(second.status).toBe(200)
      expect(first.body).toEqual({ agentToken: expectedToken })
      expect(second.body).toEqual({ agentToken: expectedToken })
    })

    it('403 — secret погашается после WS-подключения агента (bootstrap одноразовый)', async () => {
      // Агент получил токен поллингом и подключился — только теперь сервер гасит secret
      const socket = await connectAgent(boundAgentToken)

      try {
        const status = await waitForTokenStatus(unboundId, unboundSecret, 403)
        expect(status).toBe(403)

        const { body } = await api(`/api/devices/${unboundId}/token`, {
          headers: { 'x-device-secret': unboundSecret },
        })
        expect(body).toMatchObject({ error: expect.any(String) })
        expect(JSON.stringify(body)).not.toContain('agentToken')
      } finally {
        socket.disconnect()
      }
    })

    it('403 — secret от другого устройства', async () => {
      // У каждого устройства свой secret: чужой (deviceSecret) не подходит
      const otherId = randomUUID()
      await api('/api/devices/init', {
        method: 'POST',
        body: JSON.stringify({ deviceId: otherId, timezone: 'UTC' }),
      })

      const { status } = await api(`/api/devices/${otherId}/token`, {
        headers: { 'x-device-secret': deviceSecret },
      })
      expect(status).toBe(403)
    })
  })

  // ─── GET /api/devices/:id ─────────────────────────────────────────────────

  describe('GET /api/devices/:id', () => {
    it('200 — возвращает устройство', async () => {
      const { status, body } = await api(`/api/devices/${deviceId}`, {
        token: accessToken,
      })
      expect(status).toBe(200)
      const b = body as Record<string, unknown>
      expect(b['id']).toBe(deviceId)
      // secret и agentToken не должны утекать
      expect(b['secret']).toBeUndefined()
      expect(b['agentToken']).toBeUndefined()
    })

    it('404 — несуществующий id', async () => {
      const { status } = await api(`/api/devices/${randomUUID()}`, {
        token: accessToken,
      })
      expect(status).toBe(404)
    })
  })

  // ─── POST /api/devices/:id/commands ───────────────────────────────────────

  describe('POST /api/devices/:id/commands', () => {
    it('202 — команда принята', async () => {
      const { status, body } = await api(`/api/devices/${deviceId}/commands`, {
        method: 'POST',
        token: accessToken,
        body: JSON.stringify({ type: 'LOCK' }),
      })
      expect(status).toBe(202)
      const b = body as { command: { id: string; type: string; status: string }; delivered: boolean }
      expect(b.command).toMatchObject({ id: expect.any(String), type: 'LOCK' })
      expect(typeof b.delivered).toBe('boolean')
    })

    it('400 — неизвестный тип команды', async () => {
      const { status } = await api(`/api/devices/${deviceId}/commands`, {
        method: 'POST',
        token: accessToken,
        body: JSON.stringify({ type: 'UNKNOWN_CMD' }),
      })
      expect(status).toBe(400)
    })
  })

  // ─── GET /api/devices/:id/commands ────────────────────────────────────────

  describe('GET /api/devices/:id/commands', () => {
    it('200 — возвращает историю команд', async () => {
      const { status, body } = await api(`/api/devices/${deviceId}/commands`, {
        token: accessToken,
      })
      expect(status).toBe(200)
      expect(Array.isArray(body)).toBe(true)
    })
  })

  // ─── POST /api/devices/:id/commands — новые типы Этап 5 ──────────────────

  describe('POST /api/devices/:id/commands — новые типы', () => {
    it.each(['VOLUME_UP', 'VOLUME_DOWN', 'VOLUME_MUTE', 'SCREENSHOT'])(
      '202 — команда %s принята',
      async (type) => {
        const { status, body } = await api(`/api/devices/${deviceId}/commands`, {
          method: 'POST',
          token: accessToken,
          body: JSON.stringify({ type }),
        })
        expect(status).toBe(202)
        const b = body as { command: { type: string } }
        expect(b.command.type).toBe(type)
      }
    )
  })

  // ─── PUT /api/devices/:id/schedule ────────────────────────────────────────

  describe('PUT /api/devices/:id/schedule', () => {
    it('200 — сохраняет расписание с downtime и dailyLimit', async () => {
      const schedule = {
        timezone: 'Europe/Moscow',
        enabled: true,
        days: { '1': [{ start: '09:00', end: '22:00' }] },
        downtime: { enabled: true, start: '23:00', end: '07:00' },
        dailyLimit: { enabled: true, minutesWeekday: 120, minutesWeekend: 240 },
      }
      const { status, body } = await api(`/api/devices/${deviceId}/schedule`, {
        method: 'PUT',
        token: accessToken,
        body: JSON.stringify(schedule),
      })
      expect(status).toBe(200)
      const b = body as Record<string, unknown>
      expect(b['enabled']).toBe(true)
      expect(b['downtime']).toMatchObject({ enabled: true, start: '23:00', end: '07:00' })
      expect(b['dailyLimit']).toMatchObject({ enabled: true, minutesWeekday: 120 })
    })

    it('400 — неверный формат времени (не HH:MM)', async () => {
      const { status } = await api(`/api/devices/${deviceId}/schedule`, {
        method: 'PUT',
        token: accessToken,
        body: JSON.stringify({
          timezone: 'UTC',
          enabled: true,
          days: {},
          downtime: { enabled: true, start: '9:00', end: '07:00' },
        }),
      })
      expect(status).toBe(400)
    })

    it('401 — без токена', async () => {
      const { status } = await api(`/api/devices/${deviceId}/schedule`, {
        method: 'PUT',
        body: JSON.stringify({ timezone: 'UTC', enabled: false, days: {} }),
      })
      expect(status).toBe(401)
    })
  })

  // ─── POST /api/devices/:id/schedule/bonus ─────────────────────────────────

  describe('POST /api/devices/:id/schedule/bonus', () => {
    it('200 — добавляет бонусное время', async () => {
      const { status, body } = await api(`/api/devices/${deviceId}/schedule/bonus`, {
        method: 'POST',
        token: accessToken,
        body: JSON.stringify({ minutes: 30 }),
      })
      expect(status).toBe(200)
      const b = body as { minutes: number; delivered: boolean }
      expect(b.minutes).toBe(30)
      expect(typeof b.delivered).toBe('boolean')
    })

    it('400 — minutes вне диапазона (0)', async () => {
      const { status } = await api(`/api/devices/${deviceId}/schedule/bonus`, {
        method: 'POST',
        token: accessToken,
        body: JSON.stringify({ minutes: 0 }),
      })
      expect(status).toBe(400)
    })

    it('400 — minutes вне диапазона (>120)', async () => {
      const { status } = await api(`/api/devices/${deviceId}/schedule/bonus`, {
        method: 'POST',
        token: accessToken,
        body: JSON.stringify({ minutes: 121 }),
      })
      expect(status).toBe(400)
    })
  })

  // ─── GET /api/devices/:id/screenshot ──────────────────────────────────────

  describe('GET /api/devices/:id/screenshot', () => {
    it('404 — скриншот ещё не получен (агент не подключён)', async () => {
      const { status } = await api(`/api/devices/${deviceId}/screenshot`, {
        token: accessToken,
      })
      expect(status).toBe(404)
    })

    it('404 — чужое устройство', async () => {
      const { status } = await api(`/api/devices/${randomUUID()}/screenshot`, {
        token: accessToken,
      })
      expect(status).toBe(404)
    })

    it('401 — без токена', async () => {
      const { status } = await api(`/api/devices/${deviceId}/screenshot`)
      expect(status).toBe(401)
    })
  })

  // ─── DELETE /api/devices/:id ──────────────────────────────────────────────

  describe('DELETE /api/devices/:id', () => {
    it('204 — удаляет устройство', async () => {
      // Создаём отдельное устройство специально для удаления
      const tempId = randomUUID()
      const initRes = await api('/api/devices/init', {
        method: 'POST',
        body: JSON.stringify({ deviceId: tempId }),
      })
      const { secret } = initRes.body as { secret: string }
      await api('/api/devices/bind', {
        method: 'POST',
        token: accessToken,
        body: JSON.stringify({ deviceId: tempId, secret, name: 'Temp PC' }),
      })

      const { status } = await api(`/api/devices/${tempId}`, {
        method: 'DELETE',
        token: accessToken,
      })
      expect(status).toBe(204)
    })

    it('404 — удаление чужого/несуществующего устройства', async () => {
      const { status } = await api(`/api/devices/${randomUUID()}`, {
        method: 'DELETE',
        token: accessToken,
      })
      expect(status).toBe(404)
    })
  })

  // ─── WebSocket: изоляция скриншота между пользователями ──────────────────

  describe('GET /api/devices/:id/screenshot — изоляция между аккаунтами', () => {
    let ownerToken: string
    let strangerToken: string
    let shotDeviceId: string
    let shotAgentToken: string

    beforeAll(async () => {
      const owner = await registerUser()
      const stranger = await registerUser()
      ownerToken = owner.accessToken
      strangerToken = stranger.accessToken

      shotDeviceId = randomUUID()
      const initRes = await api('/api/devices/init', {
        method: 'POST',
        body: JSON.stringify({ deviceId: shotDeviceId, timezone: 'UTC' }),
      })
      const { secret } = initRes.body as { secret: string }
      const bindRes = await api('/api/devices/bind', {
        method: 'POST',
        token: ownerToken,
        body: JSON.stringify({ deviceId: shotDeviceId, secret, name: 'Screenshot PC' }),
      })
      shotAgentToken = (bindRes.body as { agentToken: string }).agentToken
    })

    it('владелец получает 200, чужой пользователь — 404', async () => {
      const image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='
      const socket = await connectAgent(shotAgentToken)
      try {
        await emitScreenshot(socket, image)
      } finally {
        socket.disconnect()
      }

      const owner = await api(`/api/devices/${shotDeviceId}/screenshot`, {
        token: ownerToken,
      })
      expect(owner.status).toBe(200)
      const ownerBody = owner.body as { image: string; capturedAt: string }
      expect(ownerBody.image).toBe(image)
      expect(typeof ownerBody.capturedAt).toBe('string')

      // Утечка между аккаунтами: чужой юзер не должен получить кэшированный кадр
      const stranger = await api(`/api/devices/${shotDeviceId}/screenshot`, {
        token: strangerToken,
      })
      expect(stranger.status).toBe(404)
    })
  })

  // ─── DELETE /api/devices/:id — очистка кэша скриншота ────────────────────

  describe('DELETE /api/devices/:id — очистка кэша скриншота', () => {
    it('после удаления старый кадр не достаётся новому владельцу', async () => {
      const firstToken = (await registerUser()).accessToken
      const secondToken = (await registerUser()).accessToken

      const reusedId = randomUUID()
      const initRes = await api('/api/devices/init', {
        method: 'POST',
        body: JSON.stringify({ deviceId: reusedId, timezone: 'UTC' }),
      })
      const { secret } = initRes.body as { secret: string }
      const bindRes = await api('/api/devices/bind', {
        method: 'POST',
        token: firstToken,
        body: JSON.stringify({ deviceId: reusedId, secret, name: 'Cache PC' }),
      })
      const agentToken = (bindRes.body as { agentToken: string }).agentToken

      const socket = await connectAgent(agentToken)
      try {
        await emitScreenshot(socket, 'STALE-CACHE-IMAGE')
      } finally {
        socket.disconnect()
      }
      const before = await api(`/api/devices/${reusedId}/screenshot`, {
        token: firstToken,
      })
      expect(before.status).toBe(200)

      const del = await api(`/api/devices/${reusedId}`, {
        method: 'DELETE',
        token: firstToken,
      })
      expect(del.status).toBe(204)

      // Перерегистрируем тот же deviceId и привязываем к другому юзеру
      const reInit = await api('/api/devices/init', {
        method: 'POST',
        body: JSON.stringify({ deviceId: reusedId, timezone: 'UTC' }),
      })
      const newSecret = (reInit.body as { secret: string }).secret
      const rebind = await api('/api/devices/bind', {
        method: 'POST',
        token: secondToken,
        body: JSON.stringify({ deviceId: reusedId, secret: newSecret, name: 'Reused PC' }),
      })
      expect(rebind.status).toBe(201)

      // Новый владелец не должен получить кадр, оставшийся в кэше от старого
      const after = await api(`/api/devices/${reusedId}/screenshot`, {
        token: secondToken,
      })
      expect(after.status).toBe(404)
    })
  })

  // ─── WS: старый (stale) сокет после DELETE + re-init ─────────────────────

  describe('agent: старый сокет после DELETE + re-init', () => {
    let owner1Token: string
    let owner2Token: string
    let reusedId: string
    let staleSocket: Socket
    let newAgentToken: string

    beforeAll(async () => {
      owner1Token = (await registerUser()).accessToken
      owner2Token = (await registerUser()).accessToken
      reusedId = randomUUID()

      // 1. Первый владелец: init + bind
      const initRes = await api('/api/devices/init', {
        method: 'POST',
        body: JSON.stringify({ deviceId: reusedId, timezone: 'UTC' }),
      })
      const { secret } = initRes.body as { secret: string }
      const bindRes = await api('/api/devices/bind', {
        method: 'POST',
        token: owner1Token,
        body: JSON.stringify({ deviceId: reusedId, secret, name: 'Stale PC' }),
      })
      const firstAgentToken = (bindRes.body as { agentToken: string }).agentToken

      // 2. Агент подключается и шлёт первый (легитимный) кадр
      staleSocket = await connectAgent(firstAgentToken)
      await emitScreenshot(staleSocket, 'IMAGE-FROM-OWNER-1')
      const before = await api(`/api/devices/${reusedId}/screenshot`, {
        token: owner1Token,
      })
      expect(before.status).toBe(200)

      // 3. Устройство удаляется, но сокет намеренно не закрываем
      const del = await api(`/api/devices/${reusedId}`, {
        method: 'DELETE',
        token: owner1Token,
      })
      expect(del.status).toBe(204)

      // 4. Тот же deviceId заново регистрируется и привязывается к другому юзеру
      const reInit = await api('/api/devices/init', {
        method: 'POST',
        body: JSON.stringify({ deviceId: reusedId, timezone: 'UTC' }),
      })
      const newSecret = (reInit.body as { secret: string }).secret
      const rebind = await api('/api/devices/bind', {
        method: 'POST',
        token: owner2Token,
        body: JSON.stringify({ deviceId: reusedId, secret: newSecret, name: 'Reused PC' }),
      })
      expect(rebind.status).toBe(201)
      newAgentToken = (rebind.body as { agentToken: string }).agentToken
    })

    afterAll(() => {
      staleSocket?.disconnect()
    })

    it('(а) кадр старого сокета не достаётся новому владельцу', async () => {
      // Ack приходит и для отброшенного кадра — ждём именно подтверждения
      await emitScreenshot(staleSocket, 'STALE-IMAGE-FROM-OLD-SOCKET')

      const after = await api(`/api/devices/${reusedId}/screenshot`, {
        token: owner2Token,
      })
      expect(after.status).toBe(404)
      expect(JSON.stringify(after.body)).not.toContain('STALE-IMAGE-FROM-OLD-SOCKET')
    })

    it('(б) heartbeat старого сокета не обновляет новое устройство', async () => {
      // Ack подтверждает, что updateMany уже выполнен (никаких фиксированных пауз)
      const ack = await emitHeartbeat(staleSocket, {
        deviceId: reusedId,
        timestamp: new Date().toISOString(),
        cpuPercent: 99,
        ramPercent: 99,
        uptime: 999,
        agentVersion: '9.9.9',
        activeUsers: [],
      })
      // Для heartbeat устаревшего поколения сервер отвечает ok: true (осознанно
      // проигнорировано), данные при этом не пишутся
      expect(ack).toEqual({ ok: true })

      const device = (await api(`/api/devices/${reusedId}`, { token: owner2Token }))
        .body as { status: string; cpuPercent: number | null; agentVersion: string | null }

      expect(device.status).not.toBe('online')
      expect(device.cpuPercent).not.toBe(99)
      expect(device.agentVersion).not.toBe('9.9.9')
    })

    it('(в) команда нового владельца не уходит старому сокету', async () => {
      // Слушатель ставим ДО отправки команды
      const staleReceived = waitForCommand(staleSocket, 500)

      const res = await api(`/api/devices/${reusedId}/commands`, {
        method: 'POST',
        token: owner2Token,
        body: JSON.stringify({ type: 'LOCK' }),
      })
      expect(res.status).toBe(202)
      expect((res.body as { delivered: boolean }).delivered).toBe(false)
      expect(await staleReceived).toBe(false)

      // Свежий агент (новый agentToken) ту же команду получает
      const freshSocket = await connectAgent(newAgentToken)
      try {
        const freshReceived = waitForCommand(freshSocket, 5000)

        const res2 = await api(`/api/devices/${reusedId}/commands`, {
          method: 'POST',
          token: owner2Token,
          body: JSON.stringify({ type: 'LOCK' }),
        })
        expect(res2.status).toBe(202)
        expect((res2.body as { delivered: boolean }).delivered).toBe(true)
        expect(await freshReceived).toBe(true)
      } finally {
        freshSocket.disconnect()
      }
    })

    it('(г) локальные пользователи старого сокета не попадают новому устройству', async () => {
      // Ack = сервер закончил обработку (транзакция завершена или откатилась)
      const ack = await emitLocalUsers(staleSocket, {
        deviceId: reusedId,
        users: [{ name: 'stale', fullName: 'Stale', enabled: true }],
      })
      // Синхронизация не выполнялась — данные поколения №1 писать некуда
      expect(ack).toEqual({ ok: false })

      const { status, body } = await api(`/api/devices/${reusedId}/users`, {
        token: owner2Token,
      })
      expect(status).toBe(200)
      expect(body).toEqual([])
    })

    it('(г2) свежий агент синхронизирует пользователей нового поколения', async () => {
      // Контроль к (г): штатная запись в новом поколении проходит
      const freshSocket = await connectAgent(newAgentToken)
      try {
        const ack = await emitLocalUsers(freshSocket, {
          deviceId: reusedId,
          users: [{ name: 'fresh', fullName: 'Fresh User', enabled: true }],
        })
        expect(ack).toEqual({ ok: true })

        const { status, body } = await api(`/api/devices/${reusedId}/users`, {
          token: owner2Token,
        })
        expect(status).toBe(200)
        expect(body).toMatchObject([{ name: 'fresh', fullName: 'Fresh User', enabled: true }])
      } finally {
        freshSocket.disconnect()
      }
    })

    it('(д) расписание и бонус доходят до нового поколения', async () => {
      const freshSocket = await connectAgent(newAgentToken)
      try {
        // `socket.join(room)` выполняется в обработчике connection синхронно с
        // отправкой CONNECT-пакета, поэтому к резолву connectAgent() сокет уже в
        // комнате своего поколения — эмиты адресны без дополнительных ожиданий
        const scheduleEvent = waitForEvent<{ enabled?: boolean }>(
          freshSocket,
          'server:schedule:update',
          5000
        )
        const scheduleRes = await api(`/api/devices/${reusedId}/schedule`, {
          method: 'PUT',
          token: owner2Token,
          body: JSON.stringify({
            timezone: 'UTC',
            enabled: true,
            days: { '1': [{ start: '09:00', end: '18:00' }] },
          }),
        })
        expect(scheduleRes.status).toBe(200)
        const schedulePayload = await scheduleEvent
        expect(schedulePayload).not.toBe(EVENT_TIMEOUT)
        expect(schedulePayload).toMatchObject({ enabled: true })

        const bonusEvent = waitForEvent<{ minutes?: number }>(
          freshSocket,
          'server:bonus:update',
          5000
        )
        const bonusRes = await api(`/api/devices/${reusedId}/schedule/bonus`, {
          method: 'POST',
          token: owner2Token,
          body: JSON.stringify({ minutes: 15 }),
        })
        expect(bonusRes.status).toBe(200)
        expect((bonusRes.body as { delivered: boolean }).delivered).toBe(true)
        const bonusPayload = await bonusEvent
        expect(bonusPayload).not.toBe(EVENT_TIMEOUT)
        expect(bonusPayload).toMatchObject({ minutes: 15 })
      } finally {
        freshSocket.disconnect()
      }
    })

    it('(е) server:unbind получает только сокет актуального поколения', async () => {
      const ownerToken = (await registerUser()).accessToken
      const unbindId = randomUUID()

      const initRes = await api('/api/devices/init', {
        method: 'POST',
        body: JSON.stringify({ deviceId: unbindId, timezone: 'UTC' }),
      })
      const { secret } = initRes.body as { secret: string }
      const bindRes = await api('/api/devices/bind', {
        method: 'POST',
        token: ownerToken,
        body: JSON.stringify({ deviceId: unbindId, secret, name: 'Unbind PC' }),
      })
      const oldSocket = await connectAgent(
        (bindRes.body as { agentToken: string }).agentToken
      )

      let newSocket: Socket | undefined
      try {
        // Удаляем поколение №1 и регистрируем тот же deviceId заново.
        // Сокет №1 намеренно остаётся подключённым (stale)
        const del = await api(`/api/devices/${unbindId}`, {
          method: 'DELETE',
          token: ownerToken,
        })
        expect(del.status).toBe(204)

        const reInit = await api('/api/devices/init', {
          method: 'POST',
          body: JSON.stringify({ deviceId: unbindId, timezone: 'UTC' }),
        })
        const newSecret = (reInit.body as { secret: string }).secret
        const rebind = await api('/api/devices/bind', {
          method: 'POST',
          token: ownerToken,
          body: JSON.stringify({ deviceId: unbindId, secret: newSecret, name: 'Unbind PC 2' }),
        })
        expect(rebind.status).toBe(201)

        newSocket = await connectAgent((rebind.body as { agentToken: string }).agentToken)

        const staleUnbind = waitForEvent(oldSocket, 'server:unbind', 500)
        const freshUnbind = waitForEvent(newSocket, 'server:unbind', 5000)

        const del2 = await api(`/api/devices/${unbindId}`, {
          method: 'DELETE',
          token: ownerToken,
        })
        expect(del2.status).toBe(204)

        expect(await freshUnbind).not.toBe(EVENT_TIMEOUT)
        // Устаревший сокет того же deviceId unbind не получает
        expect(await staleUnbind).toBe(EVENT_TIMEOUT)
      } finally {
        newSocket?.disconnect()
        oldSocket.disconnect()
      }
    })
  })

  // ─── WebSocket: agent heartbeat с activeUsers ─────────────────────────────

  describe('WebSocket /agents — heartbeat с activeUsers', () => {
    let agentToken: string
    let wsDeviceId: string

    beforeAll(async () => {
      // Регистрируем новое устройство специально для WS-теста
      wsDeviceId = randomUUID()
      const initRes = await api('/api/devices/init', {
        method: 'POST',
        body: JSON.stringify({ deviceId: wsDeviceId, timezone: 'UTC' }),
      })
      const { secret } = initRes.body as { secret: string }
      const bindRes = await api('/api/devices/bind', {
        method: 'POST',
        token: accessToken,
        body: JSON.stringify({ deviceId: wsDeviceId, secret, name: 'WS Test PC' }),
      })
      agentToken = (bindRes.body as { agentToken: string }).agentToken
    })

    it('агент подключается и хартбит обновляет activeUsers', async () => {
      const users = [
        { name: 'TestUser', session: 'console', state: 'Active', idle: 'none', logonTime: '10:00 AM' },
        { name: 'RemoteUser', session: 'rdp', state: 'Active', idle: '5m', logonTime: '09:30 AM' },
      ]

      // Ack heartbeat гарантирует, что updateMany уже выполнен
      const socket = await connectAgent(agentToken)
      try {
        const ack = await emitHeartbeat(socket, {
          deviceId: wsDeviceId,
          timestamp: new Date().toISOString(),
          cpuPercent: 55,
          ramPercent: 70,
          uptime: 3600,
          agentVersion: '0.0.1',
          activeUsers: users,
        })
        expect(ack).toEqual({ ok: true })
      } finally {
        socket.disconnect()
      }

      // Проверяем что данные сохранились в БД
      const { body } = await api(`/api/devices/${wsDeviceId}`, { token: accessToken })
      const device = body as {
        cpuPercent: number
        activeUsers: typeof users
        status: string
      }

      expect(device.cpuPercent).toBe(55)
      expect(device.activeUsers).toHaveLength(2)
      expect(device.activeUsers[0]).toMatchObject({ name: 'TestUser', session: 'console' })
      expect(device.activeUsers[1]).toMatchObject({ name: 'RemoteUser', session: 'rdp' })
    })
  })
})
