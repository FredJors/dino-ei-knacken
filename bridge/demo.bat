@echo off
REM Startet die Bridge im Demo-Modus (simulierte Events, kein TikTok noetig)
cd /d "%~dp0"
if not exist node_modules call npm install
call npm run demo
pause
