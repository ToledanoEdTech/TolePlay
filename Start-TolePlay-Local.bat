@echo off
setlocal enableextensions

REM Always run from this script's folder
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found in PATH.
  echo Please install Node.js LTS and try again.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found in PATH.
  echo Please reinstall Node.js LTS and try again.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo Installing dependencies: npm install...
  npm install
  if errorlevel 1 (
    echo.
    echo npm install failed.
    pause
    exit /b 1
  )
)

echo Starting local server: npm run dev...
start "TolePlay Local Server" cmd /k "npm run dev"

REM Open the site in the default browser (server may need a few seconds to finish starting)
start "" "http://localhost:3000"

exit /b 0

