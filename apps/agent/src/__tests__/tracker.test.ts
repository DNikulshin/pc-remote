import { describe, it, expect } from 'vitest'

// Тестируем pure-логику расчёта дневного лимита без обращения к файловой системе.
// Дублируем алгоритм из tracker.ts — те же формулы, без I/O.

interface DailyUsage {
  date: string
  minutes: number
  bonusMinutes: number
}

function getMinutesRemaining(usage: DailyUsage, minutesLimit: number): number {
  return Math.max(0, minutesLimit + usage.bonusMinutes - usage.minutes)
}

function isDailyLimitReached(usage: DailyUsage, minutesLimit: number): boolean {
  return getMinutesRemaining(usage, minutesLimit) === 0
}

const TODAY = '2026-03-22'

// ── getMinutesRemaining ───────────────────────────────────────────────────────

describe('getMinutesRemaining', () => {
  it('возвращает оставшиеся минуты', () => {
    expect(getMinutesRemaining({ date: TODAY, minutes: 60, bonusMinutes: 0 }, 120)).toBe(60)
  })

  it('возвращает 0 если лимит исчерпан точно', () => {
    expect(getMinutesRemaining({ date: TODAY, minutes: 120, bonusMinutes: 0 }, 120)).toBe(0)
  })

  it('не возвращает отрицательное при превышении лимита', () => {
    expect(getMinutesRemaining({ date: TODAY, minutes: 200, bonusMinutes: 0 }, 120)).toBe(0)
  })

  it('учитывает бонусные минуты', () => {
    expect(getMinutesRemaining({ date: TODAY, minutes: 100, bonusMinutes: 30 }, 120)).toBe(50)
  })

  it('бонусные минуты спасают при исчерпанном базовом лимите', () => {
    expect(getMinutesRemaining({ date: TODAY, minutes: 120, bonusMinutes: 60 }, 120)).toBe(60)
  })

  it('большой лимит — много времени осталось', () => {
    expect(getMinutesRemaining({ date: TODAY, minutes: 0, bonusMinutes: 0 }, 480)).toBe(480)
  })
})

// ── isDailyLimitReached ───────────────────────────────────────────────────────

describe('isDailyLimitReached', () => {
  it('лимит не достигнут', () => {
    expect(isDailyLimitReached({ date: TODAY, minutes: 60, bonusMinutes: 0 }, 120)).toBe(false)
  })

  it('лимит исчерпан ровно', () => {
    expect(isDailyLimitReached({ date: TODAY, minutes: 120, bonusMinutes: 0 }, 120)).toBe(true)
  })

  it('лимит превышен (считается достигнутым)', () => {
    expect(isDailyLimitReached({ date: TODAY, minutes: 200, bonusMinutes: 0 }, 120)).toBe(true)
  })

  it('бонусные минуты предотвращают блокировку', () => {
    expect(isDailyLimitReached({ date: TODAY, minutes: 120, bonusMinutes: 30 }, 120)).toBe(false)
  })

  it('бонусные минуты исчерпаны вместе с лимитом', () => {
    expect(isDailyLimitReached({ date: TODAY, minutes: 150, bonusMinutes: 30 }, 120)).toBe(true)
  })
})

// ── Будни vs выходные ─────────────────────────────────────────────────────────

describe('будни vs выходные', () => {
  const usage: DailyUsage = { date: TODAY, minutes: 100, bonusMinutes: 0 }

  it('будни: 100 мин при лимите 90 — лимит достигнут', () => {
    expect(isDailyLimitReached(usage, 90)).toBe(true)
  })

  it('выходные: 100 мин при лимите 180 — лимит не достигнут', () => {
    expect(isDailyLimitReached(usage, 180)).toBe(false)
    expect(getMinutesRemaining(usage, 180)).toBe(80)
  })
})
