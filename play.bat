@echo off
rem Poor Fantasy - update and play. Double-click to run; close this window (or Ctrl+C) to stop.
title Poor Fantasy
pushd "%~dp0"

echo === Getting the latest version...
git pull
if errorlevel 1 echo WARNING: git pull failed - starting the version you already have.

echo === Installing any new packages...
call npm install --no-fund --no-audit
if errorlevel 1 (
  echo ERROR: npm install failed. Copy the messages above and send them to Claude.
  pause
  exit /b 1
)

echo === Starting the game - your browser will open when it is ready.
call npm run dev -- --open

popd
pause
