@echo off
chcp 65001 >nul
set "ROOT_DIR=%~dp0"
if "%ROOT_DIR:~-1%"=="\" set "ROOT_DIR=%ROOT_DIR:~0,-1%"
set "EXE_PATH=%ROOT_DIR%\dist-desktop\win-unpacked\Vesperloom.exe"

if exist "%EXE_PATH%" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ws = New-Object -ComObject WScript.Shell; ^
     $lnk = $ws.CreateShortcut([Environment]::GetFolderPath('Desktop') + '\Vesperloom.lnk'); ^
     $lnk.TargetPath = '%EXE_PATH%'; ^
     $lnk.WorkingDirectory = '%ROOT_DIR%'; ^
     $lnk.IconLocation = '%ROOT_DIR%\frontend\vesperloom.ico,0'; ^
     $lnk.Description = 'Vesperloom — Obsidian Atelier 个人创作工作台'; ^
     $lnk.Save()"
) else (
  echo [错误] 未找到 Vesperloom.exe，请先在 desktop-electron 目录运行 npm run pack。
  pause
  exit /b 1
)
echo [成功] 已在桌面创建 "Vesperloom" 快捷方式（含全新星芒图标）。
timeout /t 2 >nul
