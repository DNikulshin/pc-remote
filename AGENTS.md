# PC Remote — инструкции для AI-агентов

> Дополняет `CLAUDE.md` (соглашения по коду). При конфликте — `CLAUDE.md` приоритетнее,
> если там описано конкретное правило синтаксиса/архитектуры.

## Стек

- **Монорепо**: pnpm workspaces (`apps/*`, `packages/*`), Node.js 20+ (в CI 20, локально допустим 22/24)
- **Backend**: Fastify 4, Prisma 5, PostgreSQL 16, Socket.IO 4, TypeScript ESM
- **Agent**: Node.js, esbuild → CJS-бандл → pkg → `agent.exe`; локальный HTTP `127.0.0.1:3535` для трея
- **Mobile**: React Native 0.83, Expo SDK 55, Zustand, axios, Jest (`jest-expo`)
- **Общий контракт**: `packages/shared` (zod-схемы + `WS_EVENTS`)

## Команды

| Что | Команда |
|---|---|
| Установка | `pnpm install` |
| Сборка shared (обязательно перед тестами/типами) | `pnpm --filter @pc-remote/shared build` |
| Типы всего монорепо | `pnpm typecheck` |
| Типы пакета | `pnpm --filter <backend\|agent\|mobile> typecheck` |
| Unit-тесты агента | `pnpm --filter agent test` |
| Unit-тесты мобилки | `pnpm --filter mobile test -- --coverage=false` |
| Интеграционные тесты backend | `pnpm --filter backend test` — нужен запущенный backend на `:3000` и Postgres |
| Запуск backend локально | `docker compose up -d` → `cd apps/backend && pnpm db:push && pnpm dev` |
| Запуск агента | `cd apps/agent && pnpm dev` |
| Сборка агента | `pnpm --filter agent bundle && pnpm --filter agent package:win` |
| Линтер | не настроен — не выдумывать команду |

Порядок проверки после правок: `shared build` → `typecheck` → затронутые тесты.
Backend-тесты без поднятого сервера/БД считать недоступными и явно об этом сообщать.

## Правила

- Не коммитить и не пушить без явной просьбы.
- Правки минимальные, в рамках задачи; без попутного рефакторинга и переименований.
- Новую зависимость — только с обоснованием в ответе.
- Секреты не читать и не печатать: `.env`, `.agent-config.json`, `auth.json`, токены.
- Не трогать: `node_modules/`, `dist/`, `dist-win/`, `installer/winsw/`, `installer/output/`,
  сгенерированный Prisma client, `pnpm-lock.yaml` (кроме осознанного изменения зависимостей).
- Соблюдать `CLAUDE.md`: ESM-импорты с `.js`, `exactOptionalPropertyTypes` (conditional spread),
  Prisma `Device.userId: null` явно, в агенте нет top-level await (всё в `async function main()`),
  блокировка экрана идёт через трей (сервис в session 0).
- Windows-специфичные ветки (`execSync`, `reg add`, `shutdown`) не запускать на Linux —
  агент сам логирует `[DEV MODE]`.

## Цикл разработки

Артефакты этапов — в `.pi/artifacts/` (в `.gitignore`), по файлу на этап:
`plan.md` → правки кода + `code-report.md` → `review.md` (при BLOCKER/MAJOR — вторая итерация).

Запуск: `/cycle <задача>` из корня проекта.
