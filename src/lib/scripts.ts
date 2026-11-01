import type { DeployConfig, GeneratedScript } from "@/lib/types";

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

/** single-quote a value for safe embedding in PowerShell */
function pq(v: string | number): string {
  return `'${String(v).replace(/'/g, "''")}'`;
}

function cfgBlock(cfg: DeployConfig): string {
  return `$cfg = [ordered]@{
  Name         = ${pq(cfg.name)}
  DisplayName  = ${pq(cfg.displayName)}
  Domain       = ${pq(cfg.domain)}
  BackendPort  = ${cfg.backendPort}
  SourceType   = ${pq(cfg.sourceType)}
  SourcePath   = ${pq(cfg.sourcePath)}
  DeployPath   = ${pq(cfg.deployPath)}
  SslCertPath  = ${pq(cfg.sslCertPath)}
  SslKeyPath   = ${pq(cfg.sslKeyPath)}
  NginxPath    = ${pq(cfg.nginxPath)}
}`;
}

const ADMIN_CHECK = `
# ---- Administrator privilege check --------------------------------------
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host "[FAIL] This script must be run as Administrator." -ForegroundColor Red
  Write-Host "        Re-run the panel from an elevated PowerShell, or right-click -> Run as administrator."
  exit 1
}
Write-Host "[OK] Administrator privileges confirmed"
`;

const BANNER = (title: string) => `
Write-Host ""
Write-Host "==============================================================" -ForegroundColor Cyan
Write-Host "  DeployGuard :: ${title}" -ForegroundColor Cyan
Write-Host "  Target: $($cfg.DisplayName)  ($($cfg.Domain))" -ForegroundColor Gray
Write-Host "  Time  : $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Gray
Write-Host "==============================================================" -ForegroundColor Cyan
`;

function transcriptBlock(file: string): string {
  const dir = file.replace(/\\[^\\]+$/, "");
  return `
$logDir = ${pq(dir)}
if (-not (Test-Path $logDir)) { try { New-Item -ItemType Directory -Path $logDir -Force | Out-Null } catch {} }
try { Start-Transcript -Path ${pq(file)} -Append | Out-Null } catch { Write-Host "[WARN] transcript unavailable: $($_.Exception.Message)" -ForegroundColor Yellow }
`;
}

/** guarded transcript stop - never flips the exit code */
const STOP_TRANSCRIPT = `try { Stop-Transcript | Out-Null } catch {}`;

/* ------------------------------------------------------------------ */
/* Nginx configuration                                                 */
/* ------------------------------------------------------------------ */

export function generateNginxConf(cfg: DeployConfig): string {
  const be = `http://127.0.0.1:${cfg.backendPort}`;
  return `# =============================================================
# DeployGuard :: ${cfg.displayName}
# domain  : ${cfg.domain}
# backend : ${be}  (FastAPI / uvicorn)
# frontend: static build served below
# managed by DeployGuard - do not edit manually
# =============================================================
server {
    listen 80;
    server_name ${cfg.domain};
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    http2 on;
    server_name ${cfg.domain};

    ssl_certificate      ${cfg.sslCertPath};
    ssl_certificate_key  ${cfg.sslKeyPath};
    ssl_protocols        TLSv1.2 TLSv1.3;
    ssl_ciphers          ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers on;
    ssl_session_cache    shared:${cfg.name}_ssl:10m;
    ssl_session_timeout  10m;

    # ---------- security headers ----------
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options    "nosniff" always;
    add_header X-Frame-Options           "SAMEORIGIN" always;
    add_header Referrer-Policy           "strict-origin-when-cross-origin" always;

    client_max_body_size 100m;
    gzip on;
    gzip_types text/plain text/css application/json application/javascript image/svg+xml;

    # ---------- frontend (React static build) ----------
    root  ${cfg.deployPath}\\www;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~* \\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
        try_files $uri =404;
    }

    # ---------- backend (FastAPI) ----------
    location /api/ {
        proxy_pass ${be};
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        "upgrade";
        proxy_read_timeout  120s;
        proxy_send_timeout  120s;
    }

    location /docs {
        proxy_pass ${be};
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /openapi.json {
        proxy_pass ${be};
        proxy_set_header Host $host;
    }

    # ---------- health endpoint for the panel ----------
    location = /healthz {
        access_log off;
        return 200 "healthy";
    }
}
`;
}

/* ------------------------------------------------------------------ */
/* WinSW service definition                                            */
/* ------------------------------------------------------------------ */

