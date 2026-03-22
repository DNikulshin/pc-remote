import { log as logger } from '../utils/logger.js'
import { getSchedule } from './store.js'
import { isDailyLimitReached, getMinutesRemaining } from './tracker.js'
import type { TimeSlot } from '@pc-remote/shared'

// Вспомогательная: разобрать "HH:MM" в минуты от начала суток
function toMinutes(time: string): number {
  const [h = 0, m = 0] = time.split(':').map(Number)
  return h * 60 + m
}

// Вспомогательная: проверить входит ли currentMinutes в интервал
// Поддерживает перенос через полночь (start > end, например 23:00–07:00)
function isInRange(currentMinutes: number, start: string, end: string): boolean {
  const s = toMinutes(start)
  const e = toMinutes(end)
  if (s < e) {
    return currentMinutes >= s && currentMinutes < e
  }
  // Перенос через полночь: 23:00–07:00
  return currentMinutes >= s || currentMinutes < e
}

interface TimeContext {
  currentMinutes: number
  dayNumber: number    // 0=вс, 1=пн … 6=сб
  isWeekend: boolean
}

function getTimeContext(timezone: string): TimeContext {
  const now = new Date()

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  })

  const parts = formatter.formatToParts(now)
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '00'
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00'
  const weekday = parts.find((p) => p.type === 'weekday')?.value

  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  }
  const dayNumber = weekday ? (weekdayMap[weekday] ?? 0) : 0
  const currentMinutes = parseInt(hour) * 60 + parseInt(minute)
  const isWeekend = dayNumber === 0 || dayNumber === 6

  return { currentMinutes, dayNumber, isWeekend }
}

export type LockReason = 'downtime' | 'allowed_hours' | 'daily_limit' | null

// Возвращает причину блокировки или null если доступ разрешён
export function getLockReason(): LockReason {
  const schedule = getSchedule()

  if (!schedule) return null

  const ctx = getTimeContext(schedule.timezone)

  // 1. Комендантский час — наивысший приоритет (независимо от schedule.enabled)
  if (schedule.downtime?.enabled) {
    const { start, end } = schedule.downtime
    if (isInRange(ctx.currentMinutes, start, end)) {
      return 'downtime'
    }
  }

  // 2. Дневной лимит (независимо от schedule.enabled)
  if (schedule.dailyLimit?.enabled) {
    if (isDailyLimitReached(schedule.timezone, schedule.dailyLimit, ctx.isWeekend)) {
      return 'daily_limit'
    }
  }

  // 3. Разрешённые часы по дням — только если фича включена (schedule.enabled)
  if (!schedule.enabled) return null

  const daySlots = schedule.days[String(ctx.dayNumber)] as TimeSlot[] | undefined

  if (!daySlots || daySlots.length === 0) {
    return 'allowed_hours'
  }

  const inAllowedHours = daySlots.some((slot) =>
    isInRange(ctx.currentMinutes, slot.start, slot.end)
  )

  return inAllowedHours ? null : 'allowed_hours'
}

// Сколько минут осталось сегодня (для уведомлений)
export function getMinutesRemainingToday(): number | null {
  const schedule = getSchedule()
  if (!schedule?.dailyLimit?.enabled) return null

  const ctx = getTimeContext(schedule.timezone)
  return getMinutesRemaining(schedule.timezone, schedule.dailyLimit, ctx.isWeekend)
}

// Обратная совместимость
export function isCurrentTimeAllowed(): boolean {
  return getLockReason() === null
}
