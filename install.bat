@echo off
rem UniDoc Studio installer for Windows: double-click, or run install.bat in a terminal.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22.13 or later is required (26 LTS recommended).
  echo Install it with:   winget install OpenJS.NodeJS.LTS
  echo or from https://nodejs.org/en/download, then run this file again.
  pause
  exit /b 1
)
node scripts\setup.mjs %*
pause
