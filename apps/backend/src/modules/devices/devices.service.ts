import { PrismaClient } from '@prisma/client'
import { FastifyInstance } from 'fastify'
import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import { WS_EVENTS } from '@pc-remote/shared'
import type {
  BindDeviceInput,
  SendCommandInput,
  UpdateScheduleInput,
  BonusTimeInput,
} from './devices.schema.js'

export class DeviceError extends Error {
  constructor(
    message: string,
    public statusCode: number
  ) {
    super(message)
    this.name = 'DeviceError'
  }
}

export class DevicesService {
  constructor(
    private prisma: PrismaClient,
    private app: FastifyInstance
  ) {}

  async initDevice(deviceId: string, timezone: string) {
    const existing = await this.prisma.device.findUnique({
      where: { id: deviceId },
    })
    if (existing) throw new DeviceError('Device already registered', 409)
  
    const secret = crypto.randomBytes(32).toString('hex')
    const secretHash = await bcrypt.hash(secret, 10)
  
    await this.prisma.device.create({
      data: {
        id: deviceId,
        name: 'Unbound Device',
        secret: secretHash,
        timezone,
        status: 'offline',
        userId: null,
      },
    })
  
    return { deviceId, secret }
  }

  async bindDevice(userId: string, input: BindDeviceInput) {
    const device = await this.prisma.device.findUnique({
      where: { id: input.deviceId },
    })
  
    if (!device) throw new DeviceError('Device not found', 404)
    if (device.userId !== null) {
      throw new DeviceError('Device already bound', 409)
    }
  
    const secretValid = await bcrypt.compare(input.secret, device.secret)
    if (!secretValid) throw new DeviceError('Invalid secret', 403)
  
    const agentToken = crypto.randomBytes(48).toString('hex')
  
    const updated = await this.prisma.device.update({
      where: { id: input.deviceId },
      data: {
        userId,
        name: input.name,
        timezone: input.timezone,
        agentToken,
      },
      select: {
        id: true,
        name: true,
        status: true,
        timezone: true,
        createdAt: true,
      },
    })
  
    await this.prisma.schedule.upsert({
      where: { deviceId: input.deviceId },
      create: {
        deviceId: input.deviceId,
        enabled: false,
        timezone: input.timezone,
      },
      update: {},
    })
  
    return { device: updated, agentToken }
  }

  async getUserDevices(userId: string) {
    return this.prisma.device.findMany({
      where: { userId },
      select: {
        id: true,
        name: true,
        status: true,
        lastSeenAt: true,
        cpuPercent: true,
        ramPercent: true,
        uptime: true,
        activeUsers: true,
        agentVersion: true,
        timezone: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    })
  }

  async getDevice(userId: string, deviceId: string) {
    const device = await this.prisma.device.findFirst({
      where: { id: deviceId, userId },
      select: {
        id: true,
        name: true,
        status: true,
        lastSeenAt: true,
        cpuPercent: true,
        ramPercent: true,
        uptime: true,
        activeUsers: true,
        agentVersion: true,
        timezone: true,
        platform: true,
        createdAt: true,
        updatedAt: true,
        schedule: true,
        // secret и agentToken намеренно исключены
      },
    })
  
    if (!device) throw new DeviceError('Device not found', 404)
    return device
  }

  async sendCommand(userId: string, deviceId: string, input: SendCommandInput) {
    // Проверяем что устройство принадлежит пользователю
    const device = await this.prisma.device.findFirst({
      where: { id: deviceId, userId },
    })
    if (!device) throw new DeviceError('Device not found', 404)

    const command = await this.prisma.command.create({
      data: {
        deviceId,
        type: input.type,
        payload: {
          delaySeconds: input.delaySeconds,
          message: input.message,
        },
        status: 'pending',
      },
    })

    // Пытаемся отправить через WebSocket прямо сейчас
    const delivered = this.app.sendCommand(deviceId, {
      commandId: command.id,
      type: input.type,
      delaySeconds: input.delaySeconds,
      message: input.message,
    })

    if (delivered) {
      await this.prisma.command.update({
        where: { id: command.id },
        data: { status: 'sent', sentAt: new Date() },
      })
    }

    // Логируем
    await this.prisma.auditLog.create({
      data: {
        deviceId,
        event: 'command_sent',
        details: { commandId: command.id, type: input.type, delivered },
      },
    })

    return { command, delivered }
  }

  async updateSchedule(
    userId: string,
    deviceId: string,
    input: UpdateScheduleInput
  ) {
    const device = await this.prisma.device.findFirst({
      where: { id: deviceId, userId },
    })
    if (!device) throw new DeviceError('Device not found', 404)

    const schedule = await this.prisma.schedule.upsert({
      where: { deviceId },
      create: { deviceId, ...input },
      update: input,
    })

    // Отправляем обновление агенту через WebSocket
    this.app.sendCommand(deviceId, {
      event: WS_EVENTS.SERVER_SCHEDULE_UPDATE,
      schedule,
    })

    return schedule
  }

  async addBonusTime(userId: string, deviceId: string, input: BonusTimeInput) {
    const device = await this.prisma.device.findFirst({
      where: { id: deviceId, userId },
    })
    if (!device) throw new DeviceError('Device not found', 404)

    // Отправляем бонусное время агенту через WebSocket
    const delivered = this.app.sendCommand(deviceId, {
      event: WS_EVENTS.SERVER_BONUS_UPDATE,
      minutes: input.minutes,
    })

    return { minutes: input.minutes, delivered }
  }

  async deleteDevice(userId: string, deviceId: string) {
    const device = await this.prisma.device.findFirst({
      where: { id: deviceId, userId },
    })
    if (!device) throw new DeviceError('Device not found', 404)

    // Уведомляем агент до удаления — пока socket ещё аутентифицирован
    this.app.io.of('/agents').to(deviceId).emit(WS_EVENTS.SERVER_UNBIND)

    await this.prisma.device.delete({ where: { id: deviceId } })
  }
}