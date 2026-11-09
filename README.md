# PC Remote

Удалённое управление Windows-ПК через мобильное приложение и веб-интерфейс.

**Возможности:**
- Выключение, перезагрузка, блокировка, сон
- Управление громкостью, скриншоты рабочего стола
- Расписание работы, комендантский час, дневной лимит времени
- Мониторинг CPU, RAM, активных пользователей, дисков
- Бонусное время для продления сессии

**Архитектура:**
- Agent (Node.js → `agent.exe`) на Windows, работает как служба
- Backend (Fastify + PostgreSQL + Socket.IO)
- Mobile (React Native Expo)

**Документация:**
- [BUILD.md](BUILD.md) – сборка APK и Windows-инсталлятора
- [TESTING.md](TESTING.md) – инструкции по тестированию
- [CLAUDE.md](CLAUDE.md) – правила для AI-ассистентов

**Быстрый старт (backend + мобильное приложение):**
```bash
docker compose up -d
cd apps/backend && pnpm db:push && pnpm dev
cd apps/mobile && pnpm start
Сервер: http://localhost:3000 (локальный экземпляр)
```

## Образ API и релизы

Готовый образ backend публикуется в GitHub Container Registry:

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

Обязательные переменные окружения: `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`,
`NODE_ENV=production`, `PORT=3000`. Порт контейнера — `3000`.

Публикация: push в `main` (при изменениях в `apps/backend/**`, `packages/shared/**`,
`Dockerfile`, lockfile или самом workflow) обновляет тег ветки и `latest`; push тега `v*`
(например `v1.2.0`) публикует образ с тегами `:1.2.0`, `:1.2`, `:sha-xxxxxxx` (тег `:latest` обновляется
только из `main`), а также создаёт **GitHub Release** с APK (`pc-remote-v1.2.0.apk`), Windows-установщиком
(`pc-remote-agent-v1.2.0-setup.exe`) и отдельным бинарником агента (`pc-remote-agent-v1.2.0.exe`).

> ⚠️ Контейнер при старте выполняет `prisma db push --accept-data-loss` — схема БД
> приводится к текущей без миграций, возможна потеря данных. Для продакшена с миграциями
> запускайте backend самостоятельно.