import { describe, it, expect } from 'vitest'

// Дублируем pure-функции из checker.ts для изолированного тестирования
// (без зависимости от store/tracker, которые требуют файловую систему)

function toMinutes(time: string): number {
  const [h = 0, m = 0] = time.split(':').map(Number)
  return h * 60 + m
}

function isInRange(currentMinutes: number, start: string, end: string): boolean {
  const s = toMinutes(start)
  const e = toMinutes(end)
  if (s < e) {
    return currentMinutes >= s && currentMinutes < e
  }
  // Перенос через полночь: start > end, например 23:00–07:00
  return currentMinutes >= s || currentMinutes < e
}

// ── isInRange: обычный диапазон ───────────────────────────────────────────────

describe('isInRange — обычный диапазон (09:00–22:00)', () => {
  it('середина дня — внутри', () => {
    expect(isInRange(12 * 60, '09:00', '22:00')).toBe(true)
  })

  it('до старта — снаружи', () => {
    expect(isInRange(8 * 60, '09:00', '22:00')).toBe(false)
  })

  it('после конца — снаружи', () => {
    expect(isInRange(22 * 60 + 30, '09:00', '22:00')).toBe(false)
  })

  it('ровно на старте — включается', () => {
    expect(isInRange(9 * 60, '09:00', '22:00')).toBe(true)
  })

  it('ровно на конце — не включается (полуоткрытый интервал)', () => {
    expect(isInRange(22 * 60, '09:00', '22:00')).toBe(false)
  })

  it('одна минута до конца — включается', () => {
    expect(isInRange(22 * 60 - 1, '09:00', '22:00')).toBe(true)
  })
})

// ── isInRange: комендантский через полночь (23:00–07:00) ──────────────────────

describe('isInRange — через полночь (23:00–07:00)', () => {
  it('ночью после 23:00 — в зоне запрета', () => {
    expect(isInRange(23 * 60 + 30, '23:00', '07:00')).toBe(true)
  })

  it('в полночь (00:00) — в зоне запрета', () => {
    expect(isInRange(0, '23:00', '07:00')).toBe(true)
  })

  it('ранним утром до 7:00 — в зоне запрета', () => {
    expect(isInRange(6 * 60 + 59, '23:00', '07:00')).toBe(true)
  })

  it('ровно в 07:00 — вне зоны запрета (не включается)', () => {
    expect(isInRange(7 * 60, '23:00', '07:00')).toBe(false)
  })

  it('днём — вне зоны запрета', () => {
    expect(isInRange(12 * 60, '23:00', '07:00')).toBe(false)
  })

  it('ровно в 23:00 — в зоне запрета', () => {
    expect(isInRange(23 * 60, '23:00', '07:00')).toBe(true)
  })

  it('22:59 — вне зоны запрета', () => {
    expect(isInRange(22 * 60 + 59, '23:00', '07:00')).toBe(false)
  })
})

// ── isInRange: граничные значения ────────────────────────────────────────────

describe('isInRange — граничные случаи', () => {
  it('нулевой диапазон 00:00–00:00 — непрерывный запрет', () => {
    // s === e → нет ни одной точки в open interval (s,e), но в переносе через полночь всё включается
    // 0 >= 0 || 0 < 0 → true || false → true
    expect(isInRange(0, '00:00', '00:00')).toBe(true)
    expect(isInRange(12 * 60, '00:00', '00:00')).toBe(true)
  })
})
