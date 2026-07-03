@echo off
chcp 65001 >nul
cd /d "%~dp0"

rem === Always launch the LATEST build ===
rem serve.js (Node) does not pick up code changes until restarted, and the old
rem version of this launcher skipped starting it when port 8000 was already up,
rem so a stale server kept running. Now we always stop the old server and start
rem fresh, and rebuild web/dist only when the React source changed.

rem --- 1) Stop any old serve.js on port 8000 (so the newest backend code runs) ---
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":8000" ^| findstr "LISTENING"') do (
  echo Stopping old server, PID %%p ...
  taskkill /PID %%p /F >nul 2>&1
)
rem give the port a moment to free before binding again
timeout /t 1 /nobreak >nul

rem --- 2) Rebuild web/dist only if the React source is newer than the last build ---
powershell -NoProfile -Command "$s=(Get-ChildItem -Recurse -File 'web\src','web\index.html','web\vite.config.ts' -ErrorAction SilentlyContinue | Measure-Object LastWriteTime -Maximum).Maximum; $d=(Get-Item 'web\dist\index.html' -ErrorAction SilentlyContinue).LastWriteTime; if(-not $d -or $s -gt $d){exit 1}else{exit 0}"
if not errorlevel 1 goto startserver

echo.
echo React source changed - building latest UI (about 5-10 sec)...
pushd web
call npm run build
set "BUILD_ERR=%errorlevel%"
popd
if not "%BUILD_ERR%"=="0" (
  echo.
  echo [WARN] Build failed - launching the previous build. See errors above.
  echo.
  pause
)

:startserver
echo Starting Learning Hub server...
start "Learning Hub Server" /min cmd /c "node serve.js"

rem --- wait up to 15s for port 8000 to come up ---
for /l %%i in (1,1,15) do (
  timeout /t 1 /nobreak >nul
  netstat -ano | findstr ":8000" | findstr "LISTENING" >nul 2>&1
  if not errorlevel 1 goto openapp
)

:openapp
set "CHROME="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"

if defined CHROME (
  start "" "%CHROME%" --app=http://localhost:8000
) else (
  start "" "http://localhost:8000"
)
