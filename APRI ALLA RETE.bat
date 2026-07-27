@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Game Online - aperto alla rete

echo.
echo ========================================================
echo   Game Online  -  APERTO ALLA RETE
echo ========================================================
echo.
echo   Usa questo file SOLO quando vuoi invitare qualcuno.
echo   Per giocare da solo usa AVVIA PSONLINE.bat: e' chiuso
echo   e nessun altro puo' raggiungere il tuo computer.
echo.
echo   Mentre questa finestra e' aperta, chi e' sulla tua rete
echo   puo' collegarsi SE ha il codice d'accesso qui sotto.
echo.
echo   Quando avete finito: chiudi questa finestra.
echo.
echo   Se Windows chiede il permesso di rete:
echo     - Reti PRIVATE  -^> consenti
echo     - Reti PUBBLICHE -^> NEGA
echo.
echo ========================================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo   [X] Node.js non e' installato. https://nodejs.org
  echo.
  pause
  exit /b 1
)

set HOST=0.0.0.0
if "%NETPLAY%"=="" set NETPLAY=http://localhost:3000

node server.mjs

echo.
echo   Server chiuso. Il tuo PC non e' piu' raggiungibile dalla rete.
echo.
pause
