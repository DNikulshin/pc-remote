import fp from 'fastify-plugin'
import { FastifyPluginAsync } from 'fastify'
import { Server, Socket } from 'socket.io'
import { Prisma, PrismaClient } from '@prisma/client'
import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
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
    // Обе функции асинхронные: перед отправкой нужно узнать актуальное
    // поколение устройства (комната привязана к поколению)
    sendCommand: (deviceId: string, payload: unknown) => Promise<boolean>
    sendEvent: (deviceId: string, event: string, payload: unknown) => Promise<boolean>
    // generation — «поколение» устройства (его createdAt): кадр, снятый до
    // перерегистрации того же deviceId, отдаваться не должен
    getDeviceScreenshot: (
      deviceId: string,
      generation: string
    ) => { image: string; capturedAt: string } | null
    clearDeviceScreenshot: (deviceId: string) => void
  }
}

// Мета-данные подключённого агента
interface AgentSocket extends Socket {
  data: {
    deviceId: string
    agentVersion: string
    generation: string
  }
}

interface ScreenshotEntry {
  image: string
  capturedAt: string
  cachedAt: number
  generation: string
}

// Скриншот считаем актуальным 10 минут — старше отдаём из БД либо 404
const SCREENSHOT_CACHE_TTL_MS = 10 * 60 * 1000

// Код Prisma для конфликта сериализации (read/write dependencies among transactions)
const SERIALIZATION_CONFLICT_CODE = 'P2034'

// Задержки между попытками повторной синхронизации local users:
// 3 попытки всего (первая + 2 повтора)
const SYNC_RETRY_DELAYS_MS = [25, 50] as const

// Повторяем только сериализационные конфликты: остальные ошибки — как раньше
const isSerializationConflict = (err: unknown): boolean =>
  typeof err === 'object' &&
  err !== null &&
  (err as { code?: unknown }).code === SERIALIZATION_CONFLICT_CODE

const screenshotCache = new Map<string, ScreenshotEntry>()

// Погашенные bootstrap-секреты — чтобы не делать bcrypt и UPDATE на каждый
// реконнект агента. Ключ включает поколение (`deviceId:createdAt`): после
// DELETE + повторной регистрации того же deviceId секрет НОВОЙ строки
// погасить всё равно нужно.
const burnedDevices = new Set<string>()

