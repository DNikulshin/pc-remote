import { log as logger } from '../utils/logger.js'
import { setPendingLock } from '../local-server.js'
import { getLockReason, getMinutesRemainingToday } from './checker.js'
import { incrementUsage } from './tracker.js'
import { getSchedule } from './store.js'
import { getActiveUsers } from '../utils/sysinfo.js'

const CHECK_INTERVAL_MS = 60_000 // проверяем каждую минуту
let enforcerTimer: NodeJS.Timeout | null = null

function lockSession(reason: string) {
  logger.warn({ reason }, 'Locking session')

  if (process.platform !== 'win32') {
    logger.info('[DEV MODE] Would lock session')
    return
  }

  // LockWorkStation не работает из session 0 — делегируем трею через pendingLock
  setPendingLock()
}

function hasActiveSession(): boolean {
  const users = getActiveUsers()
  return users.some((u) => u.state === 'Active')
}

export function startEnforcer() {
  stopEnforcer()

  logger.info('Schedule enforcer started')

  const check = () => {
    const schedule = getSchedule()

    // Если дневной лимит включён и есть активная сессия — считаем время
    if (schedule?.dailyLimit?.enabled && hasActiveSession()) {
      incrementUsage(schedule.timezone)
    }

    // Проверяем причину блокировки
    const reason = getLockReason()
    if (reason !== null) {
      lockSession(reason)
      return
    }

    // Уведомление: осталось мало времени (5 и 1 минута)
    const remaining = getMinutesRemainingToday()
    if (remaining === 5 || remaining === 1) {
      logger.warn({ remaining }, `Daily limit: ${remaining} min remaining`)
      // TODO: Windows toast notification через tray
    }
  }

  // Проверяем сразу при старте (защита после перезагрузки)
  check()

  enforcerTimer = setInterval(check, CHECK_INTERVAL_MS)
}

export function stopEnforcer() {
  if (enforcerTimer) {
    clearInterval(enforcerTimer)
    enforcerTimer = null
  }
}
