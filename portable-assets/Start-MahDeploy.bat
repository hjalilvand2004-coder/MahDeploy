@echo off
chcp 65001 >nul
title MahDeploy — استقراربان (Portable)
setlocal EnableExtensions
cd /d "%~dp0"

rem ------------------------------------------------------------
rem  MahDeploy portable launcher — double-click to run.
rem  Optional port argument:  Start-MahDeploy.bat 3100
rem ------------------------------------------------------------

set "PORT=3000"
if not "%~1"=="" set "PORT=%~1"

echo.
echo   [*] MahDeploy — استقراربان (Portable Edition)
echo   [*] Checking port %PORT% ...

powershell -NoProfile -Command "if (Get-NetTCPConnection -State Listen -LocalPort %PORT% -ErrorAction SilentlyContinue) { exit 1 } else { exit 0 }"
if errorlevel 1 (
    color 4F
    echo.
    echo   [X] ERROR: Port %PORT% is already in use by another program.
    echo       Run with a different port, e.g.:   Start-MahDeploy.bat 3100
    echo.
    pause
    exit /b 1
)

if not exist "data" mkdir "data"
if not exist "logs" mkdir "logs"

color 0B
echo   [OK] Port %PORT% is free.
echo   [OK] Starting panel ...
echo.
echo   ============================================================
echo     MahDeploy  -  استقراربان  (Portable)
echo     URL      : http://localhost:%PORT%
echo     Login    : admin    Password: admin1234
echo     Stop     : close this window  or  Ctrl+C
echo   ============================================================
echo.

rem open the browser a moment after the server is up
start "" /min cmd /c "timeout /t 3 /nobreak >nul && start "" http://localhost:%PORT%"

set "MAHDEPLOY_ROOT=%~dp0"
set "NODE_ENV=production"
"runtime\node.exe" "app\mahdeploy.js"

echo.
echo   [*] MahDeploy stopped.
pause
