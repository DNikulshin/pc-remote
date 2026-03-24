import os from 'node:os'
import { execSync } from 'node:child_process'

export interface ActiveUser {
  name: string
  session: string   // 'console' | 'rdp' | 'unknown'
  state: string     // 'Active' | 'Disconnected'
  idle: string      // '0m' | '1:30' | 'none' и т.д.
  logonTime: string // '10:30 AM' или datetime
}

export interface DiskInfo {
  mount: string
  total: number
  free: number
  used: number
}

export interface SystemInfo {
  cpuPercent: number
  ramPercent: number
  uptime: number
  activeUsers: ActiveUser[]
  platform: string
  disks: DiskInfo[]
}

// Служебные учётки Windows — исключаем по точному имени или префиксу
const SERVICE_ACCOUNT_PREFIXES = ['DWM-', 'UMFD-', 'SYSTEM', 'LOCAL SERVICE', 'NETWORK SERVICE']
const SERVICE_ACCOUNT_EXACT = new Set([
  'DefaultAccount', 'WDAGUtilityAccount', 'Guest',
])

function isServiceAccount(name: string): boolean {
  const upper = name.toUpperCase()
  return (
    name.endsWith('$') ||
    SERVICE_ACCOUNT_EXACT.has(name) ||
    SERVICE_ACCOUNT_PREFIXES.some((p) => upper.startsWith(p.toUpperCase()))
  )
}

// CPU usage — усредняем за 1 секунду
function getCpuPercent(): Promise<number> {
  return new Promise((resolve) => {
    const start = os.cpus().map((c) => ({ ...c.times }))

    setTimeout(() => {
      const end = os.cpus()
      let totalIdle = 0
      let totalTick = 0

      end.forEach((cpu, i) => {
        const startTimes = start[i]
        if (!startTimes) return

        const idleDiff = cpu.times.idle - startTimes.idle
        const totalDiff = Object.values(cpu.times).reduce((a, b) => a + b, 0)
          - Object.values(startTimes).reduce((a, b) => a + b, 0)

        totalIdle += idleDiff
        totalTick += totalDiff
      })

      const percent = totalTick === 0
        ? 0
        : Math.round((1 - totalIdle / totalTick) * 100)

      resolve(percent)
    }, 1000)
  })
}

function getRamPercent(): number {
  const total = os.totalmem()
  const free = os.freemem()
  return Math.round(((total - free) / total) * 100)
}

// Парсим вывод query user по позициям колонок из заголовка.
// Заголовок содержит ключевые слова: USERNAME, SESSIONNAME, ID, STATE, IDLE, LOGON
// Позиции могут отличаться в разных локалях — определяем их динамически.
function parseQueryUserOutput(output: string): ActiveUser[] {
  const lines = output.split('\n').filter((l) => l.trim())
  if (lines.length < 2) return []

  // Первая строка — заголовок
  const header = lines[0]!.toUpperCase()

  // Ищем начало каждой колонки по ключевому слову
  const colUsername = 0
  const colSession = header.indexOf('SESSIONNAME')
  const colState = header.indexOf('STATE')
  const colIdle = header.indexOf('IDLE')
  const colLogon = header.indexOf('LOGON')

  if (colSession < 0 || colState < 0 || colIdle < 0 || colLogon < 0) {
    // Fallback: если не нашли колонки — возвращаем пустой список
    return []
  }

  const users: ActiveUser[] = []

  for (const line of lines.slice(1)) {
    if (!line.trim()) continue
    // Убираем маркер активной сессии '>'
    const clean = line.startsWith('>') ? ' ' + line.slice(1) : line

    const name = clean.slice(colUsername, colSession).trim()
    // Берём только первое слово из колонки SESSIONNAME, т.к. за ней идёт ID-номер сессии
    const sessionName = (clean.slice(colSession, colState).trim().split(/\s+/)[0] ?? '')
    const state = clean.slice(colState, colIdle).trim()
    const idle = clean.slice(colIdle, colLogon).trim()
    const logonTime = clean.slice(colLogon).trim()

    if (!name || isServiceAccount(name)) continue

    let session = 'unknown'
    if (sessionName.toLowerCase() === 'console') session = 'console'
    else if (sessionName.toLowerCase().startsWith('rdp')) session = 'rdp'
    else if (sessionName) session = sessionName

    users.push({
      name,
      session,
      state: state.toLowerCase().startsWith('disc') ? 'Disconnected' : 'Active',
      idle: idle || 'none',
      logonTime,
    })
  }

  return users
}

