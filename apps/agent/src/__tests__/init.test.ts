import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Моки поднимаем наверх — init.ts тянет config (fs), logger (fs) и socket.js
const { getMock, mockState, resetConfigMock, warnMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  mockState: { secret: undefined as string | undefined },
  resetConfigMock: vi.fn(),
  warnMock: vi.fn(),
}))

// Значения дублируем в фабриках моков — vi.mock хойстится выше обычных const
const DEVICE_ID = '11111111-1111-1111-1111-111111111111'
const SERVER_URL = 'http://test.local'

vi.mock('axios', () => ({
  default: {
    get: getMock,
    post: vi.fn(),
    // Как у настоящего axios: true только для объектов, помеченных isAxiosError
    isAxiosError: (e: unknown) =>
      typeof e === 'object' && e !== null && (e as { isAxiosError?: boolean }).isAxiosError === true,
  },
}))

vi.mock('../utils/config.js', () => ({
  config: {
    serverUrl: 'http://test.local',
    deviceId: '11111111-1111-1111-1111-111111111111',
    timezone: 'UTC',
  },
  state: mockState,
  saveSecret: vi.fn(),
  saveAgentToken: vi.fn(),
  resetAgentConfig: resetConfigMock,
}))

vi.mock('../utils/logger.js', () => ({
  log: {
    info: vi.fn(),
    warn: warnMock,
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock('../core/socket.js', () => ({
  connectToServer: vi.fn(),
}))

vi.mock('../utils/qr.js', () => ({
  printBindQR: vi.fn(),
}))

import { pollAgentToken, waitForBind } from '../core/init.js'

beforeEach(() => {
  getMock.mockReset()
  resetConfigMock.mockReset()
  warnMock.mockReset()
  mockState.secret = undefined
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// Ошибка в формате axios: response.status читается в init.ts
function axiosErrorWithStatus(status: number): Error {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    response: { status },
  })
}

// ── pollAgentToken: заголовок x-device-secret ─────────────────────────────

describe('pollAgentToken', () => {
  it('шлёт secret в заголовке x-device-secret', async () => {
    getMock.mockResolvedValueOnce({ data: { agentToken: 'agent-token-123' } })

    const token = await pollAgentToken('deadbeef')

    expect(token).toBe('agent-token-123')
    expect(getMock).toHaveBeenCalledTimes(1)

    const [url, options] = getMock.mock.calls[0] as [
      string,
      { headers: Record<string, string>; timeout: number },
    ]
    expect(url).toBe(`${SERVER_URL}/api/devices/${DEVICE_ID}/token`)
    expect(options.headers['x-device-secret']).toBe('deadbeef')
    // secret не должен попадать в URL (логи/прокси)
    expect(url).not.toContain('deadbeef')
    expect(options.timeout).toBeGreaterThan(0)
  })

  it('возвращает null пока устройство не привязано', async () => {
    getMock.mockResolvedValueOnce({ data: { agentToken: null } })

    await expect(pollAgentToken('secret-a')).resolves.toBeNull()
  })

  it('подставляет актуальный secret при каждом вызове', async () => {
    getMock.mockResolvedValue({ data: { agentToken: null } })

    await pollAgentToken('first-secret')
    await pollAgentToken('second-secret')

    const headers = getMock.mock.calls.map(
      (call) => (call[1] as { headers: Record<string, string> }).headers['x-device-secret']
    )
    expect(headers).toEqual(['first-secret', 'second-secret'])
  })

  it('пробрасывает ошибку запроса (401 без secret)', async () => {
    getMock.mockRejectedValueOnce(new Error('Request failed with status code 401'))

    await expect(pollAgentToken('wrong-secret')).rejects.toThrow('401')
  })
})

// ── waitForBind: поведение без secret ─────────────────────────────────────
describe('waitForBind', () => {
  it('без secret — warn, сброс конфига и выход процесса', async () => {
    const exitError = new Error('process.exit called')
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw exitError
    }) as never)

    mockState.secret = undefined

    await expect(waitForBind()).rejects.toThrow('process.exit called')

    expect(resetConfigMock).toHaveBeenCalledTimes(1)
    expect(warnMock).toHaveBeenCalledTimes(1)
    expect(exitSpy).toHaveBeenCalledWith(0)
    // Токен не запрашиваем — сервер ответил бы 401
    expect(getMock).not.toHaveBeenCalled()
  })

  it('403 при поллинге — сброс конфига только после 3 подряд отказов', async () => {
    // Не бросаем из exit: после сброса init.ts выходит из обработчика по return
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)

    vi.useFakeTimers()
    mockState.secret = 'burned-secret'
    getMock.mockRejectedValue(axiosErrorWithStatus(403))

    void waitForBind()

    // Первый опрос — сразу, без ожидания тика
    await vi.advanceTimersByTimeAsync(0)
    expect(getMock).toHaveBeenCalledTimes(1)
    expect(resetConfigMock).not.toHaveBeenCalled()
    expect(exitSpy).not.toHaveBeenCalled()

    // Второй отказ — всё ещё не сбрасываем (разовый 403 может быть гонкой)
    await vi.advanceTimersByTimeAsync(5000)
    expect(getMock).toHaveBeenCalledTimes(2)
    expect(resetConfigMock).not.toHaveBeenCalled()
    expect(exitSpy).not.toHaveBeenCalled()

    // Третий подряд — сброс конфига и выход
    await vi.advanceTimersByTimeAsync(5000)
    expect(getMock).toHaveBeenCalledTimes(3)
    expect(warnMock).toHaveBeenCalledTimes(1)
    expect(resetConfigMock).toHaveBeenCalledTimes(1)
    expect(exitSpy).toHaveBeenCalledWith(0)

    // Больше не поллим — иначе вечный 403
    await vi.advanceTimersByTimeAsync(20_000)
    expect(getMock).toHaveBeenCalledTimes(3)
  })

  it('403 со сбросом счётчика после успешного ответа — конфиг не сбрасывается', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)

    vi.useFakeTimers()
    mockState.secret = 'valid-secret'
    getMock
      .mockRejectedValueOnce(axiosErrorWithStatus(403))
      .mockRejectedValueOnce(axiosErrorWithStatus(403))
      .mockResolvedValueOnce({ data: { agentToken: null } })
      .mockRejectedValueOnce(axiosErrorWithStatus(403))
      .mockRejectedValueOnce(axiosErrorWithStatus(403))

    void waitForBind()
    await vi.advanceTimersByTimeAsync(20_000)

    expect(getMock).toHaveBeenCalledTimes(5)
    expect(resetConfigMock).not.toHaveBeenCalled()
    expect(exitSpy).not.toHaveBeenCalled()
  })

  it('не запускает второй запрос, пока предыдущий висит (in-flight guard)', async () => {
    vi.useFakeTimers()
    mockState.secret = 'valid-secret'

    let release: (value: { data: { agentToken: string | null } }) => void = () => {}
    getMock.mockImplementationOnce(
      () =>
        new Promise<{ data: { agentToken: string | null } }>((resolve) => {
          release = resolve
        })
    )

    void waitForBind()
    await vi.advanceTimersByTimeAsync(0)
    expect(getMock).toHaveBeenCalledTimes(1)

    // Три тика интервала, пока запрос висит — новых запросов нет
    await vi.advanceTimersByTimeAsync(15_000)
    expect(getMock).toHaveBeenCalledTimes(1)

    // Отпускаем висящий запрос — следующий тик снова может поллить
    getMock.mockResolvedValue({ data: { agentToken: null } })
    release({ data: { agentToken: null } })
    await vi.advanceTimersByTimeAsync(5000)
    expect(getMock).toHaveBeenCalledTimes(2)
  })

  it('401 при поллинге — просто ждём дальше (без сброса конфига)', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)

    vi.useFakeTimers()
    mockState.secret = 'valid-secret'
    getMock.mockRejectedValue(axiosErrorWithStatus(401))

    void waitForBind()
    await vi.advanceTimersByTimeAsync(15_000)

    // Тики: 0 (сразу), 5 с, 10 с, 15 с
    expect(getMock).toHaveBeenCalledTimes(4)
    expect(resetConfigMock).not.toHaveBeenCalled()
    expect(exitSpy).not.toHaveBeenCalled()
  })
})
