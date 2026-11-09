# Деплой backend API

## Текущий продакшен

| Параметр | Значение |
|---|---|
| Хост | Render, Free web service (Docker) |
| URL | https://pc-remote-backend.onrender.com |
| Health | `GET /health` → `{"status":"ok"}` |
| Деплой | автоматически из `main` (Render GitHub integration), образ из корневого `Dockerfile` |
| БД | Render Postgres / внешний Postgres, `DATABASE_URL` в env |
| Проверка кода | `GET /api/devices/<uuid>/token` без заголовка → `401` (актуальная версия) |

Доступность из РФ (check-host.net, узлы `ru1`/`ru2`, Москва, ноябрь 2026):
`200 OK`, ~0.15 с. Render отдаётся через Cloudflare, гео-блокировки для РФ нет.

### Ограничения Free-плана Render

- Web service **засыпает после 15 минут без входящего трафика** (включая WebSocket-сообщения).
  Пока хотя бы один агент подключён и шлёт heartbeat раз в 30 с, сервис не спит.
  Холодный старт — около минуты.
- 750 free instance hours в месяц на workspace (24/7 ≈ 744 ч).
- **Free Postgres удаляется через 30 дней после создания.** Для постоянной БД используйте
  внешний бесплатный Postgres (Neon) или платный план Render.

## Бесплатные варианты (проверено в ноябре 2026)

| Провайдер | Бесплатно | Always-on | Docker + WS | Доступность из РФ | Вердикт |
|---|---|---|---|---|---|
| **Render Free** | 750 ч/мес, без карты | нет (спит 15 мин) | да | да | текущий прод; ок, если агент онлайн |
| **Northflank Sandbox** | $20/мес ресурсов, 2 сервиса + 1 БД, без карты | да | да | да (панель 200 из Москвы) | лучший бесплатный always-on |
| **Oracle Cloud Always Free** | ARM VM 4 OCPU / 24 GB | да | да (свой compose) | да, регион EU | нужна карта, лучший потолок |
| Neon (только БД) | 1 GB, без карты, навсегда | scale-to-zero 5 мин | — | да | рекомендуемая бесплатная БД |
| Supabase (только БД) | 500 MB | пауза при простое | — | да | альтернатива Neon |
| Fly.io | нет free tier (waiver < $5), нужна карта | — | да | да | не бесплатно |
| Koyeb | 5 ч/мес на free-инстансе | нет | да | да | не подходит |
| Zeabur Free | только свои серверы | — | — | — | не подходит |
| Timeweb / Yandex / VK | триал-кредиты, не permanently free | — | — | да (РФ) | только платно |

## Ручной запуск образа (любой хост)

```bash
docker run -p 3000:3000 \
  -e DATABASE_URL='postgresql://user:pass@host:5432/pc_remote' \
  -e JWT_SECRET='<32+ случайных символа>' \
  -e JWT_REFRESH_SECRET='<другая случайная строка>' \
  -e NODE_ENV=production \
  -e PORT=3000 \
  ghcr.io/dnikulshin/pc-remote-api:latest
```

Образ собирается workflow `publish-api.yml` и публикуется в GHCR (см. README).

> Контейнер при старте выполняет `prisma db push --accept-data-loss`. Для схемы без потерь
> применяйте миграции вручную и запускайте `node dist/app.js`.

## Переезд БД на Neon

Нужны два connection string:

- **Render Postgres** → Dashboard → база → *Connect* → **External Database URL**
  (например `postgresql://user:pass@dpg-xxxx.oregon-postgres.render.com/pc_remote`).
- **Neon** → Dashboard → *Connect* → **direct** URL (без `-pooler`), регион eu-central
  для минимальной задержки из РФ.

Порядок:

```bash
# 1. Схема + данные (скрипт сам снимет дамп, восстановит и сверит prisma-схему)
SOURCE_URL='postgresql://...render.com/pc_remote' \
TARGET_URL='postgresql://...neon.tech/neondb?sslmode=require' \
./scripts/migrate-db.sh

# 2. Render → сервис → Environment → DATABASE_URL = Neon URL → Save (перезапуск)
# 3. Проверка
curl -s https://pc-remote-backend.onrender.com/health
```

`SKIP_DATA=1` — только применить схему (чистая база). `KEEP_DUMP=1` — сохранить дамп
в `/tmp/pc-remote-dump.sql`.

Почему **direct**, а не `-pooler`: контейнер при старте выполняет `prisma db push` (DDL),
а Prisma не рекомендует гонять миграции через transaction pooler. Для долгоживущего
одного контейнера direct-соединения Neon достаточно.

Что сохраняется при переезде: пользователи, устройства и их `agentToken` (привязки не
слетают), расписания, история команд. `JWT_SECRET` не меняется — мобильные сессии живы.

После переезда удалите free Postgres на Render, чтобы не упереться в его 30-дневный лимит.

## Проверка доступности из РФ

```bash
RID=$(curl -s -H 'Accept: application/json' \
  "https://check-host.net/check-http?host=https%3A%2F%2Fpc-remote-backend.onrender.com%2Fhealth&node=ru1.node.check-host.net&node=ru2.node.check-host.net" \
  | jq -r .request_id)
sleep 10
curl -s -H 'Accept: application/json' "https://check-host.net/check-result/$RID"
```

Ожидаемо: `[1, <время>, 'OK', 200]` с узлов `ru1`/`ru2` (Москва).
