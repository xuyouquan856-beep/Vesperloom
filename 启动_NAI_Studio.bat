@echo off
chcp 65001 >nul
title NAI Studio — Liquid Glass 个人工作台 (D盘零C盘占用)
cd /d "D:\NAI-Studio"
set TMP=D:\NAI-Studio\tmp
set TEMP=D:\NAI-Studio\tmp
set TMPDIR=D:\NAI-Studio\tmp
set PYTHONDONTWRITEBYTECODE=1
set PIP_CACHE_DIR=D:\NAI-Studio\tmp\pip_cache

echo ========================================================
echo   NAI Studio — Liquid Glass 个人创作工作台
echo   存储路径: D:\NAI-Studio (严禁占用 C 盘空间已启用)
echo   正在启动后端服务: http://127.0.0.1:8780
echo ========================================================

start "" cmd /c "timeout /t 2 >nul & start msedge --app=http://127.0.0.1:8780 || start http://127.0.0.1:8780"
"C:\Users\21815\AppData\Local\Python\bin\python.exe" -m uvicorn backend.app:app --host 127.0.0.1 --port 8780
