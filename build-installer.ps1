# build-installer.ps1 - Build Windows installer for PC Remote Agent
# Run from repo root: .\build-installer.ps1

param(
    [switch]$SkipAgent   # Skip agent.exe build (use existing)
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

function Write-Step($msg) {
    Write-Host ""
    Write-Host ">>> $msg" -ForegroundColor Cyan
}

function Fail($msg) {
    Write-Host ""
    Write-Host "[ERROR] $msg" -ForegroundColor Red
    exit 1
}

# -- Find ISCC.exe -------------------------------------------------------------
function Find-ISCC {
    $cmd = Get-Command "ISCC" -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }

    $candidates = @(
        "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",
        "$env:ProgramFiles\Inno Setup 6\ISCC.exe",
        "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe"
    )
    $found = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
    return $found
}

$iscc = Find-ISCC
if (-not $iscc) {
    Fail "Inno Setup 6 not found. Install: winget install JRSoftware.InnoSetup"
}
Write-Host "Inno Setup: $iscc" -ForegroundColor DarkGray

# -- Build agent.exe -----------------------------------------------------------
if (-not $SkipAgent) {
    Write-Step "Building agent.exe (bundle + pkg)"

    $agentDir = Join-Path $root "apps\agent"
    Push-Location $agentDir

    Write-Host "  pnpm bundle..." -ForegroundColor DarkGray
    pnpm bundle
    if ($LASTEXITCODE -ne 0) { Pop-Location; Fail "pnpm bundle failed" }

    Write-Host "  pnpm package:win..." -ForegroundColor DarkGray
    pnpm package:win
    if ($LASTEXITCODE -ne 0) { Pop-Location; Fail "pnpm package:win failed" }

    Pop-Location

    $agentExe = Join-Path $root "apps\agent\dist-win\agent.exe"
    if (-not (Test-Path $agentExe)) { Fail "agent.exe not found after build: $agentExe" }
    $size = [math]::Round((Get-Item $agentExe).Length / 1MB, 1)
    Write-Host "  agent.exe ready ($size MB)" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "  -SkipAgent: using existing agent.exe" -ForegroundColor Yellow
}

# -- Compile installer ---------------------------------------------------------
Write-Step "Compiling installer (Inno Setup)"

$issFile = Join-Path $root "installer\installer.iss"
if (-not (Test-Path $issFile)) { Fail "File not found: $issFile" }

& $iscc $issFile
if ($LASTEXITCODE -ne 0) { Fail "ISCC.exe failed (exit code $LASTEXITCODE)" }

# -- Result --------------------------------------------------------------------
$output = Join-Path $root "installer\output\pc-remote-agent-setup.exe"
if (-not (Test-Path $output)) { Fail "Expected output not found: $output" }

$sizeMB = [math]::Round((Get-Item $output).Length / 1MB, 1)
Write-Host ""
Write-Host "=== Done! ===" -ForegroundColor Green
Write-Host "  $output" -ForegroundColor White
Write-Host "  Size: $sizeMB MB" -ForegroundColor DarkGray
Write-Host ""