export function generateWinSWXml(cfg: DeployConfig): string {
  return `<?xml version="1.0" encoding="UTF-8" ?>
<service>
  <id>deployguard-${cfg.name}</id>
  <name>DeployGuard - ${cfg.displayName}</name>
  <description>FastAPI backend for ${cfg.displayName} (${cfg.domain}) on port ${cfg.backendPort}. Managed by DeployGuard.</description>
  <executable>${cfg.deployPath}\\backend\\.venv\\Scripts\\python.exe</executable>
  <arguments>-m uvicorn main:app --host 127.0.0.1 --port ${cfg.backendPort} --app-dir .</arguments>
  <workingdirectory>${cfg.deployPath}\\backend</workingdirectory>
  <env name="PYTHONUNBUFFERED" value="1"/>
  <env name="APP_DOMAIN" value="${cfg.domain}"/>
  <startmode>Automatic</startmode>
  <onfailure action="restart" delay="5 sec"/>
  <onfailure action="restart" delay="10 sec"/>
  <resetfailure>1 hour</resetfailure>
  <log mode="roll-by-size">
    <logpath>${cfg.deployPath}\\logs</logpath>
    <logmode size="10485760" files="8"/>
  </log>
  <stoptimeout>15 sec</stoptimeout>
</service>
`;
}

/* ------------------------------------------------------------------ */
/* deployment scripts                                                  */
/* ------------------------------------------------------------------ */

const COMMON_PARAMS = (cfg: DeployConfig) => `
param([switch]$Silent)
$ErrorActionPreference = 'Stop'
# clean fatal-error reporting: one red [FAIL] line instead of a raw PowerShell stack
trap { Write-Host ("[FAIL] {0}" -f $_.Exception.Message) -ForegroundColor Red; ${STOP_TRANSCRIPT}; exit 1 }
# keep console output UTF-8 so the panel reads every line correctly
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch {}
${cfgBlock(cfg)}
`;

