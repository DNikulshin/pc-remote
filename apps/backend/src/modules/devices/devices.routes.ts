import { FastifyPluginAsync } from 'fastify'
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
    const device = await app.prisma.device.findUnique({
      where: { id: request.params.id },
      select: { agentToken: true },
    })
  
    if (!device) {
      return reply.status(404).send({ error: 'Device not found' })
    }
  
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
    // Сначала быстрый in-memory кэш
    const cached = app.getDeviceScreenshot(request.params.id)
    if (cached) {
      return reply.send(cached)
    }
    // Фолбэк: читаем из БД (переживает перезапуск Render)
    const device = await app.prisma.device.findFirst({
      where: { id: request.params.id, userId: request.user.userId },
      select: { screenshotImage: true, screenshotAt: true },
    })
    if (!device) {
      return reply.status(404).send({ error: 'Device not found' })
    }
    if (!device.screenshotImage || !device.screenshotAt) {
      return reply.status(404).send({ error: 'No screenshot available' })
    }
    return reply.send({
      image: device.screenshotImage,
      capturedAt: device.screenshotAt.toISOString(),
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