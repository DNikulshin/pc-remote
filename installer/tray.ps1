param([string]$ServerUrl = 'http://127.0.0.1:3535')

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
public class AudioKeys {
    [DllImport("user32.dll")]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);
    public static void VolumeUp()   { keybd_event(0xAF, 0, 0, 0); keybd_event(0xAF, 0, 2, 0); }
    public static void VolumeDown() { keybd_event(0xAE, 0, 0, 0); keybd_event(0xAE, 0, 2, 0); }
    public static void VolumeMute() { keybd_event(0xAD, 0, 0, 0); keybd_event(0xAD, 0, 2, 0); }
}
'@

# -- Строки интерфейса (unicode char codes — независимо от кодировки файла) --
$s = @{
    Online            = [string]([char]0x25CF) + ' Online'
    Offline           = [string]([char]0x25CB) + ' Offline'
    ServiceUnavail    = '! ' + [string]([char]0x0421,[char]0x043B,[char]0x0443,[char]0x0436,[char]0x0431,[char]0x0430,' ',[char]0x043D,[char]0x0435,[char]0x0434,[char]0x043E,[char]0x0441,[char]0x0442,[char]0x0443,[char]0x043F,[char]0x043D,[char]0x0430)
    ShowQR            = [string]([char]0x041F,[char]0x043E,[char]0x043A,[char]0x0430,[char]0x0437,[char]0x0430,[char]0x0442,[char]0x044C,' ','Q','R','-',[char]0x043A,[char]0x043E,[char]0x0434)
    ResetBind         = [string]([char]0x0421,[char]0x0431,[char]0x0440,[char]0x043E,[char]0x0441,[char]0x0438,[char]0x0442,[char]0x044C,' ',[char]0x043F,[char]0x0440,[char]0x0438,[char]0x0432,[char]0x044F,[char]0x0437,[char]0x043A,[char]0x0443)
    Settings          = [string]([char]0x041D,[char]0x0430,[char]0x0441,[char]0x0442,[char]0x0440,[char]0x043E,[char]0x0439,[char]0x043A,[char]0x0438)
    ChangePass        = [string]([char]0x0418,[char]0x0437,[char]0x043C,[char]0x0435,[char]0x043D,[char]0x0438,[char]0x0442,[char]0x044C,' ',[char]0x043F,[char]0x0430,[char]0x0440,[char]0x043E,[char]0x043B,[char]0x044C)
    HideIcon          = [string]([char]0x0421,[char]0x043A,[char]0x0440,[char]0x044B,[char]0x0442,[char]0x044C,' ',[char]0x0438,[char]0x043A,[char]0x043E,[char]0x043D,[char]0x043A,[char]0x0443)
    Exit              = [string]([char]0x0412,[char]0x044B,[char]0x0439,[char]0x0442,[char]0x0438,' ',[char]0x0438,[char]0x0437,' ',[char]0x0442,[char]0x0440,[char]0x0435,[char]0x044F)
    WrongPass         = [string]([char]0x041D,[char]0x0435,[char]0x0432,[char]0x0435,[char]0x0440,[char]0x043D,[char]0x044B,[char]0x0439,' ',[char]0x043F,[char]0x0430,[char]0x0440,[char]0x043E,[char]0x043B,[char]0x044C)
    EnterPass         = [string]([char]0x0412,[char]0x0432,[char]0x0435,[char]0x0434,[char]0x0438,[char]0x0442,[char]0x0435,' ',[char]0x043F,[char]0x0430,[char]0x0440,[char]0x043E,[char]0x043B,[char]0x044C,':')
    NewPass           = [string]([char]0x041D,[char]0x043E,[char]0x0432,[char]0x044B,[char]0x0439,' ',[char]0x043F,[char]0x0430,[char]0x0440,[char]0x043E,[char]0x043B,[char]0x044C,':')
    PassChanged       = [string]([char]0x041F,[char]0x0430,[char]0x0440,[char]0x043E,[char]0x043B,[char]0x044C,' ',[char]0x0438,[char]0x0437,[char]0x043C,[char]0x0435,[char]0x043D,[char]0x0451,[char]0x043D)
    PassChangeErr     = [string]([char]0x041E,[char]0x0448,[char]0x0438,[char]0x0431,[char]0x043A,[char]0x0430,' ',[char]0x043F,[char]0x0440,[char]0x0438,' ',[char]0x0441,[char]0x043C,[char]0x0435,[char]0x043D,[char]0x0435,' ',[char]0x043F,[char]0x0430,[char]0x0440,[char]0x043E,[char]0x043B,[char]0x044F)
    ResetConfirm      = [string]([char]0x0421,[char]0x0431,[char]0x0440,[char]0x043E,[char]0x0441,[char]0x0438,[char]0x0442,[char]0x044C,' ',[char]0x043F,[char]0x0440,[char]0x0438,[char]0x0432,[char]0x044F,[char]0x0437,[char]0x043A,[char]0x0443,'? ',[char]0x041F,[char]0x0440,[char]0x0438,[char]0x0434,[char]0x0451,[char]0x0442,[char]0x0441,[char]0x044F,' ',[char]0x0437,[char]0x0430,[char]0x043D,[char]0x043E,[char]0x0432,[char]0x043E,' ',[char]0x043E,[char]0x0442,[char]0x0441,[char]0x043A,[char]0x0430,[char]0x043D,[char]0x0438,[char]0x0440,[char]0x043E,[char]0x0432,[char]0x0430,[char]0x0442,[char]0x044C,' ','Q','R','-',[char]0x043A,[char]0x043E,[char]0x0434,' ',[char]0x0432,' ',[char]0x043C,[char]0x043E,[char]0x0431,[char]0x0438,[char]0x043B,[char]0x044C,[char]0x043D,[char]0x043E,[char]0x043C,' ',[char]0x043F,[char]0x0440,[char]0x0438,[char]0x043B,[char]0x043E,[char]0x0436,[char]0x0435,[char]0x043D,[char]0x0438,[char]0x0438,'.')
    ResetDone         = [string]([char]0x041F,[char]0x0440,[char]0x0438,[char]0x0432,[char]0x044F,[char]0x0437,[char]0x043A,[char]0x0430,' ',[char]0x0441,[char]0x0431,[char]0x0440,[char]0x043E,[char]0x0448,[char]0x0435,[char]0x043D,[char]0x0430,'. ',[char]0x0410,[char]0x0433,[char]0x0435,[char]0x043D,[char]0x0442,' ',[char]0x043F,[char]0x0435,[char]0x0440,[char]0x0435,[char]0x0437,[char]0x0430,[char]0x043F,[char]0x0443,[char]0x0441,[char]0x0442,[char]0x0438,[char]0x0442,[char]0x0441,[char]0x044F,'.')
    ResetErr          = [string]([char]0x041E,[char]0x0448,[char]0x0438,[char]0x0431,[char]0x043A,[char]0x0430,' ',[char]0x043F,[char]0x0440,[char]0x0438,' ',[char]0x0441,[char]0x0431,[char]0x0440,[char]0x043E,[char]0x0441,[char]0x0435,' ',[char]0x043F,[char]0x0440,[char]0x0438,[char]0x0432,[char]0x044F,[char]0x0437,[char]0x043A,[char]0x0438)
}

