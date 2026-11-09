#!/usr/bin/env bash
# Переезд базы PC Remote на новый Postgres (например Render → Neon).
#
# Использование:
#   SOURCE_URL='postgresql://...' TARGET_URL='postgresql://...' ./scripts/migrate-db.sh
#
# Переменные:
#   SOURCE_URL  — текущая БД (откуда копируем данные)
#   TARGET_URL  — новая БД (куда переезжаем), должна быть пустой
#   SKIP_DATA=1 — только применить схему Prisma, без переноса данных
#   KEEP_DUMP=1 — сохранить SQL-дамп в /tmp/pc-remote-dump.sql
#
# Скрипт идемпотентен для повторного запуска: перед восстановлением целевая
# схема очищается (--clean --if-exists), затем сверяется через prisma db push.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DUMP="/tmp/pc-remote-dump.sql"

: "${SOURCE_URL:?SOURCE_URL is required}"
: "${TARGET_URL:?TARGET_URL is required}"

# Prisma-параметры (?schema=public) psql/pg_dump не понимают — оставляем только sslmode
sanitize() {
  python3 - "$1" <<'PY'
import sys
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode
u = urlsplit(sys.argv[1])
keep = [(k, v) for k, v in parse_qsl(u.query) if k in ("sslmode", "sslrootcert")]
print(urlunsplit((u.scheme, u.netloc, u.path, urlencode(keep), "")))
PY
}

SRC_PG="$(sanitize "$SOURCE_URL")"
DST_PG="$(sanitize "$TARGET_URL")"

echo "==> source: ${SRC_PG%%\?*}"
echo "==> target: ${DST_PG%%\?*}"

if [ "${SKIP_DATA:-0}" != "1" ]; then
  echo "==> dumping source"
  pg_dump --no-owner --no-privileges --clean --if-exists --format=plain "$SRC_PG" > "$DUMP"
  echo "    dump size: $(wc -c < "$DUMP") bytes"

  echo "==> restoring into target"
  psql "$DST_PG" -v ON_ERROR_STOP=1 -q -f "$DUMP" > /dev/null

  [ "${KEEP_DUMP:-0}" = "1" ] || rm -f "$DUMP"
fi

echo "==> reconciling Prisma schema"
(cd "$ROOT/apps/backend" && DATABASE_URL="$TARGET_URL" pnpm prisma db push --skip-generate)

echo "==> row counts"
psql "$DST_PG" -At -F ' = ' -c "
  select 'User', count(*) from \"User\"
  union all select 'Device', count(*) from \"Device\"
  union all select 'Command', count(*) from \"Command\"
  union all select 'Schedule', count(*) from \"Schedule\";
"

echo "==> done. Обновите DATABASE_URL на хостинге и перезапустите сервис."
