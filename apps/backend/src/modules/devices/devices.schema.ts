import { z } from 'zod'
import { CommandTypeSchema } from '@pc-remote/shared'

export const BindDeviceSchema = z.object({
  deviceId: z.string().uuid(),
  secret: z.string().min(32),
  name: z.string().min(1).max(100),
  timezone: z.string().default('UTC'),
})

export const SendCommandSchema = z.object({
  type: CommandTypeSchema,
  delaySeconds: z.number().int().min(0).max(3600).default(0),
  message: z.string().max(200).optional(),
})

const TimeSchema = z.string().regex(/^\d{2}:\d{2}$/)

export const UpdateScheduleSchema = z.object({
  enabled: z.boolean(),
  timezone: z.string(),
  days: z.record(z.string(), z.array(z.object({ start: TimeSchema, end: TimeSchema }))),
  downtime: z.object({
    enabled: z.boolean(),
    start: TimeSchema,
    end: TimeSchema,
  }).optional(),
  dailyLimit: z.object({
    enabled: z.boolean(),
    minutesWeekday: z.number().int().min(1).max(1440),
    minutesWeekend: z.number().int().min(1).max(1440),
  }).optional(),
})

export const BonusTimeSchema = z.object({
  minutes: z.number().int().min(1).max(120),
})

export type BindDeviceInput = z.infer<typeof BindDeviceSchema>
export type SendCommandInput = z.infer<typeof SendCommandSchema>
export type UpdateScheduleInput = z.infer<typeof UpdateScheduleSchema>
export type BonusTimeInput = z.infer<typeof BonusTimeSchema>