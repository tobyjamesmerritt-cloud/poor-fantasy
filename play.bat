@echo off
rem Poor Fantasy launcher. Keep this file tiny and unchanged: Windows reads a
rem running .bat from disk, so the real steps live in tools\start.cmd, which is
rem read fresh AFTER git pull has updated it.
title Poor Fantasy
pushd "%~dp0"
if not exist package.json (
  echo ERROR: play.bat must be inside the poor-fantasy folder.
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
call tools\start.cmd
popd
