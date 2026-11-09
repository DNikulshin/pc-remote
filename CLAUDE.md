# PC Remote — инструкции для Claude Code

## Структура монорепозитория

```
pc-remote/
├── apps/
│   ├── backend/       # Fastify API + Prisma + Socket.io
│   ├── agent/         # Node.js агент для Windows ПК
│   └── mobile/        # React Native + Expo SDK 55
├── packages/
│   └── shared/        # Общие типы (TypeScript)
├── installer/
│   ├── installer.iss  # Inno Setup — Windows installer
│   └── tray.ps1       # PowerShell системный трей
├── docker-compose.yml # PostgreSQL 16 + Adminer
└── mobile-start.sh    # Запуск Expo + туннели
```

## Стек

- **Runtime**: Node.js 24, pnpm workspaces
- **Backend**: Fastify 4, Prisma 5, PostgreSQL 16, Socket.io 4, TypeScript ESM
- **Agent**: Node.js, esbuild → CJS bundle → pkg → .exe
- **Mobile**: React Native 0.83.2, Expo SDK 55, Zustand, Axios
- **CI/CD**: GitHub Actions (Windows installer + Android APK)

## Настройка с нуля (локально)

### 1. Требования

- Node.js 20+ (рекомендуется 24)
- pnpm (`npm install -g pnpm`)
- Docker Desktop
- Git

### 2. Клонирование и установка

```bash
git clone https://github.com/DNikulshin/pc-remote.git
cd pc-remote
pnpm install
```

### 3. База данных

```bash
docker compose up -d
# PostgreSQL: localhost:5432  user: pcremote  pass: pcremote  db: pc_remote
# Adminer UI: http://localhost:8080
```

### 4. Backend

```bash
# Создать apps/backend/.env:
DATABASE_URL="postgresql://pcremote:pcremote@localhost:5432/pc_remote"
JWT_SECRET="any-random-string-32-chars-min"
JWT_REFRESH_SECRET="another-random-string"
NODE_ENV="development"
LOG_LEVEL="debug"

cd apps/backend
pnpm db:push     # применить схему Prisma
pnpm dev         # запуск на :3000 с hot-reload
```

### 5. Agent (Windows / Linux для разработки)

```bash
# Создать apps/agent/.env:
SERVER_URL="http://localhost:3000"

cd apps/agent
pnpm dev         # запуск с hot-reload, покажет QR в терминале
```

Флаги агента:
```bash
node dist/agent.cjs --reset              # сброс привязки, новый QR
node dist/agent.cjs --set-password <pwd> # установить пароль трея
```

### 6. Mobile

```bash
# Установить Expo Go на телефон (SDK 55)
# Телефон и ПК должны быть в одной Wi-Fi сети

cd apps/mobile
npm install      # mobile использует npm, не pnpm
npx expo start   # локальная сеть

# Или для разработки через туннели (телефон на другой сети):
./mobile-start.sh  # запускает ngrok (backend) + localtunnel (Metro)
```

## Переменные окружения

### Backend (`apps/backend/.env`)

| Переменная | Описание | Пример |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://pcremote:pcremote@localhost:5432/pc_remote` |
| `JWT_SECRET` | Секрет для access token (мин. 32 символа) | случайная строка |
| `JWT_REFRESH_SECRET` | Секрет для refresh token | другая случайная строка |
| `NODE_ENV` | Окружение | `development` / `production` |
| `LOG_LEVEL` | Уровень логирования | `debug` / `info` |
| `PORT` | Порт сервера (Render подставляет автоматически) | `3000` |

### Agent (`apps/agent/.env`)

| Переменная | Описание | Пример |
|---|---|---|
| `SERVER_URL` | URL бекенда | `http://localhost:3000` |

На Windows в production — задаётся через реестр или WinSW env block.

## Тестовые учётные данные (локально)

```
Email:    test@example.com
Password: Test1234
```

## Конфигурационные файлы агента

Путь к конфигу зависит от окружения:
- **Production (Windows)**: `%APPDATA%\pc-remote-agent\config.json`
- **Development**: `apps/agent/.agent-config.json`

Структура:
```json
{
  "deviceId": "uuid",
  "agentToken": "hex token",
  "secret": "hex (только до привязки)",
  "timezone": "Europe/Moscow",
  "passwordHash": "bcrypt hash"
}
```

## Деплой

### Backend

Два поддерживаемых способа — оба используют `Dockerfile` из корня репозитория:

