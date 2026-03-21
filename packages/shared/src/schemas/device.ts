import { z } from 'zod'

export const DeviceStatusSchema = z.enum([
  'online',
  'offline',
  'away',    // heartbeat давно не приходил, но не таймаут
])

export const ActiveUserSchema = z.object({
  name: z.string(),
  session: z.string(), // 'console' | 'rdp' | 'unknown' | custom
  state: z.string(),   // 'Active' | 'Disconnected'
  idle: z.string(),
  logonTime: z.string(),
})

export const HeartbeatPayloadSchema = z.object({
  deviceId: z.string().uuid(),
  timestamp: z.string().datetime(),
  cpuPercent: z.number().min(0).max(100),
  ramPercent: z.number().min(0).max(100),
  uptime: z.number().int().min(0), // секунды
  activeUsers: z.array(ActiveUserSchema),
  agentVersion: z.string(),
})

export type ActiveUser = z.infer<typeof ActiveUserSchema>

export type HeartbeatPayload = z.infer<typeof HeartbeatPayloadSchema>
export type DeviceStatus = z.infer<typeof DeviceStatusSchema>

export const LocalUserSchema = z.object({
  name: z.string(),
  fullName: z.string(),
  enabled: z.boolean(),
})

export const LocalUsersPayloadSchema = z.object({
  deviceId: z.string().uuid(),
  users: z.array(LocalUserSchema),
})

export type LocalUser = z.infer<typeof LocalUserSchema>
export type LocalUsersPayload = z.infer<typeof LocalUsersPayloadSchema>