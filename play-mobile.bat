@echo off
rem Poor Fantasy launcher for playing on a phone or tablet on the same Wi-Fi.
rem Same as play.bat, but the game is also reachable from other devices.
title Poor Fantasy (phone mode)
pushd "%~dp0"
if not exist package.json (
  echo ERROR: play-mobile.bat must be inside the poor-fantasy folder.
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
call tools\start.cmd mobile
popd