// Комната привязана к поколению устройства: сокет, оставшийся от предыдущей
// регистрации того же deviceId, не получает команды нового владельца.
// Экспортируется, чтобы модуль устройств слал события в ту же комнату.
export const roomFor = (deviceId: string, generation: string): string =>
  `${deviceId}:${generation}`

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

    const prisma = app.prisma as PrismaClient

    const device = await prisma.device.findUnique({
      where: { agentToken: token },
      select: { id: true, agentVersion: true, createdAt: true, secret: true },
    })

    if (!device) {
      return next(new Error('Invalid agent token'))
    }

    // Поколение фиксируем при подключении: повторная регистрация того же deviceId
    // создаёт новую строку с другим createdAt, поэтому старые данные не совпадут
    const generation = device.createdAt.toISOString()
    const burnKey = `${device.id}:${generation}`

    // Bootstrap-секрет гасим только теперь: агент сначала получил токен
    // поллингом (secret ещё валиден), сохранил его и подключился по WS — после
    // этого по утёкшему QR токен уже не забрать. Поллинг остаётся идемпотентным,
    // поэтому потеря ответа/гонка поллингов привязку не ломают.
    if (!burnedDevices.has(burnKey)) {
      try {
        const burned = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10)
        const result = await prisma.device.updateMany({
          // CAS: не перетираем секрет, если устройство уже удалено/пересоздано
          where: { id: device.id, createdAt: device.createdAt, secret: device.secret },
          data: { secret: burned },
        })

        if (result.count === 1) {
          burnedDevices.add(burnKey)
        } else {
          // count === 0: секрет уже погашен другим запросом/инстансом либо
          // устройство удалено и пересоздано с другим токеном. Различаем по
          // agentToken: тот же токен — та же строка, секрет погашен ранее
          const current = await prisma.device.findUnique({
            where: { id: device.id },
            select: { agentToken: true, secret: true },
          })

          if (!current || current.agentToken !== token) {
            // Устаревший агент: его устройство удалено или перерегистрировано
            return next(new Error('Invalid agent token'))
          }

          burnedDevices.add(burnKey)
        }
      } catch (err) {
        // Секрет мог остаться валидным — соединение не пропускаем, агент
        // переподключится и повторит попытку
        app.log.warn({ err, deviceId: device.id }, 'Failed to burn bootstrap secret')
        return next(new Error('Failed to invalidate bootstrap secret'))
      }
    }

    socket.data.deviceId = device.id
    socket.data.agentVersion = device.agentVersion ?? 'unknown'
    socket.data.generation = generation
    next()
  })

  agents.on('connection', (socket: AgentSocket) => {
    const { deviceId, generation } = socket.data
    const prisma = app.prisma as PrismaClient
    const generationDate = new Date(generation)
    app.log.info({ deviceId, generation }, 'Agent connected')

    // Агент входит в комнату своего поколения — команды шлём именно туда
    void socket.join(roomFor(deviceId, generation))

    // Обновляем статус на online (только если поколение ещё актуально)
    void prisma.device
      .updateMany({
        where: { id: deviceId, createdAt: generationDate },
        data: { status: 'online', lastSeenAt: new Date() },
      })
      .then((updated) => {
        if (updated.count === 0) {
          app.log.warn({ deviceId, generation }, 'Connected agent belongs to a stale generation')
        }
      })
      .catch((err: unknown) => {
        app.log.warn({ err, deviceId }, 'Failed to mark device online')
      })

    // Heartbeat от агента
    socket.on(
      WS_EVENTS.AGENT_HEARTBEAT,
      async (raw: unknown, ack?: (res?: unknown) => void) => {
        let ok = false
        try {
          const parsed = HeartbeatPayloadSchema.safeParse(raw)
          if (!parsed.success) {
            app.log.warn({ deviceId, error: parsed.error }, 'Invalid heartbeat')
            return
          }

          const { cpuPercent, ramPercent, uptime, activeUsers, agentVersion, disks } =
            parsed.data

          const updated = await prisma.device.updateMany({
            where: { id: deviceId, createdAt: generationDate },
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

          if (updated.count === 0) {
            app.log.warn({ deviceId, generation }, 'Heartbeat from stale device generation ignored')
            // Heartbeat устаревшего поколения осознанно проигнорирован — для
            // отправителя это успешная обработка
            ok = true
            return
          }

          ok = true
        } catch (err) {
          app.log.error({ err, deviceId }, 'Failed to handle heartbeat')
          ok = false
        } finally {
          ack?.({ ok })
        }
      }
    )

    // Результат выполнения команды от агента
    socket.on(WS_EVENTS.AGENT_COMMAND_RESULT, async (raw: unknown) => {
      const parsed = CommandResultSchema.safeParse(raw)
      if (!parsed.success) {
        app.log.warn({ deviceId }, 'Invalid command result')
        return
      }

      const { commandId, success, error, executedAt } = parsed.data

      // Команда должна принадлежать этому устройству — чужой/устаревший сокет
      // не должен закрывать команды нового владельца
      const command = await prisma.command.findFirst({
        where: { id: commandId, deviceId },
        select: { id: true },
      })
      if (!command) {
        app.log.warn(
          { deviceId, commandId },
          'Command result for unknown or foreign command ignored'
        )
        return
      }

      // И поколение устройства должно быть актуальным
      const currentDevice = await prisma.device.findFirst({
        where: { id: deviceId, createdAt: generationDate },
        select: { id: true },
      })
      if (!currentDevice) {
        app.log.warn(
          { deviceId, commandId, generation },
          'Command result from stale device generation ignored'
        )
        return
      }

      await prisma.command.update({
        where: { id: commandId },
        data: {
          status: success ? 'executed' : 'failed',
          executedAt: new Date(executedAt),
          error: error ?? null,
        },
      })

      // Логируем в AuditLog — только после успешной проверки владельца команды
      await prisma.auditLog.create({
        data: {
          deviceId,
          event: success ? 'command_executed' : 'command_failed',
          details: { commandId, error },
        },
      })

      app.log.info({ deviceId, commandId, success }, 'Command result received')
    })

    // Скриншот от агента — сохраняем в кэш и в БД
    socket.on(
      WS_EVENTS.AGENT_SCREENSHOT,
      async (raw: unknown, ack?: (res?: unknown) => void) => {
        let ok = false
        try {
          const payload = raw as Record<string, unknown>
          const image = payload['image'] as string | undefined
          if (!image) return

          // Используем серверное время — не зависим от часов агента
          const now = new Date()

          // Пишем только если поколение сокета всё ещё актуально: после DELETE +
          // повторной регистрации того же deviceId старый (не отключённый) сокет
          // не должен записать кадр в НОВУЮ строку устройства
          const updated = await prisma.device.updateMany({
            where: { id: deviceId, createdAt: generationDate },
            data: { screenshotImage: image, screenshotAt: now },
          })

          if (updated.count !== 1) {
            app.log.warn({ deviceId, generation }, 'Screenshot from stale device generation ignored')
            // Кадр устаревшего поколения осознанно отброшен — для отправителя
            // это успешная обработка
            ok = true
            return
          }

          screenshotCache.set(deviceId, {
            image,
            capturedAt: now.toISOString(),
            cachedAt: now.getTime(),
            generation,
          })
          ok = true
          app.log.info({ deviceId }, 'Screenshot cached')
        } catch (err) {
          app.log.error({ err, deviceId }, 'Failed to store screenshot')
          ok = false
        } finally {
          // Подтверждаем обработку (в том числе для отброшенного stale-кадра),
          // чтобы отправитель не ждал таймаут
          ack?.({ ok })
        }
      }
    )

    // Синхронизация локальных пользователей Windows
    socket.on(
      WS_EVENTS.AGENT_LOCAL_USERS,
      async (raw: unknown, ack?: (res?: unknown) => void) => {
        // ack нужен, чтобы вызывающая сторона (и тесты) не гадала по таймауту,
        // завершена ли синхронизация
        let ok = false
        try {
          const parsed = LocalUsersPayloadSchema.safeParse(raw)
          if (!parsed.success) {
            app.log.warn({ deviceId }, 'Invalid local users payload')
            return
          }

          const { users } = parsed.data

          // Проверка поколения и замена пользователей — ОДНА serializable-транзакция:
          // иначе старый сокет может пройти проверку, а после DELETE + re-init
          // удалить/заменить DeviceUser уже нового устройства
          const syncUsers = async (): Promise<void> => {
            await prisma.$transaction(
              async (tx: Prisma.TransactionClient) => {
                const current = await tx.device.findFirst({
                  where: { id: deviceId, createdAt: generationDate },
                  select: { id: true },
                })
                if (!current) {
                  app.log.warn(
                    { deviceId, generation },
                    'Local users from stale device generation ignored'
                  )
                  return
                }

                await tx.deviceUser.deleteMany({ where: { deviceId } })
                if (users.length > 0) {
                  await tx.deviceUser.createMany({
                    data: users.map((u) => ({
                      deviceId,
                      name: u.name,
                      fullName: u.fullName,
                      enabled: u.enabled,
                    })),
                  })
                }

                ok = true
              },
              { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
            )
          }

          // Serializable-транзакции могут конфликтовать между собой (P2034),
          // когда параллельно синхронизируются другие устройства. Конфликт не
          // означает потерю данных — транзакция просто не применилась, поэтому
          // повторяем её с небольшой задержкой (до 3 попыток всего)
          for (let attempt = 0; ; attempt++) {
            try {
              ok = false
              await syncUsers()
              break
            } catch (err) {
              const delay = SYNC_RETRY_DELAYS_MS[attempt]
              if (!isSerializationConflict(err) || delay === undefined) throw err

              app.log.warn(
                { err, deviceId, attempt: attempt + 1 },
                'Local users sync hit serialization conflict, retrying'
              )
              await new Promise((resolve) => setTimeout(resolve, delay))
            }
          }

          // Логируем только после успешного COMMIT — ok выставляется в транзакции
          if (ok) {
            app.log.info({ deviceId, count: users.length }, 'Local users synced')
          }
        } catch (err) {
          // Конфликт сериализации/ошибка записи: данные нового устройства НЕ
          // перетёрты. Повторная синхронизация произойдёт при следующем
          // подключении агента (агент шлёт список на connect)
          app.log.warn(
            { err, deviceId },
            'Failed to sync local users (stale generation or conflict)'
          )
          ok = false
        } finally {
          ack?.({ ok })
        }
      }
    )

    // Агент отключился
    socket.on('disconnect', async (reason) => {
      app.log.info({ deviceId, generation, reason }, 'Agent disconnected')

      // Статус снимаем только у своего поколения: после DELETE + re-init
      // строка с тем же id уже другая и её трогать нельзя
      const updated = await prisma.device.updateMany({
        where: { id: deviceId, createdAt: generationDate },
        data: { status: 'offline' },
      })

      if (updated.count === 0) {
        app.log.warn({ deviceId, generation }, 'Disconnect from stale device generation ignored')
      }
    })
  })

  // Актуальное поколение устройства (или null, если строки нет)
  const currentGeneration = async (deviceId: string): Promise<string | null> => {
    const device = await (app.prisma as PrismaClient).device.findUnique({
      where: { id: deviceId },
      select: { createdAt: true },
    })
    return device ? device.createdAt.toISOString() : null
  }

  // Декоратор для отправки команды конкретному агенту
  // Возвращает true если агент online, false если нет
  app.decorate('sendCommand', async (deviceId: string, payload: unknown): Promise<boolean> => {
    const generation = await currentGeneration(deviceId)
    if (!generation) return false

    // Эмитим только в комнату актуального поколения — сокеты, оставшиеся от
    // предыдущей регистрации того же deviceId, команды не получают
    const room = roomFor(deviceId, generation)
    const members = agents.adapter.rooms.get(room)
    if (!members || members.size === 0) return false

    agents.to(room).emit(WS_EVENTS.SERVER_COMMAND, payload)
    return true
  })

  app.decorate(
    'sendEvent',
    async (deviceId: string, event: string, payload: unknown): Promise<boolean> => {
      const generation = await currentGeneration(deviceId)
      if (!generation) return false

      const room = roomFor(deviceId, generation)
      const members = agents.adapter.rooms.get(room)
      if (!members || members.size === 0) return false

      agents.to(room).emit(event, payload)
      return true
    }
  )

  app.decorate('getDeviceScreenshot', (deviceId: string, generation: string) => {
    const entry = screenshotCache.get(deviceId)
    if (!entry) return null

    // Просроченную запись и запись чужого поколения удаляем — иначе после
    // удаления/перепривязки того же deviceId (в том числе на другом инстансе)
    // в памяти остаётся старый кадр и его может получить новый владелец
    if (
      entry.generation !== generation ||
      Date.now() - entry.cachedAt > SCREENSHOT_CACHE_TTL_MS
    ) {
      screenshotCache.delete(deviceId)
      return null
    }

    return { image: entry.image, capturedAt: entry.capturedAt }
  })

  app.decorate('clearDeviceScreenshot', (deviceId: string) => {
    screenshotCache.delete(deviceId)
  })

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