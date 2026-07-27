@echo off
title Game Online
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  [!] Node.js non risulta installato.
  echo      Scaricalo ^(versione LTS^) da https://nodejs.org
  echo.
  pause
  exit /b
)

echo.
echo  ============================================================
echo    Game Online - Emulatore multiconsole
echo  ============================================================
echo.
echo    Indirizzo: http://localhost:5173
echo    NON aprire index.html col doppio clic: serve questo server.
echo.
echo    Per chiudere: chiudi questa finestra.
echo  ============================================================
echo.

start "" /min cmd /c "timeout /t 3 /nobreak >nul & start "" http://localhost:5173"
node server.mjs
echo.
pause
