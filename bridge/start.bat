@echo off
REM Startet die Dino-Ei-Bridge (Doppelklick genuegt)
cd /d "%~dp0"
if not exist node_modules (
  echo Installiere Abhaengigkeiten ...
  call npm install
)
if not exist .env (
  copy .env.example .env >nul
  echo.
  echo Bitte in der geoeffneten Datei TIKTOK_USERNAME eintragen, speichern und schliessen.
  notepad .env
)
call npm start
pause
