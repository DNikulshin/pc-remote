import fp from 'fastify-plugin'
import { FastifyPluginAsync } from 'fastify'
import { Server, Socket } from 'socket.io'
import { PrismaClient } from '@prisma/client'
import {
  WS_EVENTS,
  HeartbeatPayloadSchema,
  CommandResultSchema,
  LocalUsersPayloadSchema,
} from '@pc-remote/shared'

// Расширяем FastifyInstance
declare module 'fastify' {
  interface FastifyInstance {
    io: Server
    sendCommand: (deviceId: string, payload: unknown) => boolean
    sendEvent: (deviceId: string, event: string, payload: unknown) => boolean
    getDeviceScreenshot: (deviceId: string) => { image: string; capturedAt: string } | null
  }
}

// Мета-данные подключённого агента
interface AgentSocket extends Socket {
  data: {
    deviceId: string
    agentVersion: string
  }
}

const screenshotCache = new Map<string, { image: string; capturedAt: string }>()

const socketPlugin: FastifyPluginAsync = fp(async (app) => {
  const io = new Server(app.server, {
    cors: {
      origin: process.env.ALLOWED_ORIGINS?.split(',') ?? '*',
      methods: ['GET', 'POST'],
    },
    // Агент переподключается при обрыве
    pingTimeout: 20000,
    pingInterval: 10000,
    // Скриншоты могут весить до 2MB в base64
    maxHttpBufferSize: 5 * 1024 * 1024,
  })

  // Namespace для агентов — изолируем от клиентских соединений
  const agents = io.of('/agents')

  // Middleware аутентификации агента
  agents.use(async (socket: AgentSocket, next) => {
    const token = socket.handshake.auth['token'] as string | undefined

    if (!token) {
      return next(new Error('Missing agent token'))
    }

    const device = await (app.prisma as PrismaClient).device.findUnique({
      where: { agentToken: token },
      select: { id: true, agentVersion: true },
    })

    if (!device) {
      return next(new Error('Invalid agent token'))
    }

    socket.data.deviceId = device.id
    socket.data.agentVersion = device.agentVersion ?? 'unknown'
    next()
  })

  agents.on('connection', (socket: AgentSocket) => {
    const { deviceId } = socket.data
    app.log.info({ deviceId }, 'Agent connected')

    // Агент входит в свою комнату — команды шлём в эту комнату
    void socket.join(deviceId)

    // Обновляем статус на online
    void (app.prisma as PrismaClient).device.update({
      where: { id: deviceId },
      data: { status: 'online', lastSeenAt: new Date() },
    })

    // Heartbeat от агента
    socket.on(WS_EVENTS.AGENT_HEARTBEAT, async (raw: unknown) => {
      const parsed = HeartbeatPayloadSchema.safeParse(raw)
      if (!parsed.success) {
        app.log.warn({ deviceId, error: parsed.error }, 'Invalid heartbeat')
        return
      }

      const { cpuPercent, ramPercent, uptime, activeUsers, agentVersion, disks } =
        parsed.data

      await (app.prisma as PrismaClient).device.update({
        where: { id: deviceId },
        data: {
          status: 'online',
          lastSeenAt: new Date(),
          cpuPercent,
          ramPercent,
          uptime,
          activeUsers,
          agentVersion,
          ...(disks !== undefined && { disks }),
        },
      })
    })

    // Результат выполнения команды от агента
    socket.on(WS_EVENTS.AGENT_COMMAND_RESULT, async (raw: unknown) => {
      const parsed = CommandResultSchema.safeParse(raw)
      if (!parsed.success) {
        app.log.warn({ deviceId }, 'Invalid command result')
        return
      }

      const { commandId, success, error, executedAt } = parsed.data

      await (app.prisma as PrismaClient).command.update({
        where: { id: commandId },
        data: {
          status: success ? 'executed' : 'failed',
          executedAt: new Date(executedAt),
          error: error ?? null,
        },
      })

      // Логируем в AuditLog
      await (app.prisma as PrismaClient).auditLog.create({
        data: {
          deviceId,
          event: success ? 'command_executed' : 'command_failed',
          details: { commandId, error },
        },
      })

      app.log.info({ deviceId, commandId, success }, 'Command result received')
    })

    // Скриншот от агента — сохраняем в кэш
    socket.on(WS_EVENTS.AGENT_SCREENSHOT, (raw: unknown) => {
      const payload = raw as Record<string, unknown>
      const image = payload['image'] as string | undefined
      const capturedAt = payload['capturedAt'] as string | undefined
      if (image && capturedAt) {
        screenshotCache.set(deviceId, { image, capturedAt })
        app.log.info({ deviceId }, 'Screenshot cached')
      }
    })

    // Синхронизация локальных пользователей Windows
    socket.on(WS_EVENTS.AGENT_LOCAL_USERS, async (raw: unknown) => {
      const parsed = LocalUsersPayloadSchema.safeParse(raw)
      if (!parsed.success) {
        app.log.warn({ deviceId }, 'Invalid local users payload')
        return
      }

      const { users } = parsed.data

      await (app.prisma as PrismaClient).$transaction([
        (app.prisma as PrismaClient).deviceUser.deleteMany({ where: { deviceId } }),
        (app.prisma as PrismaClient).deviceUser.createMany({
          data: users.map((u) => ({
            deviceId,
            name: u.name,
            fullName: u.fullName,
            enabled: u.enabled,
          })),
        }),
      ])

      app.log.info({ deviceId, count: users.length }, 'Local users synced')
    })

    // Агент отключился
    socket.on('disconnect', async (reason) => {
      app.log.info({ deviceId, reason }, 'Agent disconnected')

      await (app.prisma as PrismaClient).device.update({
        where: { id: deviceId },
        data: { status: 'offline' },
      })
    })
  })

  // Декоратор для отправки команды конкретному агенту
  // Возвращает true если агент online, false если нет
  app.decorate('sendCommand', (deviceId: string, payload: unknown): boolean => {
    const room = agents.adapter.rooms.get(deviceId)
    if (!room || room.size === 0) return false

    agents.to(deviceId).emit(WS_EVENTS.SERVER_COMMAND, payload)
    return true
  })

  app.decorate('sendEvent', (deviceId: string, event: string, payload: unknown): boolean => {
    const room = agents.adapter.rooms.get(deviceId)
    if (!room || room.size === 0) return false

    agents.to(deviceId).emit(event, payload)
    return true
  })

  app.decorate('getDeviceScreenshot', (deviceId: string) => screenshotCache.get(deviceId) ?? null)
  app.decorate('io', io)

  // Задача: помечать устройства как "away" если heartbeat не приходил 2 минуты
  const staleCheckInterval = setInterval(async () => {
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000)

    await (app.prisma as PrismaClient).device.updateMany({
      where: {
        status: 'online',
        lastSeenAt: { lt: twoMinutesAgo },
      },
      data: { status: 'away' },
    })
  }, 30_000) // проверяем каждые 30 секунд

  app.addHook('onClose', () => {
    clearInterval(staleCheckInterval)
    io.close()
  })
})

export default socketPlugin