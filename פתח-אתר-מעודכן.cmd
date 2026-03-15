@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo מפעיל שרת בפורט חדש ופותח את האתר...
echo.

node dev-fresh.js

if errorlevel 1 (
  echo.
  echo אירעה שגיאה. וודא ש-Node מותקן ומהתיקייה הנכונה.
  pause
)
