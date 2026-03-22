import { __clearStore } from '../__mocks__/expo-secure-store'

jest.mock('expo-secure-store')

// Мокируем axios инстанс напрямую — не делаем реальных HTTP запросов
jest.mock('../api/client', () => {
  const mockApi = {
    get: jest.fn(),
    post: jest.fn(),
    delete: jest.fn(),
    defaults: { baseURL: 'http://localhost:3000/api' },
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
  }
  return { api: mockApi, API_URL: 'http://localhost:3000', DEFAULT_API_URL: 'http://localhost:3000' }
})

import type { ActiveUser, DiskInfo } from '../store/devices'

const mockDevice = {
  id: 'device-uuid-001',
  name: 'My PC',
  status: 'online' as const,
  lastSeenAt: '2026-03-20T10:00:00Z',
  cpuPercent: 45,
  ramPercent: 60,
  uptime: 3600,
  activeUsers: [] as ActiveUser[],
  agentVersion: '0.0.1',
  timezone: 'Europe/Moscow',
  disks: [] as DiskInfo[],
}

describe('useDevicesStore', () => {
  beforeEach(() => {
    __clearStore()
    jest.clearAllMocks()
    // Сбрасываем стор перед каждым тестом
    jest.resetModules()
  })

  describe('fetchDevices', () => {
    it('заполняет devices при успешном ответе', async () => {
      const { api: mockApi } = require('../api/client')
      mockApi.get.mockResolvedValueOnce({ data: [mockDevice] })

      const { useDevicesStore } = require('../store/devices')
      const store = useDevicesStore.getState()
      await store.fetchDevices()

      const { devices, isLoading, error } = useDevicesStore.getState()
      expect(devices).toHaveLength(1)
      expect(devices[0].id).toBe('device-uuid-001')
      expect(isLoading).toBe(false)
      expect(error).toBeNull()
    })

    it('устанавливает error при сетевой ошибке', async () => {
      const { api: mockApi } = require('../api/client')
      mockApi.get.mockRejectedValueOnce(new Error('Network Error'))

      const { useDevicesStore } = require('../store/devices')
      const store = useDevicesStore.getState()
      await store.fetchDevices()

      const { devices, error, isLoading } = useDevicesStore.getState()
      expect(devices).toHaveLength(0)
      expect(error).toBeTruthy()
      expect(isLoading).toBe(false)
    })
  })

  describe('sendCommand', () => {
    it('возвращает delivered:true если сервер подтвердил', async () => {
      const { api: mockApi } = require('../api/client')
      mockApi.post.mockResolvedValueOnce({ data: { delivered: true } })

      const { useDevicesStore } = require('../store/devices')
      const result = await useDevicesStore.getState().sendCommand('device-uuid-001', 'LOCK')
      expect(result.delivered).toBe(true)
    })

    it('передаёт delaySeconds в тело запроса', async () => {
      const { api: mockApi } = require('../api/client')
      mockApi.post.mockResolvedValueOnce({ data: { delivered: false } })

      const { useDevicesStore } = require('../store/devices')
      await useDevicesStore.getState().sendCommand('device-uuid-001', 'SHUTDOWN', 60)

      expect(mockApi.post).toHaveBeenCalledWith(
        '/devices/device-uuid-001/commands',
        { type: 'SHUTDOWN', delaySeconds: 60 }
      )
    })
  })

  describe('deleteDevice', () => {
    it('удаляет устройство из локального стора', async () => {
      const { api: mockApi } = require('../api/client')
      // Сначала заполним стор
      mockApi.get.mockResolvedValueOnce({ data: [mockDevice] })
      mockApi.delete.mockResolvedValueOnce({})

      const { useDevicesStore } = require('../store/devices')
      await useDevicesStore.getState().fetchDevices()
      expect(useDevicesStore.getState().devices).toHaveLength(1)

      await useDevicesStore.getState().deleteDevice('device-uuid-001')
      expect(useDevicesStore.getState().devices).toHaveLength(0)
    })
  })

  describe('fetchScreenshot', () => {
    it('возвращает данные скриншота при успешном ответе', async () => {
      const { api: mockApi } = require('../api/client')
      const screenshot = { image: 'base64data==', capturedAt: '2026-03-22T10:00:00.000Z' }
      mockApi.get.mockResolvedValueOnce({ data: screenshot })

      const { useDevicesStore } = require('../store/devices')
      const result = await useDevicesStore.getState().fetchScreenshot('device-uuid-001')

      expect(result).toEqual(screenshot)
      expect(mockApi.get).toHaveBeenCalledWith('/devices/device-uuid-001/screenshot')
    })

    it('возвращает null при ошибке (404 — скриншот ещё не готов)', async () => {
      const { api: mockApi } = require('../api/client')
      mockApi.get.mockRejectedValueOnce(new Error('Request failed with status code 404'))

      const { useDevicesStore } = require('../store/devices')
      const result = await useDevicesStore.getState().fetchScreenshot('device-uuid-001')

      expect(result).toBeNull()
    })
  })

  describe('DiskInfo структура в Device', () => {
    it('device.disks корректно принимает DiskInfo[]', async () => {
      const disks: DiskInfo[] = [
        { mount: 'C:', total: 500 * 1024 ** 3, free: 200 * 1024 ** 3, used: 300 * 1024 ** 3 },
        { mount: 'D:', total: 1024 ** 4, free: 800 * 1024 ** 3, used: 224 * 1024 ** 3 },
      ]
      const { api: mockApi } = require('../api/client')
      mockApi.get.mockResolvedValueOnce({
        data: [{ ...mockDevice, disks }],
      })

      const { useDevicesStore } = require('../store/devices')
      await useDevicesStore.getState().fetchDevices()

      const [device] = useDevicesStore.getState().devices
      expect(device.disks).toHaveLength(2)
      expect(device.disks[0]).toMatchObject({ mount: 'C:', total: expect.any(Number) })
      expect(device.disks[1].mount).toBe('D:')
    })

    it('device.disks по умолчанию пустой массив', async () => {
      const { api: mockApi } = require('../api/client')
      mockApi.get.mockResolvedValueOnce({ data: [mockDevice] })

      const { useDevicesStore } = require('../store/devices')
      await useDevicesStore.getState().fetchDevices()

      const [device] = useDevicesStore.getState().devices
      expect(device.disks).toEqual([])
    })
  })

  describe('ActiveUser структура в Device', () => {
    it('device.activeUsers корректно принимает ActiveUser[]', async () => {
      const users: ActiveUser[] = [
        { name: 'john', session: 'console', state: 'Active', idle: 'none', logonTime: '10:00 AM' },
        { name: 'alice', session: 'rdp', state: 'Disconnected', idle: '5m', logonTime: '09:00 AM' },
      ]
      const { api: mockApi } = require('../api/client')
      mockApi.get.mockResolvedValueOnce({
        data: [{ ...mockDevice, activeUsers: users }],
      })

      const { useDevicesStore } = require('../store/devices')
      await useDevicesStore.getState().fetchDevices()

      const [device] = useDevicesStore.getState().devices
      expect(device.activeUsers).toHaveLength(2)
      expect(device.activeUsers[0]).toMatchObject({ name: 'john', session: 'console', state: 'Active' })
      expect(device.activeUsers[1]).toMatchObject({ name: 'alice', session: 'rdp', state: 'Disconnected' })
    })
  })
})