function Make-Icon {
    param([int]$R, [int]$G, [int]$B)
    $bmp = New-Object System.Drawing.Bitmap(16, 16, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $icon = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
    $bmp.Dispose()
    return $icon
}

$iconOnline  = Make-Icon 34 197 94
$iconOffline = Make-Icon 107 114 128

$tray          = New-Object System.Windows.Forms.NotifyIcon
$tray.Text     = 'PC Remote Agent'
$tray.Icon     = $iconOffline
$tray.Visible  = $true

# ---- Menu ----
$menu = New-Object System.Windows.Forms.ContextMenuStrip

$itemStatus = New-Object System.Windows.Forms.ToolStripMenuItem($s.Offline)
$itemStatus.Enabled = $false
$menu.Items.Add($itemStatus) | Out-Null
$menu.Items.Add([System.Windows.Forms.ToolStripSeparator]::new()) | Out-Null

$itemQR    = New-Object System.Windows.Forms.ToolStripMenuItem($s.ShowQR)
$itemReset = New-Object System.Windows.Forms.ToolStripMenuItem($s.ResetBind)
$menu.Items.Add($itemQR)    | Out-Null
$menu.Items.Add($itemReset) | Out-Null
$menu.Items.Add([System.Windows.Forms.ToolStripSeparator]::new()) | Out-Null

$itemSettings    = New-Object System.Windows.Forms.ToolStripMenuItem($s.Settings)
$itemChangePass  = New-Object System.Windows.Forms.ToolStripMenuItem($s.ChangePass)
$itemHide        = New-Object System.Windows.Forms.ToolStripMenuItem($s.HideIcon)
$itemSettings.DropDownItems.Add($itemChangePass) | Out-Null
$itemSettings.DropDownItems.Add($itemHide)       | Out-Null
$menu.Items.Add($itemSettings) | Out-Null
$menu.Items.Add([System.Windows.Forms.ToolStripSeparator]::new()) | Out-Null

$itemExit = New-Object System.Windows.Forms.ToolStripMenuItem($s.Exit)
$menu.Items.Add($itemExit) | Out-Null

$tray.ContextMenuStrip = $menu

# ---- Helpers ----
function Show-Balloon([string]$Text, [string]$Title = 'PC Remote') {
    $tray.BalloonTipTitle = $Title
    $tray.BalloonTipText  = $Text
    $tray.ShowBalloonTip(3000)
}

function Ask-Password {
    Add-Type -AssemblyName Microsoft.VisualBasic
    $pass = [Microsoft.VisualBasic.Interaction]::InputBox($s.EnterPass, 'PC Remote', '')
    if (-not $pass) { return $false }
    try {
        $body   = ConvertTo-Json @{ password = $pass }
        $result = Invoke-RestMethod -Uri "$ServerUrl/verify-password" `
                    -Method POST -Body $body -ContentType 'application/json' -TimeoutSec 3
        return [bool]$result.valid
    } catch { return $false }
}

# Читаем localToken из config.json агента (ProgramData в production, cwd в dev)
function Get-LocalToken {
    $paths = @(
        "$env:ProgramData\pc-remote-agent\config.json",
        "$PSScriptRoot\.agent-config.json"
    )
    foreach ($p in $paths) {
        if (Test-Path $p) {
            try {
                $cfg = Get-Content $p -Raw | ConvertFrom-Json
                if ($cfg.localToken) { return $cfg.localToken }
            } catch {}
        }
    }
    return $null
}

$script:localToken = Get-LocalToken

function Invoke-Post([string]$Path) {
    $headers = @{}
    if ($script:localToken) { $headers['X-Local-Token'] = $script:localToken }
    Invoke-RestMethod -Uri "$ServerUrl$Path" -Method POST -Headers $headers -TimeoutSec 3 | Out-Null
}

# ---- Events ----
$itemQR.Add_Click({
    if (Ask-Password) { Start-Process "$ServerUrl/qr" }
    else { Show-Balloon $s.WrongPass }
})

$itemReset.Add_Click({
    Add-Type -AssemblyName Microsoft.VisualBasic
    $pass = [Microsoft.VisualBasic.Interaction]::InputBox($s.EnterPass, 'PC Remote', '')
    if (-not $pass) { return }
    $ans = [System.Windows.Forms.MessageBox]::Show(
        $s.ResetConfirm,
        'PC Remote',
        [System.Windows.Forms.MessageBoxButtons]::YesNo,
        [System.Windows.Forms.MessageBoxIcon]::Warning)
    if ($ans -eq [System.Windows.Forms.DialogResult]::Yes) {
        try {
            $body = ConvertTo-Json @{ password = $pass }
            $hdrs = @{ 'X-Local-Token' = $script:localToken; 'Content-Type' = 'application/json' }
            Invoke-RestMethod -Uri "$ServerUrl/reset" -Method POST -Body $body -Headers $hdrs -TimeoutSec 3 | Out-Null
            Show-Balloon $s.ResetDone
            Start-Sleep 3
            Start-Process "$ServerUrl/qr"
        } catch { Show-Balloon $s.ResetErr }
    }
})

$itemChangePass.Add_Click({
    if (-not (Ask-Password)) { Show-Balloon $s.WrongPass; return }
    Add-Type -AssemblyName Microsoft.VisualBasic
    $new = [Microsoft.VisualBasic.Interaction]::InputBox($s.NewPass, 'PC Remote', '')
    if (-not $new) { return }
    try {
        $body = ConvertTo-Json @{ password = $new }
        $hdrs = @{ 'X-Local-Token' = $script:localToken; 'Content-Type' = 'application/json' }
        Invoke-RestMethod -Uri "$ServerUrl/change-password" `
            -Method POST -Body $body -Headers $hdrs -TimeoutSec 3 | Out-Null
        Show-Balloon $s.PassChanged
    } catch { Show-Balloon $s.PassChangeErr }
})

