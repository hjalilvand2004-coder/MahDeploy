@echo off
chcp 65001 >nul
title MahDeploy — Stop Panel
setlocal EnableExtensions

rem ------------------------------------------------------------
rem  Stops the MahDeploy panel listening on the given port.
rem  Optional port argument:  Stop-MahDeploy.bat 3100
rem ------------------------------------------------------------

set "PORT=3000"
if not "%~1"=="" set "PORT=%~1"

echo.
echo   [*] Looking for MahDeploy on port %PORT% ...
powershell -NoProfile -Command "$c = Get-NetTCPConnection -State Listen -LocalPort %PORT% -ErrorAction SilentlyContinue | Select-Object -First 1; if ($c) { $p = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue; Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue; Write-Host ('   [OK] Stopped: ' + $p.ProcessName + ' (PID ' + $c.OwningProcess + ')') } else { Write-Host '   [INFO] Nothing is listening on this port.' }"
echo.
pause
