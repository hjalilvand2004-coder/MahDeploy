# =====================================================================
#  MahDeploy — Portable Windows package builder
#  -----------------------------------------------------------------
#  Builds the zero-install portable package (MahDeploy-Portable-...zip)
#  on a Windows machine that has Node.js 20+ and internet access.
#
#  Usage (PowerShell, project root):
#      powershell -ExecutionPolicy Bypass -File .\build-portable.ps1
#
#  Output: dist\MahDeploy-Portable-Windows-x64-v<version>.zip
# =====================================================================
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$ver  = (Get-Content "$root\package.json" | ConvertFrom-Json).version
$dist = Join-Path $root "dist"
$pkg  = Join-Path $dist "MahDeploy"
$nodeVer = "v22.14.0"

Write-Host "[1/7] Installing dependencies ..." -ForegroundColor Cyan
Push-Location $root
if (Get-Command bun -ErrorAction SilentlyContinue) { bun install }
else { npm install }

Write-Host "[2/7] Generating Prisma client (native + windows engines) ..." -ForegroundColor Cyan
if (Get-Command bun -ErrorAction SilentlyContinue) { bunx prisma generate }
else { npx prisma generate }

Write-Host "[3/7] Building Next.js standalone bundle ..." -ForegroundColor Cyan
if (Get-Command bun -ErrorAction SilentlyContinue) { bunx next build }
else { npx next build }

Write-Host "[4/7] Assembling package folders ..." -ForegroundColor Cyan
Remove-Item $dist -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path "$pkg\app","$pkg\runtime","$pkg\data","$pkg\logs" | Out-Null

# standalone server + traced node_modules
Copy-Item "$root\.next\standalone\*" "$pkg\app\" -Recurse -Force
# static assets + public (not included in standalone by default)
Copy-Item "$root\.next\static"  "$pkg\app\.next\static"  -Recurse -Force
Copy-Item "$root\public"        "$pkg\app\public"        -Recurse -Force
# never ship dotenv leftovers
Remove-Item "$pkg\app\.env*" -Force -ErrorAction SilentlyContinue

# trim linux-only heavy modules (package targets Windows x64)
foreach ($p in @("node_modules\typescript","node_modules\sharp","node_modules\@img","node_modules\detect-libc")) {
    Remove-Item (Join-Path $pkg "app\$p") -Recurse -Force -ErrorAction SilentlyContinue
}

# portable launcher assets (bat / ps1 / xml / bootstrap / readme)
Copy-Item "$root\portable-assets\*" $pkg -Force
Copy-Item "$root\portable-assets\mahdeploy.js" "$pkg\app\mahdeploy.js" -Force

# pristine database (schema only — created on the build machine via prisma)
Write-Host "[5/7] Creating pristine SQLite database ..." -ForegroundColor Cyan
$env:DATABASE_URL = "file:$($pkg -replace '\\','/')/data/mahdeploy.db"
if (Get-Command bun -ErrorAction SilentlyContinue) { bunx prisma db push --skip-generate }
else { npx prisma db push --skip-generate }
Remove-Item Env:\DATABASE_URL

Write-Host "[6/7] Downloading Windows Node.js runtime ($nodeVer) ..." -ForegroundColor Cyan
$nodeExe = Join-Path $pkg "runtime\node.exe"
Invoke-WebRequest -Uri "https://nodejs.org/dist/$nodeVer/win-x64/node.exe" -OutFile $nodeExe

Write-Host "[7/7] Creating ZIP archive ..." -ForegroundColor Cyan
$zip = Join-Path $dist "MahDeploy-Portable-Windows-x64-v$ver.zip"
Compress-Archive -Path $pkg -DestinationPath $zip -CompressionLevel Optimal -Force

Pop-Location
Write-Host ""
Write-Host "[OK] Portable package ready: $zip" -ForegroundColor Green
Write-Host "     Copy the MahDeploy folder (or the zip) to any Windows x64 machine and run Start-MahDeploy.bat" -ForegroundColor Green
