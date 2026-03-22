param(
    [string]$ExpoToken = $env:EXPO_TOKEN
)

if (-not $ExpoToken) {
    Write-Error "EXPO_TOKEN required: .\build-apk.ps1 -ExpoToken 'your_token'"
    exit 1
}

$Root      = $PSScriptRoot
$MobileDir = "$Root\apps\mobile"
$ImageName = "pc-remote-apk-builder"

Write-Host "=== Building Docker image ===" -ForegroundColor Cyan
docker build -f "$Root\Dockerfile.apk" -t $ImageName "$Root"
if ($LASTEXITCODE -ne 0) { Write-Error "Docker build failed"; exit 1 }

Write-Host "`n=== Building APK ===" -ForegroundColor Cyan

docker run --rm `
    -e EXPO_TOKEN=$ExpoToken `
    -e GRADLE_OPTS="-Dorg.gradle.jvmargs=-Xmx4g -Dorg.gradle.daemon=false" `
    -v "${Root}:/repo" `
    -w /repo/apps/mobile `
    $ImageName `
    bash -c "eas build --platform android --profile preview --non-interactive --local --output /repo/apps/mobile/build/app.apk"

if ($LASTEXITCODE -ne 0) { Write-Error "APK build failed"; exit 1 }

Write-Host "`n=== Done ===" -ForegroundColor Green
Write-Host "APK: $MobileDir\build\app.apk"
