import { io, Socket } from 'socket.io-client'
import { log as logger } from '../utils/logger.js'
import { config } from '../utils/config.js'
import { setOnlineStatus } from '../local-server.js'
import { getSystemInfo, getLocalUsers } from '../utils/sysinfo.js'
import { executeCommand } from '../handlers/index.js'
import {
  WS_EVENTS,
  CommandPayloadSchema,
  HeartbeatPayloadSchema,
  LocalUsersPayloadSchema,
} from '@pc-remote/shared'
import { resetAgentConfig } from '../utils/config.js'

const HEARTBEAT_INTERVAL_MS = 30_000 // каждые 30 секунд

let socket: Socket | null = null
let heartbeatTimer: NodeJS.Timeout | null = null

export function getSocket(): Socket | null {
  return socket
}

export async function connectToServer(tokenOverride?: string): Promise<void> {
  const token = tokenOverride ?? config.agentToken

  if (!token) {
    logger.warn('No agent token — device not bound yet, skipping WS connect')
    return
  }

  logger.info(`Connecting to server... url=${config.serverUrl}`)

  socket = io(`${config.serverUrl}/agents`, {
    auth: { token },
    reconnection: true,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 30_000,
    reconnectionAttempts: Infinity,
    timeout: 10_000,
  })

  socket.on('connect', async () => {
    logger.info('Connected to server')
    setOnlineStatus(true)
    startHeartbeat()
    sendLocalUsers()
  })

  socket.on('disconnect', (reason) => {
    logger.warn({ reason }, 'Disconnected from server')
    setOnlineStatus(false)
    stopHeartbeat()
  })

  socket.on('connect_error', (err) => {
    logger.error({ message: err.message }, 'Connection error')
    // Токен отклонён — устройство удалено с мобильного приложения
    if (err.message === 'Invalid agent token') {
      logger.warn('Agent token rejected — device was deleted. Resetting config and restarting...')
      socket?.disconnect()
      resetAgentConfig()
      process.exit(0)  // WinSW перезапустит агент → зарегистрирует новое устройство
    }
  })

  // Получаем команду от сервера
  socket.on(WS_EVENTS.SERVER_COMMAND, async (raw: unknown) => {
    logger.info({ raw }, 'Received command')

    const parsed = CommandPayloadSchema.safeParse(raw)
    if (!parsed.success) {
      logger.warn({ error: parsed.error }, 'Invalid command payload')
      return
    }

    const commandId = (raw as Record<string, unknown>)['commandId'] as string

    try {
      await executeCommand(parsed.data)

      socket?.emit(WS_EVENTS.AGENT_COMMAND_RESULT, {
        commandId,
        success: true,
        executedAt: new Date().toISOString(),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      logger.error({ err, commandId }, 'Command execution failed')

      socket?.emit(WS_EVENTS.AGENT_COMMAND_RESULT, {
        commandId,
        success: false,
        error: message,
        executedAt: new Date().toISOString(),
      })
    }
  })

  // Устройство удалено пользователем с мобильного приложения
  socket.on(WS_EVENTS.SERVER_UNBIND, () => {
    logger.info('Received SERVER_UNBIND — resetting config and restarting...')
    socket?.disconnect()
    resetAgentConfig()
    process.exit(0)  // WinSW перезапустит агент → покажет новый QR
  })

  // Обновление расписания
  socket.on(WS_EVENTS.SERVER_SCHEDULE_UPDATE, (payload: unknown) => {
    logger.info('Schedule update received')
    import('../schedule/store.js').then(({ updateSchedule }) => {
      updateSchedule(payload)
    }).catch((err) => logger.error({ err }, 'Failed to update schedule'))
  })

  // Бонусное время — добавляем минуты к сегодняшнему счётчику
  socket.on(WS_EVENTS.SERVER_BONUS_UPDATE, (payload: unknown) => {
    const minutes = (payload as Record<string, unknown>)?.['minutes']
    if (typeof minutes !== 'number' || minutes <= 0) return

    import('../schedule/tracker.js').then(({ addBonusMinutes }) => {
      import('../schedule/store.js').then(({ getSchedule }) => {
        const schedule = getSchedule()
        addBonusMinutes(schedule?.timezone ?? 'UTC', minutes)
        logger.info({ minutes }, 'Bonus time received')
      }).catch(() => {})
    }).catch((err) => logger.error({ err }, 'Failed to add bonus time'))
  })
}

function sendLocalUsers() {
  if (!socket?.connected) return

  try {
    const payload = LocalUsersPayloadSchema.parse({
      deviceId: config.deviceId,
      users: getLocalUsers(),
    })
    socket.emit(WS_EVENTS.AGENT_LOCAL_USERS, payload)
    logger.debug({ count: payload.users.length }, 'Local users sent')
  } catch (err) {
    logger.error({ err }, 'Failed to send local users')
  }
}

function startHeartbeat() {
  stopHeartbeat()

  const sendHeartbeat = async () => {
    if (!socket?.connected) return

    try {
      const sysInfo = await getSystemInfo()

      const payload = HeartbeatPayloadSchema.parse({
        deviceId: config.deviceId,
        timestamp: new Date().toISOString(),
        cpuPercent: sysInfo.cpuPercent,
        ramPercent: sysInfo.ramPercent,
        uptime: sysInfo.uptime,
        activeUsers: sysInfo.activeUsers,
        agentVersion: '0.0.1',
      })

      socket.emit(WS_EVENTS.AGENT_HEARTBEAT, payload)
      logger.debug({ cpuPercent: payload.cpuPercent }, 'Heartbeat sent')
    } catch (err) {
      logger.error({ err }, 'Heartbeat failed')
    }
  }

  // Сразу отправляем и потом по таймеру
  void sendHeartbeat()
  heartbeatTimer = setInterval(() => void sendHeartbeat(), HEARTBEAT_INTERVAL_MS)
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
}

export function disconnectFromServer() {
  stopHeartbeat()
  socket?.disconnect()
  socket = null
}