@echo off
rem Starts UniDoc Studio on http://127.0.0.1:3000. Close this window to stop it.
cd /d "%~dp0"
if not exist .next (
  echo Not installed yet. Run install.bat first.
  pause
  exit /b 1
)
echo UniDoc Studio: http://127.0.0.1:3000   (close this window to stop)
call npm start
pause
