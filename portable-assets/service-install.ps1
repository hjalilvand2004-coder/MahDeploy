# =====================================================================
#  MahDeploy — install & start the panel as a Windows Service
#  Run from an elevated (Administrator) PowerShell:
#      powershell -ExecutionPolicy Bypass -File .\service-install.ps1
# =====================================================================
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$svcName = "MahDeployPanel"

if (-not ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
        ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "[X] Please run this script as Administrator." -ForegroundColor Red
    exit 1
}

Write-Host "[*] Installing MahDeploy Panel service ..." -ForegroundColor Cyan

Copy-Item (Join-Path $root "runtime\WinSW-x64.exe") (Join-Path $root "MahDeployService.exe") -Force
Copy-Item (Join-Path $root "service.xml")           (Join-Path $root "MahDeployService.xml") -Force

& (Join-Path $root "MahDeployService.exe") install
& (Join-Path $root "MahDeployService.exe") start

Start-Sleep -Seconds 2
$svc = Get-Service -Name $svcName -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -eq "Running") {
    Write-Host "[OK] Service '$svcName' is RUNNING — panel: http://localhost:3000" -ForegroundColor Green
} else {
    Write-Host "[!] Service registered — check logs\ folder for details." -ForegroundColor Yellow
}