1. **Render**: Web Service + PostgreSQL сервис (`DATABASE_URL` подставляется
   автоматически), env `JWT_SECRET`, `JWT_REFRESH_SECRET`, `NODE_ENV=production`.
   URL продакшн-бекенда: `https://pc-remote-backend.onrender.com`.
   Free tier засыпает без активности (keep-alive workflow удалён).
2. **GHCR-образ**: `ghcr.io/dnikulshin/pc-remote-api` — публикуется workflow
   `publish-api.yml` (main → `latest`/`main`/`sha-*`, тег `v*` → semver-теги).

### GitHub Actions

- **`test.yml`** — agent unit, backend integration (Postgres service), mobile unit
- **`publish-api.yml`** — сборка и публикация docker-образа в GHCR
- **`build-agent.yml`** — Windows installer + portable `agent.exe` (push в main по
  путям `apps/agent/**`; на тег `v*` — прикрепляет файлы к GitHub Release)
- **`build-mobile.yml`** — Android APK (EAS local build; на тег `v*` — релиз с APK)

Релиз: `git tag vX.Y.Z && git push origin vX.Y.Z` — образ, APK и Windows-артефакты
собираются параллельно и попадают в один GitHub Release.

Секреты GitHub (Settings → Secrets → Actions):
- `EXPO_TOKEN` — токен EAS (`eas whoami`, затем `eas token:create`)
- `GITHUB_TOKEN` — выдаётся автоматически (`packages: write` для GHCR, `contents: write`
  для релизов)

### Туннели для разработки

- **ngrok** (backend :3000): `https://metalled-imperatorially-eusebia.ngrok-free.app`
  - Настроить в `~/.ngrok2/ngrok.yml` с named tunnel `backend`
- **localtunnel** (Metro :8081): динамический URL, `./mobile-start.sh` подбирает автоматически

## Соглашения по коду

### TypeScript

- `exactOptionalPropertyTypes: true` — использовать conditional spread вместо `prop: value | undefined`:
  ```ts
  // Правильно:
  { ...( value !== undefined && { prop: value }) }
  // Неправильно:
  { prop: value ?? undefined }
  ```
- Все файлы ESM — импорты с расширением `.js` даже для `.ts` файлов
- Prisma `Device.userId` — nullable (`String?`), при создании явно передавать `userId: null`

### Backend

- Winston logger через обёртку `log`, не `logger` напрямую
- Fastify logger transport — conditional spread (не использовать в production):
  ```ts
  ...(dev ? { transport: { target: 'pino-pretty' } } : {})
  ```

### Agent

- esbuild собирает в CJS — `top-level await` не поддерживается, весь async-код внутри `async function main()`
- Локальный HTTP сервер на `127.0.0.1:3535` — для коммуникации трея с агентом

### Mobile

- EAS local build определяет pnpm workspace (через корневой `pnpm-workspace.yaml`) и использует pnpm
- `expo-camera` для QR-сканирования (не expo-barcode-scanner — он удалён как deprecated)
- Динамический URL бекенда через `SecureStore` — меняется в Settings экране

## Архитектура

```
Mobile App ──HTTP/WS──► Backend (Render / Docker)
                              │
                         Socket.io
                              │
                    Windows Agent (WinSW)
                              │
                    Local HTTP :3535
                              │
                        tray.ps1 (трей)
```

**Поток привязки устройства:**
1. Агент запускается → генерирует `deviceId` + `secret` → регистрирует на бекенде
2. Показывает QR с `{deviceId, secret}` в терминале / браузере (`http://127.0.0.1:3535/qr`)
3. Мобильное приложение сканирует QR → `POST /api/devices/:id/bind` с secret
4. Бекенд привязывает устройство к пользователю
5. Агент получает `agentToken` и подключается по WebSocket

## Полезные команды

```bash
# Проверка типов всего монорепо
pnpm typecheck

# Prisma Studio (GUI для БД)
cd apps/backend && pnpm db:studio

# Сборка агента для Windows
cd apps/agent && pnpm bundle && pnpm package:win

# Посмотреть логи агента (dev)
# Логи пишутся в apps/agent/logs/

# Сброс БД (осторожно!)
cd apps/backend && pnpm db:push --force-reset
```

## Известные проблемы и решения

| Проблема | Решение |
|---|---|
| `expo-barcode-scanner` ошибки компиляции | Удалён из deps и `app.json` plugins, используем `expo-camera` |
| EAS local build: pnpm not found | `npm install -g pnpm` перед сборкой |
| Agent top-level await в CJS | Весь async код внутри `async function main()` |
| Mobile: `workspace:*` dep breaks npm install | `@pc-remote/shared` убран из mobile deps |
| Prisma exactOptionalPropertyTypes | Явно передавать `userId: null` при создании Device |
