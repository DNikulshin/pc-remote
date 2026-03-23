import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { log as logger } from './utils/logger.js'
import { config, resetAgentConfig, savePasswordHash } from './utils/config.js'
import { registerDevice, waitForBind } from './core/init.js'
import { connectToServer } from './core/socket.js'
import { loadSchedule } from './schedule/store.js'
import { startEnforcer, stopEnforcer } from './schedule/enforcer.js'
import { printBindQR } from './utils/qr.js'
import { startLocalServer } from './local-server.js'

async function main() {
  // --reset: сброс конфига (новый deviceId), выход
  if (process.argv.includes('--reset')) {
    const newCfg = resetAgentConfig()
    console.log(`Config reset. New device ID: ${newCfg.deviceId}`)
    console.log('Restart the agent without --reset to show QR and bind again.')
    process.exit(0)
  }

  // --set-password <password>: хэширует и сохраняет пароль трея
  const setPassIdx = process.argv.indexOf('--set-password')
  if (setPassIdx !== -1) {
    const password = process.argv[setPassIdx + 1]
    if (!password) {
      console.error('Usage: agent.exe --set-password <password>')
      process.exit(1)
    }
    const hash = await bcrypt.hash(password, 10)
    savePasswordHash(hash)
    console.log('Password set successfully.')
    process.exit(0)
  }
  if (!config.serverUrl) {
    logger.error('SERVER_URL is not configured — set it in the service environment (WinSW XML)')
    process.exit(1)
  }

  logger.info(`Agent starting deviceId=${config.deviceId} serverUrl=${config.serverUrl}`)

  loadSchedule()
  startEnforcer()
  startLocalServer()

  if (!config.agentToken) {
    await registerDevice()

    if (config.secret) {
      printBindQR(config.deviceId, config.secret)
    }

    await waitForBind()
  } else {
    await connectToServer()
  }
}

const shutdown = (signal: string) => {
  logger.info(`Shutting down agent signal=${signal}`)
  stopEnforcer()
  process.exit(0)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

process.on('uncaughtException', (err) => {
  logger.error(`Uncaught exception: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})

process.on('unhandledRejection', (reason) => {
  logger.error(`Unhandled rejection: ${String(reason)}`)
  process.exit(1)
})

main().catch((err) => {
  logger.error(`Fatal error: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
