import { FastifyPluginAsync } from 'fastify'
import bcrypt from 'bcryptjs'
import { DevicesService, DeviceError } from './devices.service.js'
import {
  BindDeviceSchema,
  SendCommandSchema,
  UpdateScheduleSchema,
  BonusTimeSchema,
} from './devices.schema.js'

// Публичные роуты (без аутентификации)
const devicesPublicRoutes: FastifyPluginAsync = async (app) => {
  const service = new DevicesService(app.prisma, app)

  app.get<{ Params: { id: string } }>('/:id/token', async (request, reply) => {
    // Токен агента отдаём только тому, кто знает secret устройства (агент хранит его до привязки)
    const deviceSecret = request.headers['x-device-secret']
    if (typeof deviceSecret !== 'string' || deviceSecret.length === 0) {
      return reply.status(401).send({ error: 'x-device-secret header required' })
    }

    const device = await app.prisma.device.findUnique({
      where: { id: request.params.id },
      select: { agentToken: true, secret: true },
    })

    if (!device) {
      return reply.status(404).send({ error: 'Device not found' })
    }

    const secretValid = await bcrypt.compare(deviceSecret, device.secret)
    if (!secretValid) {
      return reply.status(403).send({ error: 'Invalid secret' })
    }

    // Поллинг идемпотентен: secret гасится не здесь, а при успешной
    // WS-аутентификации агента (plugins/socket.ts). Потеря ответа или гонка
    // двух поллингов не ломают привязку — повторный запрос снова вернёт токен.

    // Возвращаем токен только если устройство привязано
    return reply.send({ agentToken: device.agentToken ?? null })
  })

  app.post('/init', async (request, reply) => {
    const body = request.body as Record<string, unknown>
    const deviceId = body['deviceId'] as string | undefined
    const timezone = (body['timezone'] as string | undefined) ?? 'UTC'

    if (!deviceId) {
      return reply.status(400).send({ error: 'deviceId required' })
    }

    try {
      const result = await service.initDevice(deviceId, timezone)
      return reply.status(201).send(result)
    } catch (err) {
      if (err instanceof DeviceError) {
        return reply.status(err.statusCode).send({ error: err.message })
      }
      throw err
    }
  })
}

// Защищённые роуты (требуют JWT)
const devicesPrivateRoutes: FastifyPluginAsync = async (app) => {
  const service = new DevicesService(app.prisma, app)

  app.addHook('preHandler', app.authenticate)

  app.get('/', async (request) => {
    return service.getUserDevices(request.user.userId)
  })

  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    try {
      return await service.getDevice(request.user.userId, request.params.id)
    } catch (err) {
      if (err instanceof DeviceError) {
        return reply.status(err.statusCode).send({ error: err.message })
      }
      throw err
    }
  })

  // Локальные пользователи Windows на устройстве
  app.get<{ Params: { id: string } }>('/:id/users', async (request, reply) => {
    const device = await app.prisma.device.findFirst({
      where: { id: request.params.id, userId: request.user.userId },
      select: { id: true },
    })

    if (!device) {
      return reply.status(404).send({ error: 'Device not found' })
    }

    const users = await app.prisma.deviceUser.findMany({
      where: { deviceId: request.params.id },
      orderBy: { name: 'asc' },
    })

    return reply.send(users)
  })

  // История команд устройства
  app.get<{ Params: { id: string } }>(
  '/:id/commands',
  async (request, reply) => {
    try {
      const commands = await app.prisma.command.findMany({
        where: {
          deviceId: request.params.id,
          device: { userId: request.user.userId },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      })
      return reply.send(commands)
    } catch (err) {
      if (err instanceof DeviceError) {
        return reply.status(err.statusCode).send({ error: err.message })
      }
      throw err
    }
  }
)

  app.post('/bind', async (request, reply) => {
    const body = BindDeviceSchema.safeParse(request.body)
    if (!body.success) {
      return reply.status(400).send({ error: body.error.flatten() })
    }

    try {
      const result = await service.bindDevice(request.user.userId, body.data)
      return reply.status(201).send(result)
    } catch (err) {
      if (err instanceof DeviceError) {
        return reply.status(err.statusCode).send({ error: err.message })
      }
      throw err
    }
  })

  app.post<{ Params: { id: string } }>(
    '/:id/commands',
    async (request, reply) => {
      const body = SendCommandSchema.safeParse(request.body)
      if (!body.success) {
        return reply.status(400).send({ error: body.error.flatten() })
      }

      try {
        const result = await service.sendCommand(
          request.user.userId,
          request.params.id,
          body.data
        )
        return reply.status(202).send(result)
      } catch (err) {
        if (err instanceof DeviceError) {
          return reply.status(err.statusCode).send({ error: err.message })
        }
        throw err
      }
    }
  )

  app.put<{ Params: { id: string } }>(
    '/:id/schedule',
    async (request, reply) => {
      const body = UpdateScheduleSchema.safeParse(request.body)
      if (!body.success) {
        return reply.status(400).send({ error: body.error.flatten() })
      }

      try {
        const schedule = await service.updateSchedule(
          request.user.userId,
          request.params.id,
          body.data
        )
        return reply.status(200).send(schedule)
      } catch (err) {
        if (err instanceof DeviceError) {
          return reply.status(err.statusCode).send({ error: err.message })
        }
        throw err
      }
    }
  )

  app.get<{ Params: { id: string } }>('/:id/screenshot', async (request, reply) => {
    // Сначала проверяем владельца легким select (без base64) — только потом кэш
    const device = await app.prisma.device.findFirst({
      where: { id: request.params.id, userId: request.user.userId },
      select: { id: true, createdAt: true },
    })
    if (!device) {
      return reply.status(404).send({ error: 'Device not found' })
    }

    // Поколение устройства: после DELETE + повторной регистрации того же deviceId
    // createdAt другой, поэтому чужой кадр из кэша (в т.ч. другого инстанса) не отдаём
    const generation = device.createdAt.toISOString()

    // Быстрый in-memory кэш
    const cached = app.getDeviceScreenshot(device.id, generation)
    if (cached) {
      return reply.send(cached)
    }

    // Фолбэк: читаем крупные поля из БД только при промахе кэша
    const stored = await app.prisma.device.findFirst({
      where: { id: device.id, userId: request.user.userId },
      select: { screenshotImage: true, screenshotAt: true },
    })
    if (!stored?.screenshotImage || !stored.screenshotAt) {
      return reply.status(404).send({ error: 'No screenshot available' })
    }
    return reply.send({
      image: stored.screenshotImage,
      capturedAt: stored.screenshotAt.toISOString(),
    })
  })

  app.post<{ Params: { id: string } }>('/:id/schedule/bonus', async (request, reply) => {
    const body = BonusTimeSchema.safeParse(request.body)
    if (!body.success) {
      return reply.status(400).send({ error: body.error.flatten() })
    }

    try {
      const result = await service.addBonusTime(
        request.user.userId,
        request.params.id,
        body.data
      )
      return reply.status(200).send(result)
    } catch (err) {
      if (err instanceof DeviceError) {
        return reply.status(err.statusCode).send({ error: err.message })
      }
      throw err
    }
  })

  app.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    try {
      await service.deleteDevice(request.user.userId, request.params.id)
      return reply.status(204).send()
    } catch (err) {
      if (err instanceof DeviceError) {
        return reply.status(err.statusCode).send({ error: err.message })
      }
      throw err
    }
  })
}

// Экспортируем оба — регистрируем раздельно в app.ts
export { devicesPublicRoutes, devicesPrivateRoutes }