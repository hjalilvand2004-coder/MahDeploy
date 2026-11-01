# =====================================================================
#  MahDeploy — stop, uninstall and clean the panel Windows Service
#  Run from an elevated (Administrator) PowerShell:
#      powershell -ExecutionPolicy Bypass -File .\service-uninstall.ps1
# =====================================================================
$ErrorActionPreference = "SilentlyContinue"
$root = $PSScriptRoot

if (-not ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
        ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "[X] Please run this script as Administrator." -ForegroundColor Red
    exit 1
}

Write-Host "[*] Uninstalling MahDeploy Panel service ..." -ForegroundColor Cyan
& (Join-Path $root "MahDeployService.exe") stop
& (Join-Path $root "MahDeployService.exe") uninstall

Start-Sleep -Seconds 2
Remove-Item (Join-Path $root "MahDeployService.exe") -Force
Remove-Item (Join-Path $root "MahDeployService.xml") -Force

Write-Host "[OK] Service removed. (portable files untouched)" -ForegroundColor Green
