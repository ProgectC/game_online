@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Game Online - carica su GitHub

echo.
echo ========================================================
echo   Game Online  -  caricamento su GitHub
echo ========================================================
echo.
echo   Repository:  https://github.com/ProgectC/game_online
echo.
echo   Verranno caricati SOLO i file del progetto:
echo     index.html, server.mjs, HANDOFF.md, README.md,
echo     package.json, AVVIA PSONLINE.bat, .gitignore
echo.
echo   NON verra' caricata la cartella data/
echo   (le tue ROM, i BIOS e i salvataggi restano solo sul PC).
echo.
echo ========================================================
echo.

REM --- Git installato? ------------------------------------------------
where git >nul 2>&1
if errorlevel 1 (
  echo   [X] Git non risulta installato su questo PC.
  echo.
  echo   Scaricalo da:  https://git-scm.com/download/win
  echo   Installalo lasciando tutte le opzioni predefinite,
  echo   poi chiudi questa finestra e rilancia questo file.
  echo.
  pause
  exit /b 1
)

REM --- Rimuove un eventuale file di blocco rimasto --------------------
if exist ".git\index.lock" del /f /q ".git\index.lock"

REM --- Inizializza il repository se non esiste ------------------------
if not exist ".git" (
  echo   Inizializzo il repository...
  git init
)

git config user.email "giuseppeskarubi@gmail.com"
git config user.name "Giuseppe"

REM --- Collega il repository su GitHub --------------------------------
git remote remove origin 2>nul
git remote add origin https://github.com/ProgectC/game_online.git

echo   Preparo i file...
git add -A

echo.
echo   --- File che verranno caricati -----------------------
git status --short
echo   ------------------------------------------------------
echo.

git commit -m "Game Online: emulatore web basato su EmulatorJS (build 16)"
if errorlevel 1 echo   (nessuna modifica nuova da salvare: proseguo)

git branch -M main

echo.
echo   Carico su GitHub...
echo.
echo   NOTA: se e' la prima volta, si aprira' una finestra del
echo   browser per accedere al tuo account GitHub. Accedi tu:
echo   la password non passa da questo script.
echo.

git push -u origin main

if errorlevel 1 (
  echo.
  echo   [X] Il caricamento non e' riuscito.
  echo       Causa piu' comune: accesso a GitHub non completato,
  echo       oppure non hai i permessi di scrittura sul repository.
  echo.
) else (
  echo.
  echo   [OK] Fatto! Controlla qui:
  echo        https://github.com/ProgectC/game_online
  echo.
)

pause
