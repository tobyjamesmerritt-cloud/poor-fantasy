@echo off
rem Poor Fantasy - update and play. Double-click to run; close this window (or Ctrl+C) to stop.
title Poor Fantasy
pushd "%~dp0"

if not exist package.json (
  echo ERROR: play.bat must be inside the poor-fantasy folder ^(C:\Users\tobym\Documents\poor-fantasy^).
  pause
  exit /b 1
)

echo === Getting the latest version...
git pull --ff-only
if %errorlevel% neq 0 (
  echo.
  echo WARNING: could not update - see the message above. Starting the version you already have.
  pause
)

rem Reinstall packages only when the pinned versions changed (or nothing is installed yet).
set NEED_INSTALL=0
if not exist node_modules\.bin\vite.cmd set NEED_INSTALL=1
if not exist node_modules\.pf-lock-stamp set NEED_INSTALL=1
if %NEED_INSTALL%==0 fc /b package-lock.json node_modules\.pf-lock-stamp >nul 2>&1 || set NEED_INSTALL=1

if %NEED_INSTALL%==1 (
  echo === Installing packages exactly as pinned - close any other Poor Fantasy windows first...
  call npm ci --no-fund --no-audit
)
if %NEED_INSTALL%==1 if %errorlevel% neq 0 goto installfailed
if %NEED_INSTALL%==1 copy /y package-lock.json node_modules\.pf-lock-stamp >nul
if %NEED_INSTALL%==0 echo === Packages up to date.

echo === Starting the game - your browser will open when it is ready.
call npm run dev -- --open
popd
pause
exit /b 0

:installfailed
echo.
echo ERROR: package install failed.
echo Most likely the game is still running in another window - close it ^(or run: taskkill /f /im node.exe^) and try again.
echo If it still fails, copy the messages above and send them to Claude.
popd
pause
exit /b 1
