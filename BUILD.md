# Локальная сборка артефактов

## Проверка и установка требований

```powershell
.\setup.ps1
```

Скрипт проверяет Git, Node.js, pnpm, Docker Desktop, Inno Setup 6, ngrok и `.wslconfig`.
Если что-то отсутствует — устанавливает через `winget` автоматически.

---

## APK (Android)

**Требования:** Docker Desktop запущен, EXPO_TOKEN готов.

```powershell
# Из корня проекта
.\build-apk.ps1 -ExpoToken 'твой_токен'

# Или через переменную окружения
$env:EXPO_TOKEN = 'твой_токен'
.\build-apk.ps1
```

**Результат:** `apps/mobile/build/app.apk`

- Первый запуск — ~20-30 мин (Docker собирает образ с Android SDK)
- Повторные запуски — ~10-15 мин (образ кешируется)

### Получить EXPO_TOKEN

```bash
npx eas-cli whoami        # проверить текущий аккаунт
npx eas-cli token:create  # создать новый токен
```

### Настройка памяти Docker

Для сборки APK Docker Desktop должен иметь минимум 4 GB RAM.
Настраивается через `C:\Users\<user>\.wslconfig`:

```ini
[wsl2]
memory=5GB
processors=4
swap=2GB
```

После изменения: `wsl --shutdown`, затем перезапустить Docker Desktop.

---

## Windows Installer

**Требования:**
- [Inno Setup 6](https://jrsoftware.org/isdl.php) установлен
- Node.js + pnpm

```powershell
# 1. Собрать агент (exe)
cd apps/agent
pnpm bundle       # esbuild → dist/agent.cjs
pnpm package:win  # pkg    → dist-win/agent.exe
cd ../..

# 2. Собрать инсталлер
& "C:\Users\Admin\AppData\Local\Programs\Inno Setup 6\ISCC.exe" installer\installer.iss
```

**Результат:** `installer/output/pc-remote-agent-setup.exe`

---

## Итого

| Артефакт | Команда | Время |
|---|---|---|
| `apps/mobile/build/app.apk` | `.\build-apk.ps1 -ExpoToken '...'` | ~15 мин |
| `installer/output/pc-remote-agent-setup.exe` | `pnpm bundle && pnpm package:win` + ISCC | ~3 мин |