$itemHide.Add_Click({
    if (Ask-Password) { $tray.Visible = $false }
    else { Show-Balloon $s.WrongPass }
})

$itemExit.Add_Click({
    if (-not (Ask-Password)) { Show-Balloon $s.WrongPass; return }
    $timer.Stop()
    $tray.Visible = $false
    $tray.Dispose()
    [System.Windows.Forms.Application]::Exit()
})

# ---- Status timer ----
$script:lastOnline = $null

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 5000
$timer.Add_Tick({
    try {
        $st = Invoke-RestMethod -Uri "$ServerUrl/status" -TimeoutSec 2

        # Блокировка экрана — сервис не может вызвать LockWorkStation из session 0,
        # поэтому делегирует трею через pendingLock
        $th = @{ 'X-Local-Token' = $script:localToken }

        if ($st.pendingLock) {
            try { Invoke-RestMethod -Uri "$ServerUrl/ack-lock" -Method POST -Headers $th -TimeoutSec 2 | Out-Null } catch {}
            $msg = if ($st.pendingLockMessage) { $st.pendingLockMessage } else { 'Access restricted' }
            $tray.ShowBalloonTip(4000, 'PC Remote', $msg, [System.Windows.Forms.ToolTipIcon]::Warning)
            Start-Sleep -Seconds 4
            if ($st.pendingLogoff) {
                shutdown /l /f
            } else {
                rundll32.exe user32.dll,LockWorkStation
            }
        }

        # Уведомление об ограничении времени
        if ($st.pendingNotification) {
            try { Invoke-RestMethod -Uri "$ServerUrl/ack-notification" -Method POST -Headers $th -TimeoutSec 2 | Out-Null } catch {}
            $tray.ShowBalloonTip(5000, 'PC Remote', $st.pendingNotification, [System.Windows.Forms.ToolTipIcon]::Warning)
        }

        # Управление громкостью — сервис в session 0 не имеет доступа к аудио сессии пользователя
        if ($st.pendingVolume) {
            try { Invoke-RestMethod -Uri "$ServerUrl/ack-volume" -Method POST -Headers $th -TimeoutSec 2 | Out-Null } catch {}
            switch ($st.pendingVolume) {
                'UP'   { [AudioKeys]::VolumeUp() }
                'DOWN' { [AudioKeys]::VolumeDown() }
                'MUTE' { [AudioKeys]::VolumeMute() }
            }
        }

        # Скриншот — сервис в session 0 не имеет доступа к рабочему столу пользователя
        # ACK отправляем только ПОСЛЕ успешного захвата, чтобы не потерять скриншот при сбое
        if ($st.pendingScreenshot) {
            try {
                $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
                $bmp = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
                $gfx = [System.Drawing.Graphics]::FromImage($bmp)
                $gfx.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
                $ms  = New-Object System.IO.MemoryStream
                $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Jpeg)
                $b64  = [Convert]::ToBase64String($ms.ToArray())
                $ms.Dispose(); $bmp.Dispose(); $gfx.Dispose()
                # Сначала сбрасываем флаг, потом отправляем результат
                Invoke-RestMethod -Uri "$ServerUrl/ack-screenshot" -Method POST -Headers $th -TimeoutSec 2 | Out-Null
                $body = ConvertTo-Json @{ image = $b64 }
                $thJson = @{ 'X-Local-Token' = $script:localToken; 'Content-Type' = 'application/json' }
                Invoke-RestMethod -Uri "$ServerUrl/screenshot-result" -Method POST -Body $body -Headers $thJson -TimeoutSec 10 | Out-Null
            } catch {}
        }

        if ($st.online) {
            if ($script:lastOnline -ne $true) {
                $tray.Icon        = $iconOnline
                $tray.Text        = 'PC Remote Agent - Online'
                $itemStatus.Text  = $s.Online
                $script:lastOnline = $true
            }
        } else {
            if ($script:lastOnline -ne $false) {
                $tray.Icon        = $iconOffline
                $tray.Text        = 'PC Remote Agent - Offline'
                $itemStatus.Text  = $s.Offline
                $script:lastOnline = $false
            }
        }
    } catch {
        if ($null -ne $script:lastOnline) {
            $tray.Icon        = $iconOffline
            $tray.Text        = 'PC Remote Agent'
            $itemStatus.Text  = $s.ServiceUnavail
            $script:lastOnline = $null
        }
    }
})
$timer.Start()

[System.Windows.Forms.Application]::Run()
