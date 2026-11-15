@echo off
rem Called by play.bat after git pull. Installs packages only when the pinned
rem versions changed, then starts the game and opens the browser.

set NEED_INSTALL=0
if not exist node_modules\.bin\vite.cmd set NEED_INSTALL=1
if not exist node_modules\.pf-lock-stamp set NEED_INSTALL=1
if %NEED_INSTALL%==0 fc /b package-lock.json node_modules\.pf-lock-stamp >NUL 2>&1 || set NEED_INSTALL=1

if %NEED_INSTALL%==1 (
  echo === Installing packages exactly as pinned - make sure no other Poor Fantasy window is open...
  call npm ci --no-fund --no-audit
)
if %NEED_INSTALL%==1 if %errorlevel% neq 0 goto installfailed
if %NEED_INSTALL%==1 copy /y package-lock.json node_modules\.pf-lock-stamp >NUL
if %NEED_INSTALL%==0 echo === Packages up to date.

echo === Starting the game - your browser will open when it is ready.
echo     To stop the game, close THIS window (closing the browser is not enough).
if /i "%~1"=="mobile" goto mobile
call npm run dev -- --open
pause
exit /b 0

:mobile
echo.
echo === PHONE MODE: on your phone (same Wi-Fi as this PC), open the address
echo     shown below next to "Network:" - for example http://192.168.1.23:5173
echo     If Windows asks whether Node.js may use the network, allow PRIVATE networks.
echo     Anyone on your home Wi-Fi can reach the game while this window is open.
echo.
call npm run dev -- --open --host
pause
exit /b 0

:installfailed
echo.
echo ERROR: package install failed.
echo Most likely the game is still running in another window. Close it, or run:
echo     taskkill /f /im node.exe
echo then try again. If it still fails, send the messages above to Claude.
pause
exit /b 1
