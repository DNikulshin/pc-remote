#define MyAppName "PC Remote Agent"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "PC Remote"
#define MyAppExeName "agent.exe"
#define MyServiceName "PCRemoteAgent"
#define MyAppId "B3C4D5E6-F7A8-9012-BCDE-F12345678901"

[Setup]
AppId={{{#MyAppId}}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
OutputDir=output
OutputBaseFilename=pc-remote-agent-setup
Compression=lzma2/ultra64
SolidCompression=yes
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\{#MyAppExeName}
; При повторной установке не спрашивать — сразу заменить
CloseApplications=yes
CloseApplicationsFilter=*agent.exe*

[Languages]
Name: "russian"; MessagesFile: "compiler:Languages\Russian.isl"

[Files]
Source: "winsw\winsw.exe"; DestDir: "{app}"; DestName: "agent-svc.exe"; \
  Flags: ignoreversion; AfterInstall: CreateWinSWConfig
Source: "..\apps\agent\dist-win\agent.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "tray.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "tray-launcher.vbs"; DestDir: "{app}"; Flags: ignoreversion
Source: "set-password.ps1"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\Запустить трей PC Remote"; \
  Filename: "{app}\tray-launcher.vbs"; \
  IconFilename: "{app}\{#MyAppExeName}"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"

[Registry]
; Автозапуск трея при входе пользователя
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; \
  ValueType: string; ValueName: "PC Remote Tray"; \
  ValueData: "wscript.exe ""{app}\tray-launcher.vbs"""; \
  Flags: uninsdeletevalue

[Run]
; Регистрируем и запускаем сервис
Filename: "{app}\agent-svc.exe"; Parameters: "install"; \
  Flags: runhidden waituntilterminated
Filename: "{app}\agent-svc.exe"; Parameters: "start"; \
  Flags: runhidden waituntilterminated

; Устанавливаем пароль через HTTP после старта сервиса (надёжнее чем --set-password)
Filename: "powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\set-password.ps1"" -Password ""{code:GetTrayPassword}"""; \
  Flags: runhidden waituntilterminated

; Права на службу: SYSTEM и администраторы имеют полный контроль (для корректной переустановки).
; Обычные пользователи (AU) — только чтение статуса.
Filename: "sc.exe"; \
  Parameters: "sdset {#MyServiceName} D:(A;;CCLCSWRPWPDTLOCRRCSDWDWO;;;SY)(A;;CCLCSWRPWPDTLOCRRCSDWDWO;;;BA)(A;;CCLCLOCRRC;;;AU)"; \
  Flags: runhidden waituntilterminated

; Запускаем трей сразу после установки
Filename: "wscript.exe"; \
  Parameters: """{app}\tray-launcher.vbs"""; \
  Description: "Запустить системный трей PC Remote"; \
  Flags: runhidden nowait postinstall

[UninstallRun]
; 1. Убиваем процесс трея (powershell, запускающий tray.ps1)
Filename: "powershell.exe"; \
  Parameters: "-NoProfile -WindowStyle Hidden -Command ""Get-CimInstance Win32_Process | Where-Object {{$_.Name -eq 'powershell.exe' -and $_.CommandLine -like '*tray.ps1*'} | ForEach-Object {{Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue}"""; \
  Flags: runhidden waituntilterminated

; 2. Убиваем agent.exe если запущен вне сервиса
Filename: "taskkill.exe"; Parameters: "/F /IM {#MyAppExeName}"; \
  Flags: runhidden waituntilterminated

; 3. Останавливаем и удаляем сервис
Filename: "{app}\agent-svc.exe"; Parameters: "stop"; \
  Flags: runhidden waituntilterminated
Filename: "{app}\agent-svc.exe"; Parameters: "uninstall"; \
  Flags: runhidden waituntilterminated

[UninstallDelete]
; Удаляем конфиг, токены и логи агента из ProgramData
Type: filesandordirs; Name: "{commonappdata}\pc-remote-agent"

[Code]
var
  ServerUrlPage: TInputQueryWizardPage;
  PasswordPage: TInputQueryWizardPage;

{ ------------------------------------------------------------------ }
{ Проверка — существует ли сервис                                      }
{ ------------------------------------------------------------------ }
function ServiceExists: Boolean;
var
  ResultCode: Integer;
begin
  Exec('sc.exe', 'query {#MyServiceName}', '', SW_HIDE,
    ewWaitUntilTerminated, ResultCode);
  Result := (ResultCode = 0);
end;

{ ------------------------------------------------------------------ }
{ Убить трей и агент, остановить сервис перед копированием файлов     }
{ ------------------------------------------------------------------ }
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Result := '';

  // Убиваем tray.ps1 powershell процесс
  Exec('powershell.exe',
    '-NoProfile -WindowStyle Hidden -Command "Get-CimInstance Win32_Process | Where-Object {$_.Name -eq ''powershell.exe'' -and $_.CommandLine -like ''*tray.ps1*''} | ForEach-Object {Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue}"',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);

  // Убиваем agent.exe
  Exec('taskkill.exe', '/F /IM {#MyAppExeName}',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);

  // Останавливаем и удаляем сервис
  if ServiceExists then begin
    Exec('sc.exe', 'stop {#MyServiceName}',
      '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    Sleep(2000);
    // Пробуем удалить через WinSW
    if FileExists(ExpandConstant('{app}\agent-svc.exe')) then
      Exec(ExpandConstant('{app}\agent-svc.exe'), 'uninstall',
        '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    // sc delete как fallback
    Exec('sc.exe', 'delete {#MyServiceName}',
      '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    // Registry fallback — работает даже если DACL заблокировал sc delete
    Exec('reg.exe', 'delete "HKLM\SYSTEM\CurrentControlSet\Services\{#MyServiceName}" /f',
      '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    Sleep(1000);
  end;
end;

{ ------------------------------------------------------------------ }
{ Проверка наличия текущей установки при запуске инсталлера           }
{ ------------------------------------------------------------------ }
function InitializeSetup: Boolean;
var
  UninstallKey: String;
begin
  Result := True;
  UninstallKey := 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{' +
    '{#MyAppId}' + '}_is1';
  if RegKeyExists(HKLM, UninstallKey) then begin
    if MsgBox(
      'PC Remote Agent уже установлен на этом компьютере.' + #13#10 + #13#10 +
      'Продолжить? Старая версия будет остановлена и заменена.' + #13#10 +
      'Конфигурация и привязка устройства сохранятся.',
      mbConfirmation, MB_YESNO) = IDNO then
      Result := False;
  end;
end;

{ ------------------------------------------------------------------ }
{ Создать конфиг WinSW                                                }
{ ------------------------------------------------------------------ }
procedure CreateWinSWConfig;
var
  ConfigPath: String;
  Lines: TArrayOfString;
  ServerUrl: String;
begin
  ServerUrl := ServerUrlPage.Values[0];
  ConfigPath := ExpandConstant('{app}\agent-svc.xml');

  SetArrayLength(Lines, 17);
  Lines[0]  := '<?xml version="1.0" encoding="UTF-8"?>';
  Lines[1]  := '<service>';
  Lines[2]  := '  <id>{#MyServiceName}</id>';
  Lines[3]  := '  <name>{#MyAppName}</name>';
  Lines[4]  := '  <description>PC Remote Agent - remote PC control</description>';
  Lines[5]  := '  <executable>' + ExpandConstant('{app}\{#MyAppExeName}') + '</executable>';
  Lines[6]  := '  <env name="SERVER_URL" value="' + ServerUrl + '"/>';
  Lines[7]  := '  <env name="NODE_ENV" value="production"/>';
  Lines[8]  := '  <env name="LOG_LEVEL" value="info"/>';
  Lines[9]  := '  <startmode>Automatic</startmode>';
  Lines[10] := '  <serviceaccount>';
  Lines[11] := '    <username>LocalSystem</username>';
  Lines[12] := '  </serviceaccount>';
  Lines[13] := '  <stoptimeout>15 sec</stoptimeout>';
  Lines[14] := '  <log mode="none"/>';
  Lines[15] := '  <onfailure action="restart" delay="10 sec"/>';
  Lines[16] := '</service>';

  SaveStringsToFile(ConfigPath, Lines, False);
end;

function GetTrayPassword(Param: String): String;
begin
  Result := PasswordPage.Values[0];
end;

{ ------------------------------------------------------------------ }
{ Страницы мастера установки                                          }
{ ------------------------------------------------------------------ }
procedure InitializeWizard;
begin
  ServerUrlPage := CreateInputQueryPage(wpSelectDir,
    'Настройка подключения', 'Укажите адрес сервера PC Remote',
    'URL сервера (Render, ngrok или другой).');
  ServerUrlPage.Add('URL сервера:', False);
  ServerUrlPage.Values[0] := 'https://pc-remote-backend.onrender.com';

  PasswordPage := CreateInputQueryPage(ServerUrlPage.ID,
    'Защита трея', 'Установите пароль для доступа к меню трея',
    'Этот пароль будет запрошен при любом действии: показать QR, сбросить привязку и др.');
  PasswordPage.Add('Пароль:', True);
  PasswordPage.Add('Повторите пароль:', True);
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;

  if CurPageID = ServerUrlPage.ID then begin
    if Trim(ServerUrlPage.Values[0]) = '' then begin
      MsgBox('Пожалуйста, введите URL сервера.', mbError, MB_OK);
      Result := False;
    end;
  end;

  if CurPageID = PasswordPage.ID then begin
    if Trim(PasswordPage.Values[0]) = '' then begin
      MsgBox('Пароль не может быть пустым.', mbError, MB_OK);
      Result := False;
    end else if PasswordPage.Values[0] <> PasswordPage.Values[1] then begin
      MsgBox('Пароли не совпадают.', mbError, MB_OK);
      Result := False;
    end;
  end;
end;
