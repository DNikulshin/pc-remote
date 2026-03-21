import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { log as logger } from '../utils/logger.js'
import type { DailyLimitConfig } from '@pc-remote/shared'

const USAGE_PATH = process.env.NODE_ENV === 'production'
  ? path.join(os.homedir(), 'AppData', 'Roaming', 'pc-remote-agent', 'usage.json')
  : path.join(process.cwd(), '.agent-usage.json')

interface DailyUsage {
  date: string        // "YYYY-MM-DD" в timezone устройства
  minutes: number     // использованных минут сегодня
  bonusMinutes: number // добавлено бонусных минут
}

function getTodayDate(timezone: string): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: timezone })
    .format(new Date()) // sv-SE даёт формат "YYYY-MM-DD"
}

function loadUsage(timezone: string): DailyUsage {
  const today = getTodayDate(timezone)
  try {
    if (fs.existsSync(USAGE_PATH)) {
      const raw = fs.readFileSync(USAGE_PATH, 'utf-8')
      const saved = JSON.parse(raw) as DailyUsage
      // Если дата совпадает — возвращаем сохранённое
      if (saved.date === today) return saved
    }
  } catch (err) {
    logger.error({ err }, 'Failed to load usage')
  }
  // Новый день — сбрасываем счётчик
  return { date: today, minutes: 0, bonusMinutes: 0 }
}

function saveUsage(usage: DailyUsage): void {
  try {
    fs.mkdirSync(path.dirname(USAGE_PATH), { recursive: true })
    fs.writeFileSync(USAGE_PATH, JSON.stringify(usage))
  } catch (err) {
    logger.error({ err }, 'Failed to save usage')
  }
}

// Увеличить счётчик на 1 минуту (вызывается из enforcer каждую минуту при активной сессии)
export function incrementUsage(timezone: string): void {
  const usage = loadUsage(timezone)
  usage.minutes++
  saveUsage(usage)
}

// Добавить бонусные минуты (вызывается при получении SERVER_BONUS_UPDATE)
export function addBonusMinutes(timezone: string, minutes: number): void {
  const usage = loadUsage(timezone)
  usage.bonusMinutes += minutes
  saveUsage(usage)
  logger.info({ minutes, total: usage.bonusMinutes }, 'Bonus minutes added')
}

// Сколько минут осталось до блокировки (0 = лимит исчерпан)
export function getMinutesRemaining(timezone: string, config: DailyLimitConfig, isWeekend: boolean): number {
  const usage = loadUsage(timezone)
  const limit = isWeekend ? config.minutesWeekend : config.minutesWeekday
  return Math.max(0, limit + usage.bonusMinutes - usage.minutes)
}

// Лимит исчерпан?
export function isDailyLimitReached(timezone: string, config: DailyLimitConfig, isWeekend: boolean): boolean {
  return getMinutesRemaining(timezone, config, isWeekend) === 0
}
