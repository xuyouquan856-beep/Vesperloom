@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
title NAI Studio - Obsidian Atelier

set "ROOT_DIR=%~dp0"
if "%ROOT_DIR:~-1%"=="\" set "ROOT_DIR=%ROOT_DIR:~0,-1%"
cd /d "%ROOT_DIR%"

set "TMP=%ROOT_DIR%\tmp"
set "TEMP=%ROOT_DIR%\tmp"
set "TMPDIR=%ROOT_DIR%\tmp"
set "PYTHONDONTWRITEBYTECODE=1"
set "PYTHONUTF8=1"
set "PIP_CACHE_DIR=%ROOT_DIR%\tmp\pip_cache"
if not exist "%TMP%" mkdir "%TMP%" >nul 2>&1

set "PORT=8780"
set "URL=http://127.0.0.1:%PORT%"

REM 检测是否已有实例在监听端口，避免重复启动报错
netstat -ano 2>nul | findstr /R /C:":%PORT% .*LISTENING" >nul
if %errorlevel%==0 (
  echo [NAI Studio] 检测到后端已在 %URL% 运行，正在直接打开界面...
  start "" msedge --app=%URL% 2>nul || start "" %URL%
  exit /b 0
)

REM 自动定位真正安装了 uvicorn + fastapi 的 Python（跳过 WindowsApps 占位符与其他无关 venv）
set "PY_EXE="
for %%C in (
  "%ROOT_DIR%\.venv\Scripts\python.exe"
  "%ROOT_DIR%\venv\Scripts\python.exe"
  "C:\Users\21815\AppData\Local\Python\bin\python.exe"
) do (
  if not defined PY_EXE if exist "%%~C" (
    "%%~C" -c "import uvicorn, fastapi" >nul 2>&1
    if !errorlevel!==0 set "PY_EXE=%%~C"
  )
)

if not defined PY_EXE (
  for /f "delims=" %%P in ('where python 2^>nul') do (
    if not defined PY_EXE (
      echo "%%P" | findstr /I "WindowsApps" >nul
      if !errorlevel! neq 0 (
        "%%P" -c "import uvicorn, fastapi" >nul 2>&1
        if !errorlevel!==0 set "PY_EXE=%%P"
      )
    )
  )
)

if not defined PY_EXE (
  echo [错误] 未找到已安装 uvicorn 与 fastapi 的 Python 解释器。
  echo 请运行: pip install -r requirements.txt
  pause
  exit /b 1
)

echo ========================================================
echo   NAI Studio — 个人创作工作台 (离线秒开 · 零 C 盘缓存)
echo   工作目录: %ROOT_DIR%
echo   Python  : %PY_EXE%
echo   服务地址: %URL%
echo ========================================================

start "" cmd /c "timeout /t 2 >nul & (start msedge --app=%URL% 2>nul || start %URL%)"
"%PY_EXE%" -m uvicorn backend.app:app --host 127.0.0.1 --port %PORT%
if errorlevel 1 (
  echo.
  echo [错误] NAI Studio 启动失败，请查看上方报错信息。
  pause
)
