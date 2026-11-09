import axios from 'axios'
import { log as logger } from '../utils/logger.js'
import { config, state, saveAgentToken, saveSecret, resetAgentConfig } from '../utils/config.js'
import { connectToServer } from './socket.js'
import { printBindQR } from '../utils/qr.js'

export async function registerDevice(): Promise<string | null> {
  let delay = 5_000

  while (true) {
    try {
      logger.info(`Registering device with server... deviceId=${config.deviceId}`)

      const response = await axios.post<{ deviceId: string; secret: string }>(
        `${config.serverUrl}/api/devices/init`,
        { deviceId: config.deviceId, timezone: config.timezone },
        { timeout: 10_000 }
      )

      const { secret } = response.data
      logger.info('Device registered successfully')

      saveSecret(secret)
      printBindQR(config.deviceId, secret)

      return secret
    } catch (err) {
      // 409 — устройство уже зарегистрировано, переходим к ожиданию привязки
      if (axios.isAxiosError(err) && err.response?.status === 409) {
        logger.info('Device already registered, waiting for bind...')
        return null
      }

      // Сервер недоступен — ретрай с экспоненциальным backoff (5s → 10s → … → 60s)
      const msg = err instanceof Error ? err.message : String(err)
      logger.warn(`Server unreachable, retrying in ${delay / 1000}s — ${msg}`)
      await new Promise<void>(r => setTimeout(r, delay))
      delay = Math.min(delay * 2, 60_000)
    }
  }
}

// Интервал поллинга токена и число последовательных 403, после которого
// secret считаем непригодным
const POLL_INTERVAL_MS = 5_000
const MAX_CONSECUTIVE_403 = 3

export async function waitForBind(): Promise<void> {
  const secret = state.secret

  // Без secret бекенд отвечает 401 на каждый поллинг — лучше сбросить конфиг
  // и перезапуститься (WinSW), чтобы показать новый QR
  if (!secret) {
    logger.warn('No device secret in config — cannot poll for bind token, resetting and restarting...')
    resetAgentConfig()
    process.exit(0)
  }

  logger.info('Waiting for device to be bound via QR...')

  // Фиксируем уже сужённый тип: внутри вложенной функции narrowing не сохраняется
  const deviceSecret: string = secret

  return new Promise((resolve) => {
    // Пока предыдущий запрос не завершён — новый не запускаем: иначе два
    // поллинга (интервал 5 с при timeout 10 с) конкурируют между собой
    let inFlight = false
    // Последовательные 403 — сбрасываем конфиг только если сервер стабильно
    // отвергает secret, а не с первого раза
    let consecutive403 = 0

    async function tick(): Promise<void> {
      if (inFlight) return
      inFlight = true

      try {
        const token = await pollAgentToken(deviceSecret)
        // Успешный ответ (даже с agentToken: null) сбрасывает счётчик отказов
        consecutive403 = 0

        if (token) {
          clearInterval(poll)
          saveAgentToken(token)
          logger.info('Device bound successfully, token saved')

          // Передаём токен напрямую в connectToServer
          await connectToServer(token)
          resolve()
        }
      } catch (err) {
        // 403 — сервер отверг secret (погашен после успешного WS-подключения
        // агента или не совпал). Разовый отказ может быть гонкой — уходим на
        // новый QR только после MAX_CONSECUTIVE_403 подряд, иначе получили бы
        // потерю живой привязки из-за одного сбоя.
        if (axios.isAxiosError(err) && err.response?.status === 403) {
          consecutive403 += 1

          if (consecutive403 >= MAX_CONSECUTIVE_403) {
            clearInterval(poll)
            logger.warn(
              `Device secret rejected by server (403 x${consecutive403}) — resetting binding and restarting for a new QR...`
            )
            resetAgentConfig()
            process.exit(0)
            return
          }
        } else {
          // Сеть/401 — просто ждём дальше, отказы не считаем
          consecutive403 = 0
        }
      } finally {
        inFlight = false
      }
    }

    const poll = setInterval(() => {
      void tick()
    }, POLL_INTERVAL_MS)

    // Первый опрос — сразу, без ожидания первого тика
    void tick()
  })
}

// Один запрос токена агента — secret доказывает, что это именно наш агент
export async function pollAgentToken(secret: string): Promise<string | null> {
  const response = await axios.get<{ agentToken: string | null }>(
    `${config.serverUrl}/api/devices/${config.deviceId}/token`,
    {
      headers: { 'x-device-secret': secret },
      timeout: 10_000,
    }
  )

  return response.data.agentToken
}