# PC Remote

[![Tests](https://github.com/DNikulshin/pc-remote/actions/workflows/test.yml/badge.svg)](https://github.com/DNikulshin/pc-remote/actions/workflows/test.yml)
[![Release](https://img.shields.io/github/v/release/DNikulshin/pc-remote?label=release)](https://github.com/DNikulshin/pc-remote/releases/latest)
[![API image](https://img.shields.io/badge/ghcr.io-pc--remote--api-2496ED?logo=docker&logoColor=white)](https://github.com/DNikulshin/pc-remote/pkgs/container/pc-remote-api)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

Удалённое управление домашним Windows-ПК с телефона: питание, блокировка, громкость,
скриншоты, расписание доступа и мониторинг состояния. Состоит из агента-службы для Windows,
backend'а на Fastify + PostgreSQL и мобильного приложения на Expo.

## Возможности

- **Питание**: выключение, перезагрузка, блокировка, сон (с задержкой и сообщением).
- **Мультимедиа**: громкость вверх/вниз/выкл, скриншот рабочего стола.
- **Расписание**: разрешённые часы по дням недели, комендантский час, дневной лимит
  экранного времени, бонусные минуты.
- **Мониторинг**: CPU, RAM, uptime, диски, активные сессии и локальные пользователи Windows.
- **Привязка по QR** и JWT-аутентификация (access 15 мин + refresh с ротацией).

## Готовые сборки

Все артефакты — в [Releases](https://github.com/DNikulshin/pc-remote/releases/latest):

| Платформа | Файл | Что это |
|---|---|---|
| Android | `pc-remote-vX.Y.Z.apk` | мобильное приложение (Expo) |
| Windows | `pc-remote-agent-vX.Y.Z-setup.exe` | установщик: служба WinSW + системный трей |
| Windows | `pc-remote-agent-vX.Y.Z.exe` | portable-агент (`--reset`, `--set-password`) |
| Docker | `ghcr.io/dnikulshin/pc-remote-api:X.Y.Z` | backend-образ |

## Архитектура

```
 Mobile (Expo) ──HTTP + Socket.IO──► Backend (Fastify, PostgreSQL)
                                          │  namespace /agents
                                          ▼
                              Windows Agent (служба WinSW)
                                          │  локальный HTTP 127.0.0.1:3535
                                          ▼
                                     tray.ps1 (трей)
```

Привязка устройства: агент регистрируется и показывает QR (`http://127.0.0.1:3535/qr`),
приложение сканирует код и привязывает ПК к аккаунту, после чего агент получает токен и
держит WebSocket-соединение с backend'ом.

## Стек

| Часть | Технологии |
|---|---|
| `apps/backend` | Fastify 4, Prisma 5, PostgreSQL 16, Socket.IO 4, TypeScript (ESM), zod |
| `apps/agent` | Node.js, esbuild → CJS → pkg (`.exe`), winston, socket.io-client |
| `apps/mobile` | React Native 0.83, Expo SDK 55, Zustand, axios, react-navigation |
| `packages/shared` | общие zod-схемы и константы WS-событий |
| `installer` | Inno Setup, PowerShell-трей |

## Быстрый старт

Требования: Node.js 20+, pnpm, Docker (для PostgreSQL). Телефон с Expo Go — в той же
Wi-Fi сети, что и ПК.

```bash
# 1. Зависимости и база
pnpm install
docker compose up -d          # PostgreSQL :5432, Adminer :8080

# 2. Backend
cd apps/backend
# .env: DATABASE_URL, JWT_SECRET, JWT_REFRESH_SECRET, NODE_ENV=development
pnpm db:push
pnpm dev                      # http://localhost:3000

# 3. Агент (второй терминал)
cd apps/agent                 # .env: SERVER_URL="http://localhost:3000"
pnpm dev                      # покажет QR для привязки

# 4. Мобильное приложение (третий терминал)
cd apps/mobile
npm install
npx expo start
```

Полный список переменных окружения и особенности платформ — в [CLAUDE.md](CLAUDE.md).

## Образ API (GHCR)

```bash
docker pull ghcr.io/dnikulshin/pc-remote-api:latest

docker run -p 3000:3000 \
  -e DATABASE_URL='postgresql://user:pass@host:5432/pc_remote' \
  -e JWT_SECRET='случайная строка, мин. 32 символа' \
  -e JWT_REFRESH_SECRET='другая случайная строка' \
  -e NODE_ENV=production \
  -e PORT=3000 \
  ghcr.io/dnikulshin/pc-remote-api:latest
```

Публикация: push в `main` обновляет `latest`, `main` и `sha-*`; push тега `vX.Y.Z`
публикует `X.Y.Z`, `X.Y`, `sha-*` и создаёт GitHub Release с APK, установщиком и
portable-агентом.

> ⚠️ Контейнер при старте выполняет `prisma db push --accept-data-loss`: схема БД
> приводится к текущей без миграций, возможна потеря данных. Для продакшена с миграциями
> запускайте backend самостоятельно.

## Разработка

| Что | Команда |
|---|---|
| Типы (все пакеты) | `pnpm typecheck` |
| Unit-тесты агента | `pnpm --filter agent test` |
| Unit-тесты мобилки | `pnpm --filter mobile test` |
| Интеграционные тесты backend | `pnpm --filter backend test` — нужен запущенный backend и PostgreSQL |
| Сборка агента | `pnpm --filter agent bundle && pnpm --filter agent package:win` |

CI (GitHub Actions): `Tests` на каждый push/PR, `Publish API image` при изменениях
backend'а, `Build Android APK` и `Build Windows Agent Installer` — на теги `v*`.

## Документация

- [BUILD.md](BUILD.md) — сборка APK и Windows-инсталлятора
- [TESTING.md](TESTING.md) — ручное и автоматическое тестирование
- [CLAUDE.md](CLAUDE.md) — соглашения по коду и архитектуре
- [AGENTS.md](AGENTS.md) — правила для AI-агентов и команды проверок

## Лицензия

[MIT](LICENSE)