function script01(cfg: DeployConfig): string {
  return `${COMMON_PARAMS(cfg)}${BANNER("Preflight Checks")}
${ADMIN_CHECK}${transcriptBlock("C:\\ProgramData\\DeployGuard\\logs\\<name>-preflight.log")
    .replace("<name>", cfg.name)}
$failures = 0
function Check($name, $ok, $detail) {
  if ($ok) { Write-Host ("[OK]   {0}  {1}" -f $name, $detail) -ForegroundColor Green }
  else     { Write-Host ("[FAIL] {0}  {1}" -f $name, $detail) -ForegroundColor Red; $script:failures++ }
}
function Warn($name, $detail) { Write-Host ("[WARN] {0}  {1}" -f $name, $detail) -ForegroundColor Yellow }

# 1) Port must be free ----------------------------------------------------
$conn = Get-NetTCPConnection -State Listen -LocalPort $cfg.BackendPort -ErrorAction SilentlyContinue
$owner = $null
if ($conn) {
  $p = Get-Process -Id ($conn | Select-Object -First 1).OwningProcess -ErrorAction SilentlyContinue
  $owner = if ($p) { $p.ProcessName } else { "unknown" }
}
Check ("Port {0} is free" -f $cfg.BackendPort) (-not $conn) $(if ($owner) { "occupied by $owner" } else { "" })

# 2) SSL certificate files ------------------------------------------------
Check "SSL certificate file exists" (Test-Path $cfg.SslCertPath) $(if (Test-Path $cfg.SslCertPath) { $cfg.SslCertPath } else { "$($cfg.SslCertPath)  <- copy the .pem certificate here or fix the path in wizard step 1" })
Check "SSL private key file exists"  (Test-Path $cfg.SslKeyPath) $(if (Test-Path $cfg.SslKeyPath) { $cfg.SslKeyPath } else { "$($cfg.SslKeyPath)  <- copy the .pem private key here or fix the path in wizard step 1" })

# 3) Nginx ----------------------------------------------------------------
$nginxExe = Join-Path $cfg.NginxPath 'nginx.exe'
$nginxVer = ''
if (Test-Path $nginxExe) {
  # nginx -v writes to stderr; under EAP=Stop the 2>&1 redirect would turn
  # stderr lines into terminating errors, so relax EAP around native probes
  $prevEap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  $nginxVer = ((& $nginxExe -v 2>&1) | Out-String).Trim()
  $ErrorActionPreference = $prevEap
}
Check "Nginx binary" (Test-Path $nginxExe) $(if (Test-Path $nginxExe) { $nginxVer } else { "not found at $nginxExe - install Nginx or fix the path in wizard step 1" })

# 4) Runtime requirements -------------------------------------------------
$py = (Get-Command python -ErrorAction SilentlyContinue)
$pyVer = ''
if ($py) {
  $prevEap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  $pyVer = ((python --version 2>&1) | Out-String).Trim()
  $ErrorActionPreference = $prevEap
}
Check "Python available" ($null -ne $py) $(if ($py) { $pyVer } else { "not found in PATH" })
$node = (Get-Command node -ErrorAction SilentlyContinue)
$nodeVer = ''
if ($node) {
  $prevEap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  $nodeVer = ((node --version 2>&1) | Out-String).Trim()
  $ErrorActionPreference = $prevEap
}
Check "Node.js available" ($null -ne $node) $(if ($node) { $nodeVer } else { "not found in PATH" })

# 5) Domain DNS resolves to this server -----------------------------------
$localIPs = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty IPAddress)
$resolved = $null
try { $resolved = [System.Net.Dns]::GetHostAddresses($cfg.Domain) | Where-Object AddressFamily -eq 'InterNetwork' | Select-Object -ExpandProperty IPAddressToString } catch {}
$dnsOk = ($null -ne $resolved -and $resolved.Count -gt 0)
Check "Domain DNS resolves" $dnsOk $(if ($dnsOk) { $resolved -join ', ' } else { "no A record found" })
if ($dnsOk) {
  $match = @($resolved | Where-Object { $localIPs -contains $_ })
  if (-not $match) { Warn "DNS points to this server" ("resolved: {0} | local: {1}" -f ($resolved -join ','), ($localIPs -join ',')) }
}

# 6) Source code ----------------------------------------------------------
if ($cfg.SourceType -eq 'path') {
  Check "Source path exists" (Test-Path $cfg.SourcePath) $cfg.SourcePath
  $fe = Join-Path $cfg.SourcePath 'frontend'
  $be = Join-Path $cfg.SourcePath 'backend'
  Warn "frontend folder detected" (Test-Path $fe)
  Warn "backend  folder detected" (Test-Path $be)
} else {
  Check "Source ZIP exists" (Test-Path $cfg.SourcePath) $cfg.SourcePath
}

# 7) Destination ----------------------------------------------------------
$driveRoot = [System.IO.Path]::GetPathRoot($cfg.DeployPath)
$deployParent = Split-Path $cfg.DeployPath -Parent
if ((Test-Path $driveRoot) -and -not (Test-Path $deployParent)) {
  try {
    New-Item -ItemType Directory -Path $deployParent -Force | Out-Null
    Write-Host ("[OK]   destination parent created: {0}" -f $deployParent)
  } catch { Write-Host ("[WARN] could not create {0}: {1}" -f $deployParent, $_.Exception.Message) -ForegroundColor Yellow }
}
Check "Destination drive ready" ((Test-Path $driveRoot) -and (Test-Path $deployParent)) $(if (-not (Test-Path $driveRoot)) { "drive $driveRoot not found" } else { $deployParent })

Write-Host ""
if ($failures -gt 0) {
  Write-Host "[RESULT] Preflight FAILED with $failures error(s). Deployment aborted." -ForegroundColor Red
  Write-Host "         Fix the [FAIL] items above, then press the Retry button in the panel - no need to rebuild the plan."
  ${STOP_TRANSCRIPT}
  exit 1
}
Write-Host "[RESULT] Preflight passed. Ready to deploy." -ForegroundColor Green
${STOP_TRANSCRIPT}
`;
}

