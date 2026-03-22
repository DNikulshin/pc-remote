import { execSync } from 'node:child_process'
import { log as logger } from '../utils/logger.js'
import { setPendingLock, setPendingNotification } from '../local-server.js'
import { getLockReason, getMinutesRemainingToday } from './checker.js'
import { incrementUsage } from './tracker.js'
import { getSchedule } from './store.js'
import { getActiveUsers } from '../utils/sysinfo.js'
import type { LockReason } from './checker.js'

const CHECK_INTERVAL_MS = 60_000 // проверяем каждую минуту
let enforcerTimer: NodeJS.Timeout | null = null

const WINLOGON_KEY = 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon'

function setLoginNotice(reason: LockReason) {
  if (process.platform !== 'win32') return

  try {
    if (reason === null) {
      execSync(`reg add "${WINLOGON_KEY}" /v LegalNoticeCaption /t REG_SZ /d "" /f`, { stdio: 'ignore' })
      execSync(`reg add "${WINLOGON_KEY}" /v LegalNoticeText /t REG_SZ /d "" /f`, { stdio: 'ignore' })
    } else {
      const caption = 'PC Remote — Доступ ограничен'
      const text = reason === 'downtime'
        ? 'Действует комендантский час. Доступ к ПК запрещён в данное время.'
        : reason === 'daily_limit'
          ? 'Дневной лимит экранного времени исчерпан.'
          : 'Доступ к ПК запрещён в данное время суток.'

      execSync(`reg add "${WINLOGON_KEY}" /v LegalNoticeCaption /t REG_SZ /d "${caption}" /f`, { stdio: 'ignore' })
      execSync(`reg add "${WINLOGON_KEY}" /v LegalNoticeText /t REG_SZ /d "${text}" /f`, { stdio: 'ignore' })
    }
  } catch (err) {
    logger.error({ err }, 'Failed to set login notice')
  }
}

function lockSession(reason: LockReason) {
  logger.warn({ reason }, 'Locking session')

  if (process.platform !== 'win32') {
    logger.info('[DEV MODE] Would lock session')
    return
  }

  const message = reason === 'downtime'
    ? 'Комендантский час: выполняется выход из системы'
    : reason === 'daily_limit'
      ? 'Дневной лимит исчерпан: ПК будет заблокирован'
      : 'Доступ запрещён в данное время: ПК будет заблокирован'

  // downtime → полный выход (logoff), остальные → блокировка экрана
  const logoff = reason === 'downtime'
  setPendingLock(message, logoff)
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

    // Обновляем Legal Notice на экране входа
    setLoginNotice(reason)

    if (reason !== null) {
      lockSession(reason)
      return  // после lock не обновляем уведомление таймера
    }

    // Уведомление: осталось мало времени (5 и 1 минута)
    const remaining = getMinutesRemainingToday()
    if (remaining === 5) {
      setPendingNotification('Осталось 5 минут экранного времени')
      logger.warn({ remaining }, 'Daily limit: 5 min remaining')
    } else if (remaining === 1) {
      setPendingNotification('Осталась 1 минута экранного времени')
      logger.warn({ remaining }, 'Daily limit: 1 min remaining')
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