export function getActiveUsers(): ActiveUser[] {
  try {
    if (process.platform === 'win32') {
      const output = execSync('query user 2>nul', { encoding: 'utf-8', windowsHide: true })
      return parseQueryUserOutput(output)
    }

    // Linux/Mac для разработки — `who` даёт меньше данных
    const output = execSync('who', { encoding: 'utf-8' })
    return output
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const parts = line.split(/\s+/)
        const name = parts[0] ?? ''
        if (!name || isServiceAccount(name)) return null
        return {
          name,
          session: parts[1] ?? 'unknown',
          state: 'Active',
          idle: 'none',
          logonTime: parts.slice(2).join(' '),
        }
      })
      .filter((u): u is ActiveUser => u !== null)
  } catch {
    return []
  }
}

export interface LocalUser {
  name: string
  fullName: string
  enabled: boolean
}

// Получить всех локальных пользователей Windows через PowerShell Get-LocalUser
export function getLocalUsers(): LocalUser[] {
  if (process.platform !== 'win32') return []

  try {
    const output = execSync(
      'powershell.exe -NonInteractive -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-LocalUser | Select-Object Name,Enabled,FullName | ConvertTo-Json -Compress"',
      { encoding: 'utf-8', windowsHide: true }
    )

    const parsed: unknown = JSON.parse(output.trim())
    const arr = Array.isArray(parsed) ? parsed : [parsed]

    return arr
      .filter((u): u is Record<string, unknown> => typeof u === 'object' && u !== null)
      .filter((u) => !isServiceAccount(String(u['Name'] ?? '')))
      .map((u) => ({
        name: String(u['Name'] ?? ''),
        fullName: String(u['FullName'] ?? ''),
        enabled: Boolean(u['Enabled'] ?? true),
      }))
      .filter((u) => u.name)
  } catch {
    return []
  }
}

function getDiskInfo(): DiskInfo[] {
  try {
    if (process.platform === 'win32') {
      const output = execSync(
        'powershell.exe -NonInteractive -NoProfile -Command "Get-PSDrive -PSProvider FileSystem | Select-Object @{N=\'Mount\';E={$_.Name+\':\'}},@{N=\'Total\';E={[long]($_.Free+$_.Used)}},@{N=\'Free\';E={[long]$_.Free}},@{N=\'Used\';E={[long]$_.Used}} | ConvertTo-Json -Compress"',
        { encoding: 'utf-8', windowsHide: true }
      )
      const parsed: unknown = JSON.parse(output.trim())
      const arr = Array.isArray(parsed) ? parsed : [parsed]
      return arr
        .filter((d): d is Record<string, unknown> => typeof d === 'object' && d !== null)
        .map((d) => ({
          mount: String(d['Mount'] ?? ''),
          total: Number(d['Total'] ?? 0),
          free: Number(d['Free'] ?? 0),
          used: Number(d['Used'] ?? 0),
        }))
        .filter((d) => d.mount && d.total > 0)
    }
    // Linux/Mac для разработки
    const output = execSync('df -B1 / 2>/dev/null', { encoding: 'utf-8' })
    const line = output.split('\n')[1] ?? ''
    const parts = line.split(/\s+/)
    const total = parseInt(parts[1] ?? '0')
    const used = parseInt(parts[2] ?? '0')
    const free = parseInt(parts[3] ?? '0')
    if (!total) return []
    return [{ mount: '/', total, used, free }]
  } catch {
    return []
  }
}

export async function getSystemInfo(): Promise<SystemInfo> {
  const [cpuPercent] = await Promise.all([getCpuPercent()])

  return {
    cpuPercent,
    ramPercent: getRamPercent(),
    uptime: Math.floor(os.uptime()),
    activeUsers: getActiveUsers(),
    platform: process.platform,
    disks: getDiskInfo(),
  }
}