function script02(cfg: DeployConfig): string {
  return `${COMMON_PARAMS(cfg)}${BANNER("Prepare Folders & Source")}
${ADMIN_CHECK}${transcriptBlock(`C:\\ProgramData\\DeployGuard\\logs\\${cfg.name}-prepare.log`)}
$dirs = @(
  $cfg.DeployPath,
  (Join-Path $cfg.DeployPath 'backend'),
  (Join-Path $cfg.DeployPath 'frontend'),
  (Join-Path $cfg.DeployPath 'www'),
  (Join-Path $cfg.DeployPath 'logs'),
  (Join-Path $cfg.DeployPath 'service'),
  (Join-Path $cfg.DeployPath 'nginx'),
  (Join-Path $cfg.DeployPath 'scripts'),
  'C:\\ProgramData\\DeployGuard\\tools'
)
foreach ($d in $dirs) {
  if (-not (Test-Path $d)) {
    try { New-Item -ItemType Directory -Path $d -Force | Out-Null }
    catch { throw ("could not create folder {0}: {1}" -f $d, $_.Exception.Message) }
  }
  Write-Host ("[OK]   dir ready: {0}" -f $d)
}

if ($cfg.SourceType -eq 'path') {
  $src = $cfg.SourcePath
  $srcBackend  = Join-Path $src 'backend'
  $srcFrontend = Join-Path $src 'frontend'
  if (Test-Path $srcBackend) {
    robocopy $srcBackend (Join-Path $cfg.DeployPath 'backend') /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy backend failed with code $LASTEXITCODE" }
    Write-Host "[OK]   backend source copied (robocopy /MIR)"
  } else { throw "backend folder not found under $src" }
  if (Test-Path $srcFrontend) {
    robocopy $srcFrontend (Join-Path $cfg.DeployPath 'frontend') /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy frontend failed with code $LASTEXITCODE" }
    Write-Host "[OK]   frontend source copied (robocopy /MIR)"
  } else { Write-Host "[WARN] no frontend folder - static site will be empty until first build" }
} else {
  if (-not (Test-Path $cfg.SourcePath)) { throw "source ZIP not found: $($cfg.SourcePath) (the panel temp upload may have been cleaned - upload the ZIP again)" }

  # clean up staging dirs left over from earlier runs (> 6h old)
  Get-ChildItem $env:TEMP -Filter 'deployguard_*' -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.CreationTime -lt (Get-Date).AddHours(-6) } |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

  $stage = Join-Path $env:TEMP ("deployguard_{0}_{1}" -f $cfg.Name, (Get-Date -Format 'yyyyMMddHHmmss'))
  New-Item -ItemType Directory -Path $stage -Force | Out-Null

  # validate the archive up front for a clear error message
  Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue
  $zipEntries = 0
  try {
    $zip = [System.IO.Compression.ZipFile]::OpenRead($cfg.SourcePath)
    $zipEntries = $zip.Entries.Count
    $zip.Dispose()
  } catch { $zipEntries = 0 }
  if ($zipEntries -le 0) { throw "the uploaded file is not a readable ZIP archive: $($cfg.SourcePath) - re-upload the ZIP (the previous upload may have been truncated)" }

  # prefer tar.exe (fast + no MAX_PATH limit on Windows 10 1803+ / Server 2019+)
  $tarExe = Get-Command tar.exe -ErrorAction SilentlyContinue
  if ($tarExe) {
    $prevEap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    & tar.exe -xf $cfg.SourcePath -C $stage 2>&1 | Out-Null
    $tarExit = $LASTEXITCODE
    $ErrorActionPreference = $prevEap
    if ($tarExit -ne 0) { throw "tar.exe failed to extract the archive (exit $tarExit) - the ZIP may be corrupt; re-upload it" }
    Write-Host ("[OK]   archive extracted ({0} entries, tar.exe)" -f $zipEntries)
  } else {
    try { Expand-Archive -Path $cfg.SourcePath -DestinationPath $stage -Force }
    catch { throw "extracting the ZIP failed: $($_.Exception.Message)" }
    Write-Host ("[OK]   archive extracted ({0} entries)" -f $zipEntries)
  }

  # locate the project root (handles wrapper folders at any depth)
  $rootDir = $stage
  for ($i = 0; $i -lt 5; $i++) {
    if ((Test-Path (Join-Path $rootDir 'backend')) -or (Test-Path (Join-Path $rootDir 'frontend'))) { break }
    $subDirs = @(Get-ChildItem $rootDir -Directory -ErrorAction SilentlyContinue)
    $subFiles = @(Get-ChildItem $rootDir -File -ErrorAction SilentlyContinue)
    if ($subDirs.Count -eq 1 -and $subFiles.Count -eq 0) { $rootDir = $subDirs[0].FullName } else { break }
  }
  $srcBackend  = Join-Path $rootDir 'backend'
  $srcFrontend = Join-Path $rootDir 'frontend'
  if (-not (Test-Path $srcBackend) -and -not (Test-Path $srcFrontend)) { throw "archive has no 'backend' or 'frontend' folder (looked in $rootDir) - expected FastAPI backend + React frontend structure" }
  if (Test-Path $srcBackend)  { robocopy $srcBackend  (Join-Path $cfg.DeployPath 'backend')  /MIR /NFL /NDL /NJH /NJS /NP | Out-Null; if ($LASTEXITCODE -ge 8) { throw "robocopy backend failed with code $LASTEXITCODE" }; Write-Host "[OK]   backend copied from archive" }
  if (Test-Path $srcFrontend) { robocopy $srcFrontend (Join-Path $cfg.DeployPath 'frontend') /MIR /NFL /NDL /NJH /NJS /NP | Out-Null; if ($LASTEXITCODE -ge 8) { throw "robocopy frontend failed with code $LASTEXITCODE" }; Write-Host "[OK]   frontend copied from archive" }
  Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
}

# .env for the backend ----------------------------------------------------
$envFile = Join-Path $cfg.DeployPath 'backend\\.env'
$envContent = @"
APP_NAME=${cfg.displayName}
APP_DOMAIN=${cfg.domain}
PORT=${cfg.backendPort}
ENV=production
GENERATED_AT=$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
"@
[System.IO.File]::WriteAllText($envFile, $envContent, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "[OK]   backend\\.env written (UTF-8, no BOM)"

Write-Host "[RESULT] Preparation completed." -ForegroundColor Green
${STOP_TRANSCRIPT}
`;
}

