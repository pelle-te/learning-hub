@echo off
chcp 65001 >nul
cd /d "%~dp0"

rem --- skip start if server already listening on 8000 ---
netstat -ano | findstr ":8000" | findstr "LISTENING" >nul 2>&1
if %errorlevel%==0 goto openapp

echo Starting Learning Hub server...
start "Learning Hub Server" /min cmd /c "node serve.js"

rem --- wait up to 15s for port 8000 ---
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
