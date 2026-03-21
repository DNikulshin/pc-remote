import { execSync } from 'node:child_process'
import { log as logger } from '../utils/logger.js'
import { setPendingLock } from '../local-server.js'
import type { CommandPayload } from '@pc-remote/shared'

export async function executeCommand(payload: CommandPayload): Promise<void> {
  const { type, delaySeconds = 0, message } = payload

  logger.info({ type, delaySeconds }, 'Executing command')

  if (process.platform !== 'win32') {
    // В dev-режиме просто логируем
    logger.info(`[DEV MODE] Would execute: ${type} after ${delaySeconds}s`)
    return
  }

  switch (type) {
    case 'SHUTDOWN':
      execSync(
        `shutdown /s /t ${delaySeconds}${message ? ` /c "${message}"` : ''}`,
        { windowsHide: true }
      )
      break

    case 'REBOOT':
      execSync(
        `shutdown /r /t ${delaySeconds}${message ? ` /c "${message}"` : ''}`,
        { windowsHide: true }
      )
      break

    case 'LOCK':
      // LockWorkStation не работает из сервиса (session 0) — делегируем трею через /status
      if (delaySeconds > 0) {
        setTimeout(() => setPendingLock(), delaySeconds * 1000)
      } else {
        setPendingLock()
      }
      break

    case 'SLEEP':
      execSync('rundll32.exe powrprof.dll,SetSuspendState 0,1,0', { windowsHide: true })
      break

    default:
      logger.warn({ type }, 'Unknown command type')
  }
}

// Отменить отложенный shutdown/reboot
export function cancelShutdown(): void {
  if (process.platform !== 'win32') {
    logger.info('[DEV MODE] Would cancel shutdown')
    return
  }
  try {
    execSync('shutdown /a', { windowsHide: true })
    logger.info('Shutdown cancelled')
  } catch {
    // Нет активного shutdown — это нормально
  }
}