function script03(cfg: DeployConfig): string {
  return `${COMMON_PARAMS(cfg)}${BANNER("Backend :: venv + WinSW Service")}
${ADMIN_CHECK}${transcriptBlock(`C:\\ProgramData\\DeployGuard\\logs\\${cfg.name}-backend.log`)}
$backendDir = Join-Path $cfg.DeployPath 'backend'
Push-Location $backendDir

# 1) virtual environment --------------------------------------------------
if (-not (Get-Command python -ErrorAction SilentlyContinue)) { throw "python not found in PATH - install Python 3.11+ (64-bit), re-open the panel and re-run" }
if (-not (Test-Path (Join-Path $backendDir '.venv'))) {
  python -m venv .venv
  if ($LASTEXITCODE -ne 0) { throw "python -m venv failed" }
}
Write-Host "[OK]   virtual environment ready"

# 2) dependencies ---------------------------------------------------------
$venvPython = Join-Path $backendDir '.venv\\Scripts\\python.exe'
if (Test-Path (Join-Path $backendDir 'requirements.txt')) {
  & $venvPython -m pip install --upgrade pip --quiet
  & $venvPython -m pip install -r requirements.txt --quiet
  if ($LASTEXITCODE -ne 0) { throw "pip install failed" }
  Write-Host "[OK]   requirements.txt installed"
} else {
  Write-Host "[WARN] requirements.txt not found - installing uvicorn only"
  & $venvPython -m pip install uvicorn --quiet
}

# 3) WinSW service wrapper ------------------------------------------------
$tools  = 'C:\\ProgramData\\DeployGuard\\tools'
$winsw  = Join-Path $tools 'WinSW-x64.exe'
if (-not (Test-Path $winsw)) {
  Write-Host "[..]   downloading WinSW v2.12.0"
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  try { Invoke-WebRequest -Uri 'https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe' -OutFile $winsw -UseBasicParsing -TimeoutSec 120 }
  catch { throw "WinSW download failed: $($_.Exception.Message) - check server internet access, or place WinSW-x64.exe manually in $tools" }
}
$serviceExe = Join-Path $cfg.DeployPath ('service\\{0}-service.exe' -f $cfg.Name)
Copy-Item $winsw $serviceExe -Force
Write-Host "[OK]   WinSW binary staged"

$xmlContent = @'
${generateWinSWXml(cfg)}
'@
$xmlPath = Join-Path $cfg.DeployPath ('service\\{0}-service.xml' -f $cfg.Name)
Set-Content -Path $xmlPath -Value $xmlContent -Encoding UTF8
Write-Host "[OK]   service definition written"

# 4) install + start ------------------------------------------------------
$serviceName = "deployguard-$($cfg.Name)"
$existing = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($existing) {
  if ($existing.Status -eq 'Running') { Stop-Service $serviceName -Force; Start-Sleep 2 }
  & $serviceExe uninstall | Out-Null
  Start-Sleep 1
}
& $serviceExe install
if ($LASTEXITCODE -ne 0) { throw "service install failed (WinSW exit code $LASTEXITCODE)" }
try { Start-Service $serviceName }
catch { throw "service start failed: $($_.Exception.Message) - check wrapper logs in $(Join-Path $cfg.DeployPath 'logs')" }
Write-Host ("[OK]   service '{0}' started" -f $serviceName)

# 5) wait until port responds --------------------------------------------
$deadline = (Get-Date).AddSeconds(90)
$up = $false
while ((Get-Date) -lt $deadline) {
  $t = Test-NetConnection -ComputerName 127.0.0.1 -Port $cfg.BackendPort -WarningAction SilentlyContinue
  if ($t.TcpTestSucceeded) { $up = $true; break }
  Start-Sleep 2
}
if (-not $up) { throw ("backend did not listen on port {0} within 90s" -f $cfg.BackendPort) }
Write-Host ("[OK]   backend listening on 127.0.0.1:{0}" -f $cfg.BackendPort)

Pop-Location
Write-Host "[RESULT] Backend deployment completed." -ForegroundColor Green
${STOP_TRANSCRIPT}
`;
}

