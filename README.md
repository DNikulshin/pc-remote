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