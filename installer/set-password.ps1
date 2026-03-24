param([string]$Password)

$logDir  = "$env:ProgramData\pc-remote-agent"
$logFile = "$logDir\setup-password.log"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }

function Write-Log($msg) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg"
    Add-Content -Path $logFile -Value $line -Encoding UTF8
}

Write-Log "set-password.ps1 started, password length=$($Password.Length)"

$body = ConvertTo-Json @{ password = $Password }
for ($i = 0; $i -lt 30; $i++) {
    try {
        $r = Invoke-RestMethod -Uri 'http://127.0.0.1:3535/setup-password' `
            -Method POST -Body $body -ContentType 'application/json' -TimeoutSec 5
        Write-Log "SUCCESS on attempt $($i+1): $($r | ConvertTo-Json -Compress)"
        exit 0
    } catch {
        Write-Log "attempt $($i+1) failed: $($_.Exception.Message)"
        Start-Sleep 1
    }
}
Write-Log "FAILED after 30 attempts"
exit 1