function script04(cfg: DeployConfig): string {
  return `${COMMON_PARAMS(cfg)}${BANNER("Frontend :: Build & Publish")}
${ADMIN_CHECK}${transcriptBlock(`C:\\ProgramData\\DeployGuard\\logs\\${cfg.name}-frontend.log`)}
$frontendDir = Join-Path $cfg.DeployPath 'frontend'
if (-not (Test-Path (Join-Path $frontendDir 'package.json'))) {
  Write-Host "[WARN] no package.json in frontend - skipping build (static site stays as-is)"
  ${STOP_TRANSCRIPT}
  exit 0
}
Push-Location $frontendDir

if (Test-Path (Join-Path $frontendDir 'package-lock.json')) {
  npm ci --no-audit --no-fund
} else {
  npm install --no-audit --no-fund
}
if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
Write-Host "[OK]   npm dependencies installed"

npm run build
if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }
Write-Host "[OK]   production build created"

$dist = @('dist','build') | ForEach-Object { Join-Path $frontendDir $_ } | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $dist) { throw "build output (dist/ or build/) not found" }

$www = Join-Path $cfg.DeployPath 'www'
if (Test-Path $www) { Remove-Item "$www\\*" -Recurse -Force -ErrorAction SilentlyContinue }
robocopy $dist $www /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "copy to www failed with code $LASTEXITCODE" }
Write-Host "[OK]   build published to www"

Pop-Location
Write-Host "[RESULT] Frontend deployment completed." -ForegroundColor Green
${STOP_TRANSCRIPT}
`;
}

function script05(cfg: DeployConfig): string {
  const conf = generateNginxConf(cfg)
    .split("\n")
    .map((l) => l.replace(/\r$/, ""))
    .join("\n");
  return `${COMMON_PARAMS(cfg)}${BANNER("Nginx :: Site Configuration & Reload")}
${ADMIN_CHECK}${transcriptBlock(`C:\\ProgramData\\DeployGuard\\logs\\${cfg.name}-nginx.log`)}
$nginxExe  = Join-Path $cfg.NginxPath 'nginx.exe'
if (-not (Test-Path $nginxExe)) { throw "nginx.exe not found at $nginxExe" }

$confDir   = Join-Path $cfg.NginxPath 'conf\\conf.d'
if (-not (Test-Path $confDir)) { New-Item -ItemType Directory -Path $confDir -Force | Out-Null }

# ensure 'include conf.d/*.conf;' inside http{} of nginx.conf --------------
$mainConf  = Join-Path $cfg.NginxPath 'conf\\nginx.conf'
if (-not (Test-Path $mainConf)) { throw "nginx.conf not found at $mainConf - check the Nginx path in wizard step 1" }
$backup    = "$mainConf.bak_deployguard"
$content   = Get-Content $mainConf -Raw
$includeLine = 'include conf.d/*.conf;'
if ($content -notmatch [regex]::Escape($includeLine)) {
  Copy-Item $mainConf $backup -Force
  $replacement = '$1' + [Environment]::NewLine + '    ' + $includeLine
  $patched = $content -replace '(?m)^(\s*http\s*\{)', $replacement
  Set-Content -Path $mainConf -Value $patched -Encoding ASCII
  Write-Host "[OK]   'include conf.d/*.conf;' added to nginx.conf (backup saved)"
} else {
  Write-Host "[OK]   conf.d include already present"
}

# write the site configuration ---------------------------------------------
$confContent = @'
${conf}
'@
$confPath = Join-Path $confDir ('{0}.conf' -f $cfg.Name)
Set-Content -Path $confPath -Value $confContent -Encoding ASCII
Write-Host "[OK]   site config written: $confPath"

# firewall ----------------------------------------------------------------
foreach ($port in 80,443) {
  $rule = Get-NetFirewallRule -DisplayName "DeployGuard HTTP $port" -ErrorAction SilentlyContinue
  if (-not $rule) {
    New-NetFirewallRule -DisplayName "DeployGuard HTTP $port" -Direction Inbound -Protocol TCP -LocalPort $port -Action Allow | Out-Null
    Write-Host "[OK]   firewall rule added for TCP $port"
  }
}

# test & reload -----------------------------------------------------------
# nginx -t prints to stderr; same EAP=Stop + 2>&1 trap as preflight
$prevEap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
$testOut = ((& $nginxExe -t 2>&1) | Out-String).Trim()
$testExit = $LASTEXITCODE
$ErrorActionPreference = $prevEap
Write-Host $testOut
if ($testExit -ne 0) { throw "nginx -t failed (exit $testExit) - configuration rejected (backup at $backup)" }
Write-Host "[OK]   nginx configuration test passed"

$running = Get-Process nginx -ErrorAction SilentlyContinue
if ($running) {
  & $nginxExe -s reload
  if ($LASTEXITCODE -ne 0) { throw "nginx reload failed (exit $LASTEXITCODE)" }
  Write-Host "[OK]   nginx reloaded"
} else {
  Start-Process -FilePath $nginxExe -WorkingDirectory $cfg.NginxPath -WindowStyle Hidden
  Start-Sleep 2
  Write-Host "[OK]   nginx started"
}

Write-Host "[RESULT] Nginx site is live at https://$($cfg.Domain)" -ForegroundColor Green
${STOP_TRANSCRIPT}
`;
}

