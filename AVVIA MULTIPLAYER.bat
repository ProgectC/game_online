@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Game Online - server multiplayer

echo.
echo ========================================================
echo   Game Online  -  server multiplayer (netplay)
echo ========================================================
echo.
echo   Questa finestra va tenuta APERTA mentre giocate.
echo   E' il "centralino" che mette in contatto i due PC.
echo.
echo   Serve SOLO per giocare insieme nella stessa partita.
echo   Per far giocare un amico sul suo schermo, da solo,
echo   basta il server normale (AVVIA PSONLINE.bat).
echo.

where git >nul 2>&1
if errorlevel 1 (
  echo   [X] Git non e' installato.
  echo       Scaricalo da https://git-scm.com/download/win
  echo.
  pause
  exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
  echo   [X] Node.js non e' installato.
  echo       Scaricalo da https://nodejs.org
  echo.
  pause
  exit /b 1
)

REM --- Prima volta: scarica il server ufficiale EmulatorJS-Netplay ---
if not exist "netplay-server\package.json" (
  echo   Prima installazione: scarico il server multiplayer...
  echo.
  if exist "netplay-server" rmdir /s /q "netplay-server"
  git clone --depth 1 https://github.com/EmulatorJS/EmulatorJS-Netplay.git netplay-server
  if errorlevel 1 (
    echo.
    echo   [X] Download non riuscito. Controlla la connessione a internet.
    echo.
    pause
    exit /b 1
  )
  echo.
  echo   Installo i componenti necessari (puo' richiedere un minuto)...
  echo.
  pushd netplay-server
  call npm install
  popd
)

echo.
echo   Avvio il server multiplayer sulla porta 3000...
echo.
echo   ATTENZIONE: la prima volta Windows chiedera' il permesso
echo   di rete. Consenti su "Reti private", NON su quelle pubbliche.
echo.

pushd netplay-server
node index.js
popd

echo.
echo   Il server multiplayer si e' fermato.
echo.
pause
