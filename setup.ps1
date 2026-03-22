# setup.ps1 - Check and install dev environment requirements for pc-remote
# Run as Administrator for Inno Setup and Docker installs

$ErrorActionPreference = "Stop"

$OK   = "[OK]"
$MISS = "[MISSING]"
$INST = "[INSTALLING]"

function Test-Command($cmd) {
    return [bool](Get-Command $cmd -ErrorAction SilentlyContinue)
}

function Write-Status($status, $name, $detail = "") {
    $color = if ($status -eq $OK) { "Green" } elseif ($status -eq $INST) { "Cyan" } else { "Yellow" }
    Write-Host "$status $name" -ForegroundColor $color -NoNewline
    if ($detail) { Write-Host "  ($detail)" -ForegroundColor DarkGray } else { Write-Host }
}

Write-Host ""
Write-Host "=== pc-remote: checking dev environment ===" -ForegroundColor Cyan
Write-Host ""

$allOk = $true

# ── Node.js ──────────────────────────────────────────────────────────────────
if (Test-Command "node") {
    $v = node --version
    Write-Status $OK "Node.js" $v
} else {
    $allOk = $false
    Write-Status $MISS "Node.js"
    Write-Status $INST "Node.js" "winget install OpenJS.NodeJS.LTS"
    winget install --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
}

# ── pnpm ─────────────────────────────────────────────────────────────────────
if (Test-Command "pnpm") {
    $v = pnpm --version
    Write-Status $OK "pnpm" $v
} else {
    $allOk = $false
    Write-Status $MISS "pnpm"
    Write-Status $INST "pnpm" "npm install -g pnpm"
    npm install -g pnpm
}

# ── Docker Desktop ───────────────────────────────────────────────────────────
if (Test-Command "docker") {
    $running = $false
    try { docker info *>$null; $running = $true } catch {}
    if ($running) {
        $v = (docker version --format "{{.Server.Version}}" 2>$null)
        Write-Status $OK "Docker Desktop" "v$v, running"
    } else {
        Write-Status "[WARN]" "Docker Desktop" "installed but not running - start Docker Desktop"
        $allOk = $false
    }
} else {
    $allOk = $false
    Write-Status $MISS "Docker Desktop"
    Write-Status $INST "Docker Desktop" "winget install Docker.DockerDesktop"
    winget install --id Docker.DockerDesktop --accept-source-agreements --accept-package-agreements
    Write-Host ""
    Write-Host "  NOTE: After install, start Docker Desktop manually and re-run this script." -ForegroundColor Yellow
}

# ── Inno Setup 6 ─────────────────────────────────────────────────────────────
$innoPath = "C:\Users\Admin\AppData\Local\Programs\Inno Setup 6\ISCC.exe"
$innoInPath = Test-Command "ISCC"

if ($innoInPath -or (Test-Path $innoPath)) {
    $exePath = if ($innoInPath) { (Get-Command "ISCC").Source } else { $innoPath }
    $v = (& $exePath /? 2>&1 | Select-String "Inno Setup" | Select-Object -First 1).ToString().Trim()
    Write-Status $OK "Inno Setup 6" $exePath
} else {
    $allOk = $false
    Write-Status $MISS "Inno Setup 6"
    Write-Status $INST "Inno Setup 6" "winget install JRSoftware.InnoSetup"
    winget install --id JRSoftware.InnoSetup --accept-source-agreements --accept-package-agreements
}

# ── Git ──────────────────────────────────────────────────────────────────────
if (Test-Command "git") {
    $v = git --version
    Write-Status $OK "Git" $v
} else {
    $allOk = $false
    Write-Status $MISS "Git"
    Write-Status $INST "Git" "winget install Git.Git"
    winget install --id Git.Git --accept-source-agreements --accept-package-agreements
}

# ── ngrok ─────────────────────────────────────────────────────────────────────
$ngrokCmd = Get-Command "ngrok" -ErrorAction SilentlyContinue
if (-not $ngrokCmd) {
    # winget installs to a non-PATH location — search it
    $ngrokWinget = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Ngrok.Ngrok*\ngrok.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($ngrokWinget) { $ngrokCmd = $ngrokWinget }
}

if ($ngrokCmd) {
    $ngrokPath = if ($ngrokCmd -is [System.IO.FileInfo]) { $ngrokCmd.FullName } else { $ngrokCmd.Source }
    Write-Status $OK "ngrok" $ngrokPath
    # Check auth token configured
    $ngrokConfig = "$env:USERPROFILE\AppData\Local\ngrok\ngrok.yml"
    if (-not (Test-Path $ngrokConfig)) {
        Write-Host "  [WARN] ngrok auth token not configured." -ForegroundColor Yellow
        Write-Host "         Run: ngrok config add-authtoken YOUR_TOKEN" -ForegroundColor DarkGray
        Write-Host "         Get token at: https://dashboard.ngrok.com/get-started/your-authtoken" -ForegroundColor DarkGray
    }
} else {
    $allOk = $false
    Write-Status $MISS "ngrok"
    Write-Status $INST "ngrok" "winget install Ngrok.Ngrok"
    winget install --id Ngrok.Ngrok --accept-source-agreements --accept-package-agreements
    Write-Host "  After install, configure auth token:" -ForegroundColor Yellow
    Write-Host "    ngrok config add-authtoken YOUR_TOKEN" -ForegroundColor DarkGray
    Write-Host "    Get token at: https://dashboard.ngrok.com/get-started/your-authtoken" -ForegroundColor DarkGray
}

# ── WSL2 memory (.wslconfig) ─────────────────────────────────────────────────
$wslConfig = "$env:USERPROFILE\.wslconfig"
if (Test-Path $wslConfig) {
    $mem = (Select-String "memory=" $wslConfig).Line
    Write-Status $OK ".wslconfig" $mem
} else {
    Write-Status "[WARN]" ".wslconfig" "not found - Docker may have <4GB RAM (APK builds need 5GB)"
    Write-Host "  Run: setup.ps1 will create it now..." -ForegroundColor Yellow
    @"
[wsl2]
memory=5GB
processors=4
swap=2GB
"@ | Set-Content $wslConfig
    Write-Host "  Created $wslConfig - restart WSL: wsl --shutdown" -ForegroundColor Cyan
}

# ── Summary ───────────────────────────────────────────────────────────────────
Write-Host ""
if ($allOk) {
    Write-Host "=== All requirements satisfied. Ready to develop and build! ===" -ForegroundColor Green
} else {
    Write-Host "=== Some requirements were installed. Restart your terminal and re-run setup.ps1 ===" -ForegroundColor Yellow
}
Write-Host ""
Write-Host "  APK:       .\build-apk.ps1 -ExpoToken 'your_token'" -ForegroundColor DarkGray
Write-Host "  Installer: cd apps\agent && pnpm bundle && pnpm package:win" -ForegroundColor DarkGray
Write-Host "             ISCC.exe installer\installer.iss" -ForegroundColor DarkGray
Write-Host ""