function script06(cfg: DeployConfig): string {
  return `${COMMON_PARAMS(cfg)}${BANNER("Verify :: End-to-End Checks")}
${ADMIN_CHECK}
$serviceName = "deployguard-$($cfg.Name)"
$checks = 0

# service -----------------------------------------------------------------
$svc = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -eq 'Running') { Write-Host "[OK]   service $serviceName is Running" -ForegroundColor Green }
else { $st = if ($svc) { $svc.Status } else { 'missing' }; Write-Host ("[FAIL] service $serviceName is $st") -ForegroundColor Red; $checks++ }

# local port --------------------------------------------------------------
$t = Test-NetConnection -ComputerName 127.0.0.1 -Port $cfg.BackendPort -WarningAction SilentlyContinue
if ($t.TcpTestSucceeded) { Write-Host "[OK]   127.0.0.1:$($cfg.BackendPort) responds" -ForegroundColor Green }
else { Write-Host "[FAIL] 127.0.0.1:$($cfg.BackendPort) refused" -ForegroundColor Red; $checks++ }

# backend API probe -------------------------------------------------------
try {
  $r = Invoke-WebRequest -Uri ("http://127.0.0.1:{0}/docs" -f $cfg.BackendPort) -UseBasicParsing -TimeoutSec 10
  Write-Host ("[OK]   FastAPI /docs HTTP {0}" -f $r.StatusCode) -ForegroundColor Green
} catch {
  try {
    $r = Invoke-WebRequest -Uri ("http://127.0.0.1:{0}/" -f $cfg.BackendPort) -UseBasicParsing -TimeoutSec 10
    Write-Host ("[OK]   backend root HTTP {0}" -f $r.StatusCode) -ForegroundColor Green
  } catch { Write-Host "[WARN] backend HTTP probe failed (app may still boot)" -ForegroundColor Yellow }
}

# https via nginx ---------------------------------------------------------
try {
  $r = & curl.exe -k -s -o NUL -w "%{http_code}" ("https://{0}/" -f $cfg.Domain)
  if ($r -eq '200' -or $r -eq '301' -or $r -eq '302') { Write-Host "[OK]   https://$($cfg.Domain) -> HTTP $r" -ForegroundColor Green }
  else { Write-Host "[WARN] https probe returned HTTP $r" -ForegroundColor Yellow }
} catch { Write-Host "[WARN] https probe failed (DNS may not point here yet)" -ForegroundColor Yellow }

Write-Host ""
Write-Host "==============================================================" -ForegroundColor Cyan
Write-Host "  Deployment summary" -ForegroundColor White
Write-Host "--------------------------------------------------------------"
Write-Host ("  Site      : https://{0}" -f $cfg.Domain)
Write-Host ("  API       : https://{0}/api  (uvicorn 127.0.0.1:{1})" -f $cfg.Domain, $cfg.BackendPort)
Write-Host ("  Service   : {0}" -f $serviceName)
Write-Host ("  Folder    : {0}" -f $cfg.DeployPath)
Write-Host ("  Nginx conf: {0}\\conf\\conf.d\\{1}.conf" -f $cfg.NginxPath, $cfg.Name)
Write-Host "==============================================================" -ForegroundColor Cyan
if ($checks -gt 0) { exit 1 }
`;
}

export function generateDeployScripts(cfg: DeployConfig): GeneratedScript[] {
  return [
    {
      id: "preflight",
      fileName: "01-Preflight.ps1",
      title: "بررسی‌های پیش از استقرار",
      description: "کنترل دسترسی Administrator، آزاد بودن پورت، وجود گواهی SSL، نصب Nginx/Python/Node و تطابق DNS دامنه",
      content: script01(cfg),
    },
    {
      id: "prepare",
      fileName: "02-Prepare.ps1",
      title: "آماده‌سازی پوشه‌ها و منبع کد",
      description: "ساخت ساختار پوشه استاندارد، کپی کد از مسیر یا استخراج ZIP و تولید فایل .env",
      content: script02(cfg),
    },
    {
      id: "backend",
      fileName: "03-Backend.ps1",
      title: "استقرار بک‌اند FastAPI",
      description: "ساخت venv، نصب وابستگی‌ها، ثبت سرویس ویندوز با WinSW و راه‌اندازی uvicorn روی پورت اختصاصی",
      content: script03(cfg),
    },
    {
      id: "frontend",
      fileName: "04-Frontend.ps1",
      title: "ساخت و انتشار فرانت‌اند React",
      description: "نصب وابستگی‌های npm، اجرای production build و انتشار خروجی در پوشه www",
      content: script04(cfg),
    },
    {
      id: "nginx",
      fileName: "05-Nginx.ps1",
      title: "پیکربندی Nginx و HTTPS",
      description: "نوشتن کانفیگ سایت با گواهی SSL، تست nginx -t، ریلود و باز کردن پورت‌های 80/443 در فایروال",
      content: script05(cfg),
    },
    {
      id: "verify",
      fileName: "06-Verify.ps1",
      title: "اعتبارسنجی نهایی",
      description: "کنترل وضعیت سرویس، پاسخ‌گویی پورت، پروب HTTP بک‌اند و آزمایش https روی دامنه",
      content: script06(cfg),
    },
  ];
}

