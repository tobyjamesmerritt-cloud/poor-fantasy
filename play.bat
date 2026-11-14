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
if errorlevel 1 (
  echo.
  echo WARNING: could not update - see the message above. Starting the version you already have.
  echo Send the message above to Claude if this keeps happening.
  pause
)

echo === Installing packages exactly as pinned...
rem npm ci never edits package-lock.json, so the next update cannot be blocked by it.
call npm ci --no-fund --no-audit
if errorlevel 1 (
  echo ERROR: package install failed. Copy the messages above and send them to Claude.
  pause
  exit /b 1
)

echo === Starting the game - your browser will open when it is ready.
call npm run dev -- --open

popd
pause
