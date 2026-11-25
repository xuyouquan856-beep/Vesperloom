@echo off
chcp 65001 >nul
set "ROOT_DIR=%~dp0"
if "%ROOT_DIR:~-1%"=="\" set "ROOT_DIR=%ROOT_DIR:~0,-1%"
set "EXE_PATH=%ROOT_DIR%\dist-desktop\win-unpacked\NAI Studio.exe"

if exist "%EXE_PATH%" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ws = New-Object -ComObject WScript.Shell; ^
     $lnk = $ws.CreateShortcut([Environment]::GetFolderPath('Desktop') + '\NAI Studio.lnk'); ^
     $lnk.TargetPath = '%EXE_PATH%'; ^
     $lnk.WorkingDirectory = '%ROOT_DIR%'; ^
     $lnk.IconLocation = '%ROOT_DIR%\frontend\nai_studio.ico,0'; ^
     $lnk.Description = 'NAI Studio — 个人创作工作台 (正式桌面端)'; ^
     $lnk.Save()"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ws = New-Object -ComObject WScript.Shell; ^
     $lnk = $ws.CreateShortcut([Environment]::GetFolderPath('Desktop') + '\NAI Studio.lnk'); ^
     $lnk.TargetPath = 'C:\Users\21815\AppData\Local\Python\bin\pythonw.exe'; ^
     $lnk.Arguments = '"%ROOT_DIR%\desktop_app.py"'; ^
     $lnk.WorkingDirectory = '%ROOT_DIR%'; ^
     $lnk.IconLocation = '%ROOT_DIR%\frontend\nai_studio.ico,0'; ^
     $lnk.Description = 'NAI Studio — 个人创作工作台'; ^
     $lnk.Save()"
)
if errorlevel 1 (
  echo [错误] 创建桌面快捷方式失败。
  pause
  exit /b 1
)
echo [成功] 已在桌面创建 "NAI Studio" 快捷方式（指向正式桌面端 NAI Studio.exe）。
timeout /t 2 >nul
