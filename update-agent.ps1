$agentSrc = "C:\Users\dmn\Desktop\DEV\pc-remote\apps\agent\dist-win\agent.exe"
$agentDst = "C:\Program Files\PC Remote Agent\agent.exe"
$traySrc  = "C:\Users\dmn\Desktop\DEV\pc-remote\installer\tray.ps1"
$trayDst  = "C:\Program Files\PC Remote Agent\tray.ps1"

Write-Host "Killing agent.exe and tray processes..."
taskkill /F /IM agent.exe /T 2>$null
Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'powershell.exe' -and $_.CommandLine -like '*tray.ps1*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2

Write-Host "Copying agent.exe and tray.ps1..."
Copy-Item $agentSrc $agentDst -Force
Copy-Item $traySrc  $trayDst  -Force
Write-Host "Copied OK"

Write-Host "Starting service..."
Start-Service PCRemoteAgent -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3

$status = (Get-Service PCRemoteAgent).Status
Write-Host "Service status: $status"

Write-Host "Done. Start tray manually in a regular (non-admin) PowerShell:"
Write-Host "  powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$trayDst`""