export const DEPLOY_STEPS = [
  { id: "preflight", scriptId: "preflight", title: "بررسی‌های پیش‌نیاز" },
  { id: "prepare", scriptId: "prepare", title: "آماده‌سازی پوشه‌ها و کد" },
  { id: "backend", scriptId: "backend", title: "استقرار بک‌اند FastAPI" },
  { id: "frontend", scriptId: "frontend", title: "ساخت فرانت‌اند React" },
  { id: "nginx", scriptId: "nginx", title: "پیکربندی Nginx و SSL" },
  { id: "verify", scriptId: "verify", title: "اعتبارسنجی نهایی" },
];

/* ------------------------------------------------------------------ */
/* management scripts (stop / start / restart / remove)                */
/* ------------------------------------------------------------------ */

export function generateServiceActionScript(cfg: DeployConfig, action: "start" | "stop" | "restart"): string {
  return `# DeployGuard :: ${action} service for ${cfg.displayName}
$ErrorActionPreference = 'Stop'
$serviceName = "deployguard-${cfg.name}"
$svc = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if (-not $svc) { Write-Host "[FAIL] service $serviceName not found"; exit 1 }
try {
  switch ("${action}") {
    'start'   { Start-Service $serviceName }
    'stop'    { Stop-Service $serviceName -Force }
    'restart' { Restart-Service $serviceName -Force }
  }
} catch {
  Write-Host "[FAIL] $($_.Exception.Message)"
  exit 1
}
Write-Host "[OK]  $serviceName -> $((Get-Service $serviceName).Status)"
`;
}

export function generateUninstallScript(cfg: DeployConfig): string {
  return `# DeployGuard :: full removal of ${cfg.displayName} (${cfg.domain})
$ErrorActionPreference = 'Continue'
${cfgBlock(cfg)}
${ADMIN_CHECK}
$serviceName = "deployguard-$($cfg.Name)"

# 1) stop & uninstall the Windows service
$svc = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($svc) {
  if ($svc.Status -ne 'Stopped') { Stop-Service $serviceName -Force -ErrorAction SilentlyContinue; Start-Sleep 2 }
  $exe = Join-Path $cfg.DeployPath ('service\\{0}-service.exe' -f $cfg.Name)
  if (Test-Path $exe) { & $exe uninstall | Out-Null }
  Write-Host "[OK]   service $serviceName removed"
}

# 2) remove nginx site + reload
$confPath = Join-Path $cfg.NginxPath ('conf\\conf.d\\{0}.conf' -f $cfg.Name)
if (Test-Path $confPath) {
  Move-Item $confPath "$confPath.removed_$(Get-Date -Format yyyyMMddHHmmss)" -Force
  & (Join-Path $cfg.NginxPath 'nginx.exe') -t 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) { & (Join-Path $cfg.NginxPath 'nginx.exe') -s reload; Write-Host "[OK]   nginx site removed & reloaded" }
}

# 3) archive logs then delete the app folder
$backup = "C:\\ProgramData\\DeployGuard\\backups\\$($cfg.Name)_$(Get-Date -Format yyyyMMddHHmmss)"
if (Test-Path (Join-Path $cfg.DeployPath 'logs')) {
  New-Item -ItemType Directory -Path $backup -Force | Out-Null
  Copy-Item (Join-Path $cfg.DeployPath 'logs\\*') $backup -Recurse -Force -ErrorAction SilentlyContinue
}
if (Test-Path $cfg.DeployPath) {
  Remove-Item $cfg.DeployPath -Recurse -Force
  Write-Host "[OK]   folder removed: $($cfg.DeployPath) (logs archived to $backup)"
}
Write-Host "[RESULT] $($cfg.DisplayName) fully removed." -ForegroundColor Green
`;
}
