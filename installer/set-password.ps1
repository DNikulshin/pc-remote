param([string]$Password)
$body = ConvertTo-Json @{ password = $Password }
for ($i = 0; $i -lt 30; $i++) {
    try {
        Invoke-RestMethod -Uri 'http://127.0.0.1:3535/setup-password' `
            -Method POST -Body $body -ContentType 'application/json' -TimeoutSec 5
        exit 0
    } catch {
        Start-Sleep 1
    }
}
exit 1
