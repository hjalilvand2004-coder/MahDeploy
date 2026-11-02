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
  Name            = ${pq(cfg.name)}
  DisplayName     = ${pq(cfg.displayName)}
  Domain          = ${pq(cfg.domain)}
  BackendPort     = ${cfg.backendPort}
  SourceType      = ${pq(cfg.sourceType)}
  SourcePath      = ${pq(cfg.sourcePath)}
  DeployPath      = ${pq(cfg.deployPath)}
  SslCertPath     = ${pq(cfg.sslCertPath)}
  SslKeyPath      = ${pq(cfg.sslKeyPath)}
  NginxPath       = ${pq(cfg.nginxPath)}
  UploadLimitMb   = ${cfg.uploadLimitMb}
  ProxyTimeoutSec = ${cfg.proxyTimeoutSec}
  BlockDocs       = ${cfg.blockDocs ? "$true" : "$false"}
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
$script:LogPath = ${pq(file)}
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
  const docsBlock = cfg.blockDocs
    ? `    # ---------- API docs blocked in production ----------
    location /docs          { return 403; }
    location /redoc         { return 403; }
    location /openapi.json  { return 403; }
`
    : `    # ---------- API docs (public) ----------
    location /docs {
        proxy_pass ${be};
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /openapi.json {
        proxy_pass ${be};
        proxy_set_header Host $host;
    }
`;
  return `# =============================================================
# MahDeploy :: ${cfg.displayName}
# domain  : ${cfg.domain}
# backend : ${be}  (FastAPI / uvicorn)
# frontend: static build served below
# managed by MahDeploy - do not edit manually
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

    client_max_body_size ${cfg.uploadLimitMb}m;
    gzip on;
    gzip_types text/plain text/css application/json application/javascript image/svg+xml;

    # ---------- frontend (React static build, SPA fallback) ----------
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
        # websocket / long-polling friendly
        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        $connection_upgrade;
        proxy_read_timeout  ${cfg.proxyTimeoutSec}s;
        proxy_send_timeout  ${cfg.proxyTimeoutSec}s;
        proxy_connect_timeout 30s;
        proxy_buffering off;
    }

${docsBlock}
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
$script:LogPath = $null
# clean fatal-error reporting: one red [FAIL] line instead of a raw PowerShell stack
trap {
  Write-Host ("[FAIL] {0}" -f $_.Exception.Message) -ForegroundColor Red
  Write-Host "[HINT] the full transcript log with every detail is available in the panel (step output) and in the log file shown above" -ForegroundColor Yellow
  if ($script:LogPath) { Write-Host ("[HINT] log file: {0}" -f $script:LogPath) -ForegroundColor Yellow }
  Write-Host "[HINT] fix the cause, then press the Retry button in the panel - successful steps are not repeated" -ForegroundColor Yellow
  ${STOP_TRANSCRIPT}
  exit 1
}
# keep console output UTF-8 so the panel reads every line correctly
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch {}
${cfgBlock(cfg)}
`;

/** guarded nginx.exe invocation: nginx writes to stderr, so relax EAP around it */
const NGINX_PROBE = `
function Invoke-Nginx([string[]]$nginxArgs) {
  $prevEap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  $out = ((& $nginxExe @nginxArgs 2>&1) | Out-String).Trim()
  $code = $LASTEXITCODE
  $ErrorActionPreference = $prevEap
  return [pscustomobject]@{ Output = $out; Exit = $code }
}
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
${NGINX_PROBE}
$nginxExe  = Join-Path $cfg.NginxPath 'nginx.exe'
if (-not (Test-Path $nginxExe)) { throw "nginx.exe not found at $nginxExe - install Nginx or fix the path in wizard step 1" }

$confDir   = Join-Path $cfg.NginxPath 'conf\\conf.d'
$backupDir = Join-Path $cfg.DeployPath 'nginx-backups'
if (-not (Test-Path $confDir))   { New-Item -ItemType Directory -Path $confDir   -Force | Out-Null }
if (-not (Test-Path $backupDir)) { New-Item -ItemType Directory -Path $backupDir -Force | Out-Null }

# ---- cross-deployment lock: two deployments must never rewrite shared nginx state at once ----
$lockFile = 'C:\\ProgramData\\DeployGuard\\nginx.lock'
New-Item -ItemType Directory -Path (Split-Path $lockFile) -Force | Out-Null
# a lock left over from a crashed run expires after 10 minutes
if ((Test-Path $lockFile) -and ((Get-Item $lockFile -ErrorAction SilentlyContinue).LastWriteTime -lt (Get-Date).AddMinutes(-10))) {
  Remove-Item $lockFile -Force -ErrorAction SilentlyContinue
  Write-Host "[WARN] stale nginx lock (older than 10 min) removed" -ForegroundColor Yellow
}
$lockDeadline = (Get-Date).AddSeconds(60)
while ((Test-Path $lockFile) -and (Get-Date) -lt $lockDeadline) {
  Write-Host "[..]   another deployment is changing the shared Nginx config - waiting for the lock" -ForegroundColor Yellow
  Start-Sleep 3
}
if (Test-Path $lockFile) { throw "the shared Nginx config is locked by another deployment (lock file $lockFile) - wait a minute and retry" }
New-Item -ItemType File -Path $lockFile -Force | Out-Null
Write-Host "[OK]   nginx config lock acquired"

# ensure 'include conf.d/*.conf;' + websocket map inside http{} of nginx.conf ------
$mainConf  = Join-Path $cfg.NginxPath 'conf\\nginx.conf'
if (-not (Test-Path $mainConf)) { throw "nginx.conf not found at $mainConf - check the Nginx path in wizard step 1" }
$content   = Get-Content $mainConf -Raw
$includeLine   = 'include conf.d/*.conf;'
$mapLine       = 'map $http_upgrade $connection_upgrade'
$needPatch     = $false
$patchLines    = @()
if ($content -notmatch [regex]::Escape($includeLine)) { $needPatch = $true; $patchLines += '    ' + $includeLine }
if ($content -notmatch [regex]::Escape($mapLine)) {
  $needPatch = $true
  $patchLines += '    map $http_upgrade $connection_upgrade {', "        default upgrade;", "        ''      close;", '    }'
}
if ($needPatch) {
  Copy-Item $mainConf "$mainConf.bak_deployguard" -Force
  $insert = ($patchLines -join [Environment]::NewLine)
  $patched = $content -replace '(?m)^(\s*http\s*\{)', ('$1' + [Environment]::NewLine + $insert)
  Set-Content -Path $mainConf -Value $patched -Encoding ASCII
  Write-Host "[OK]   conf.d include + websocket map added to nginx.conf (backup saved)"
} else {
  Write-Host "[OK]   nginx.conf already includes conf.d and the websocket map"
}

# ---- SSL certificate validation (expiry, domain, key match, chain) ---------------
if (-not (Test-Path $cfg.SslCertPath)) { throw "SSL certificate not found: $($cfg.SslCertPath) - copy the .pem certificate or fix the path in wizard step 1" }
if (-not (Test-Path $cfg.SslKeyPath))  { throw "SSL private key not found: $($cfg.SslKeyPath) - copy the .key file or fix the path in wizard step 1" }
try {
  $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 $cfg.SslCertPath
} catch { throw "SSL certificate could not be read: $($_.Exception.Message) - the file may be corrupt or in an unsupported format" }
$daysLeft = ($cert.NotAfter - (Get-Date)).Days
if ($daysLeft -lt 0) { throw ("SSL certificate EXPIRED on {0} - renew the certificate, update wizard step 1, then retry" -f $cert.NotAfter.ToString('yyyy-MM-dd')) }
if ($daysLeft -le 14) {
  Write-Host ("[WARN] SSL certificate expires in {0} days ({1}) - renew it soon to avoid an outage" -f $daysLeft, $cert.NotAfter.ToString('yyyy-MM-dd')) -ForegroundColor Yellow
} else {
  Write-Host ("[OK]   SSL certificate valid until {0} ({1} days left)" -f $cert.NotAfter.ToString('yyyy-MM-dd'), $daysLeft)
}
$cn = ''
if ($cert.Subject -match 'CN\s*=\s*([^,]+)') { $cn = $Matches[1].Trim() }
$sanExt = ($cert.Extensions | Where-Object { $_.Oid.FriendlyName -eq 'Subject Alternative Name' } | Select-Object -First 1)
$san = if ($sanExt) { ($sanExt.Format($false) -replace '^[^=]+=', '') } else { '' }
if ($cn -ne $cfg.Domain -and ($san -notmatch [regex]::Escape($cfg.Domain))) {
  Write-Host ("[WARN] certificate subject '{0}' may not cover domain '{1}' (SAN: {2}) - browsers may warn" -f $cn, $cfg.Domain, ($(if ($san) { $san } else { 'none' }))) -ForegroundColor Yellow
} else {
  Write-Host "[OK]   certificate matches the domain"
}
$rawPem = Get-Content $cfg.SslCertPath -Raw
$certCount = ([regex]::Matches($rawPem, '-----BEGIN CERTIFICATE-----')).Count
if ($certCount -le 1) { Write-Host "[WARN] certificate file contains a single certificate - the intermediate chain may be missing (browsers ok, some clients fail)" -ForegroundColor Yellow }
$openssl = Get-Command openssl.exe -ErrorAction SilentlyContinue
if ($openssl) {
  $prevEap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  $cMod = ((& openssl x509 -noout -modulus -in $cfg.SslCertPath 2>$null) | Out-String).Trim()
  $kMod = ((& openssl rsa  -noout -modulus -in $cfg.SslKeyPath  2>$null) | Out-String).Trim()
  $ErrorActionPreference = $prevEap
  if ($cMod -and $kMod) {
    if ($cMod -ne $kMod) { throw "the private key does not match the certificate - you probably mixed up files of another domain; check wizard step 1" }
    Write-Host "[OK]   private key matches the certificate (openssl modulus)"
  } else { Write-Host "[WARN] key/cert pair check skipped (openssl could not read the files)" -ForegroundColor Yellow }
}

# ---- write the site configuration (per-domain file) ------------------------------
$confContent = @'
${conf}
'@
$confPath = Join-Path $confDir ('{0}.conf' -f $cfg.Name)
$prevConf = $null
if (Test-Path $confPath) {
  $ts = Get-Date -Format 'yyyyMMdd-HHmmss'
  $prevConf = Join-Path $backupDir ("{0}.conf.{1}" -f $cfg.Name, $ts)
  Copy-Item $confPath $prevConf -Force
  Write-Host "[OK]   previous config backed up: $prevConf"
}
Set-Content -Path $confPath -Value $confContent -Encoding ASCII
Write-Host "[OK]   site config written: $confPath"

# firewall -------------------------------------------------------------------------
foreach ($port in 80,443) {
  $rule = Get-NetFirewallRule -DisplayName "DeployGuard HTTP $port" -ErrorAction SilentlyContinue
  if (-not $rule) {
    New-NetFirewallRule -DisplayName "DeployGuard HTTP $port" -Direction Inbound -Protocol TCP -LocalPort $port -Action Allow | Out-Null
    Write-Host "[OK]   firewall rule added for TCP $port"
  }
}

# test & reload --------------------------------------------------------------------
$test = Invoke-Nginx @('-t')
Write-Host $test.Output
if ($test.Exit -ne 0) {
  if ($prevConf) {
    Copy-Item $prevConf $confPath -Force
    Write-Host "[WARN] new config was rejected - the previous config was restored automatically" -ForegroundColor Yellow
    Invoke-Nginx @('-t') | Out-Null
  }
  $emergLines = @($test.Output -split "\\r?\\n" | Where-Object { $_ -match 'emerg|crit|\[error\]' } | Select-Object -First 3)
  $detail = if ($emergLines) { $emergLines -join ' | ' } else { $test.Output }
  throw "nginx configuration test failed (exit $($test.Exit)): $detail - fix the reported line and retry (a backup of the previous config is in $backupDir)"
}
Write-Host "[OK]   nginx configuration test passed"

$running = Get-Process nginx -ErrorAction SilentlyContinue
if ($running) {
  $reload = Invoke-Nginx @('-s','reload')
  if ($reload.Exit -ne 0) { throw "nginx reload failed (exit $($reload.Exit)): $($reload.Output)" }
  Write-Host "[OK]   nginx reloaded"
} else {
  Start-Process -FilePath $nginxExe -WorkingDirectory $cfg.NginxPath -WindowStyle Hidden
  Start-Sleep 2
  Write-Host "[OK]   nginx started"
}

Remove-Item $lockFile -Force -ErrorAction SilentlyContinue
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

/* ------------------------------------------------------------------ */
/* multi-level health check (07-Health.ps1)                            */
/* ------------------------------------------------------------------ */

export function generateHealthScript(cfg: DeployConfig): string {
  return `${COMMON_PARAMS(cfg)}${BANNER("Health :: Multi-Level Check")}
$levels = 0; $warns = 0; $fails = 0
function Lvl($key, $status, $detail) {
  Write-Host ("[CHECK] {0} | {1} | {2}" -f $key, $status, $detail)
  if ($status -eq 'ok') { $script:levels++ } elseif ($status -eq 'warn') { $script:warns++ } else { $script:fails++ }
}

# ---- level 1: windows service ------------------------------------------------------
$serviceName = "deployguard-$($cfg.Name)"
$svc = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -eq 'Running') { Lvl 'service' 'ok' "$serviceName is Running" }
elseif ($svc) { Lvl 'service' 'fail' "$serviceName is $($svc.Status) - start it from the panel services tab" }
else { Lvl 'service' 'fail' "$serviceName not installed - deploy first" }

# ---- level 2: backend answers on its port ------------------------------------------
$probe = $null; $probePath = ''
foreach ($p in '/health','/api/health','/docs','/') {
  try {
    $r = Invoke-WebRequest -Uri ("http://127.0.0.1:{0}{1}" -f $cfg.BackendPort, $p) -UseBasicParsing -TimeoutSec 8
    if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { $probe = $r; $probePath = $p; break }
  } catch { $probe = $null }
}
if ($probe) { Lvl 'backend' 'ok' "backend answered HTTP $($probe.StatusCode) on $probePath (127.0.0.1:$($cfg.BackendPort))" }
else { Lvl 'backend' 'fail' "nothing answered on 127.0.0.1:$($cfg.BackendPort) - check service + backend logs in $($cfg.DeployPath)\\logs" }

# ---- level 3: database / required dependencies -------------------------------------
$dbStatus = $null
try {
  if ($probe -and $probe.Content) {
    $j = $probe.Content | ConvertFrom-Json
    $dbStatus = if ($j.database) { "$($j.database)" } elseif ($j.db) { "$($j.db)" } elseif ($j.status) { "$($j.status)" } else { $null }
  }
} catch {}
$envFile = Join-Path $cfg.DeployPath 'backend\\.env'
$dbLine = ''
if (Test-Path $envFile) { $dbLine = (Get-Content $envFile | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1) }
if ($dbStatus -and $dbStatus -match 'ok|connected|healthy|up') {
  Lvl 'database' 'ok' "application /health reports database: $dbStatus"
} elseif (-not $dbLine) {
  Lvl 'database' 'unknown' "no DATABASE_URL in backend\\.env - if this app uses a database it should expose it via /health"
} elseif ($dbLine -match 'sqlite') {
  $m = [regex]::Match($dbLine, 'sqlite:///?(/?[^;]+)')
  $dbPath = $m.Groups[1].Value -replace '^/', ''
  if ($dbPath -notmatch '^([A-Za-z]:)') { $dbPath = Join-Path $cfg.DeployPath "backend\\$dbPath" }
  if (Test-Path $dbPath) { Lvl 'database' 'ok' "sqlite database file exists: $dbPath" }
  else { Lvl 'database' 'fail' "sqlite database file missing: $dbPath" }
} elseif ($dbLine -match '(postgres|postgresql|mysql|mssql)://([^:]+):[^@]*@([^:/]+):?(\\d+)?') {
  $dbHost = $Matches[3]; $dbPort = if ($Matches[4]) { [int]$Matches[4] } else { 5432 }
  $tcp = New-Object Net.Sockets.TcpClient
  try { $reachable = $tcp.ConnectAsync($dbHost, $dbPort).Wait(3000) -and $tcp.Connected } catch { $reachable = $false } finally { $tcp.Close() }
  if ($reachable) { Lvl 'database' 'ok' ("database server {0}:{1} reachable" -f $dbHost, $dbPort) }
  else { Lvl 'database' 'fail' ("database server {0}:{1} NOT reachable - check the DB service/credentials" -f $dbHost, $dbPort) }
} else {
  Lvl 'database' 'unknown' "DATABASE_URL present but format not recognized for a deeper check"
}

# ---- level 4: nginx + HTTPS through the domain --------------------------------------
$nginxExe = Join-Path $cfg.NginxPath 'nginx.exe'
$confPath = Join-Path $cfg.NginxPath ('conf\\conf.d\\{0}.conf' -f $cfg.Name)
$nginxRunning = (Get-Process nginx -ErrorAction SilentlyContinue) -ne $null
if (-not (Test-Path $nginxExe)) { Lvl 'nginx' 'fail' "nginx.exe not found at $nginxExe" }
elseif (-not $nginxRunning) { Lvl 'nginx' 'fail' "nginx is not running - start it from $($cfg.NginxPath)" }
elseif (-not (Test-Path $confPath)) { Lvl 'nginx' 'warn' "site config $confPath not found - (re)run the nginx step" }
else { Lvl 'nginx' 'ok' "nginx running, per-domain config present: $confPath" }

$httpsCode = ''
try { $httpsCode = ((& curl.exe -k -s -o NUL -w "%{http_code}" --max-time 10 ("https://{0}/" -f $cfg.Domain)) | Out-String).Trim() } catch {}
if ($httpsCode -match '^(200|301|302|304)$') { Lvl 'https' 'ok' "https://$($cfg.Domain) responded HTTP $httpsCode" }
elseif ($httpsCode) { Lvl 'https' 'warn' "https://$($cfg.Domain) returned HTTP $httpsCode - check nginx + DNS + firewall" }
else { Lvl 'https' 'warn' "HTTPS probe failed - DNS may not point to this server yet, or curl.exe is unavailable" }

# ---- warnings: disk, ssl expiry, log size -------------------------------------------
$driveRoot = [System.IO.Path]::GetPathRoot($cfg.DeployPath).TrimEnd(':\\')
try {
  $d = Get-PSDrive -Name $driveRoot -ErrorAction Stop
  $freeGb = [math]::Round($d.Free / 1GB, 2)
  $totalGb = [math]::Round(($d.Used + $d.Free) / 1GB, 2)
  if ($freeGb -lt 1) { Lvl 'disk' 'fail' "only $freeGb GB free on $driveRoot (of $totalGb GB) - free space NOW, the service may crash" }
  elseif ($freeGb -lt 2 -or ($d.Free / ($d.Used + $d.Free)) -lt 0.10) { Lvl 'disk' 'warn' "$freeGb GB free on $driveRoot (of $totalGb GB) - plan a cleanup" }
  else { Lvl 'disk' 'ok' "$freeGb GB free on $driveRoot (of $totalGb GB)" }
} catch { Lvl 'disk' 'unknown' "could not read drive $driveRoot" }

try {
  $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 $cfg.SslCertPath
  $daysLeft = ($cert.NotAfter - (Get-Date)).Days
  if ($daysLeft -lt 0) { Lvl 'ssl' 'fail' ("certificate EXPIRED on {0} - renew immediately" -f $cert.NotAfter.ToString('yyyy-MM-dd')) }
  elseif ($daysLeft -le 14) { Lvl 'ssl' 'warn' ("certificate expires in {0} days ({1}) - renew soon" -f $daysLeft, $cert.NotAfter.ToString('yyyy-MM-dd')) }
  else { Lvl 'ssl' 'ok' ("certificate valid until {0} ({1} days left)" -f $cert.NotAfter.ToString('yyyy-MM-dd'), $daysLeft) }
} catch { Lvl 'ssl' 'unknown' "certificate could not be read: $($_.Exception.Message)" }

$logsDir = Join-Path $cfg.DeployPath 'logs'
if (Test-Path $logsDir) {
  $sum = (Get-ChildItem $logsDir -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
  if ($null -eq $sum) { $sum = 0 }
  $logMb = [math]::Round($sum / 1MB, 1)
  if ($logMb -gt 1024) { Lvl 'logs' 'fail' "logs take $logMb MB - run log rotation from the panel now" }
  elseif ($logMb -gt 100) { Lvl 'logs' 'warn' "logs take $logMb MB - consider log rotation from the panel" }
  else { Lvl 'logs' 'ok' "logs take $logMb MB" }
} else { Lvl 'logs' 'unknown' "logs folder not found" }

Write-Host ("[RESULT] health: {0} ok / {1} warn / {2} fail" -f $levels, $warns, $fails)
if ($fails -gt 0) { exit 1 }
`;
}

/* ------------------------------------------------------------------ */
/* log rotation (keeps logs small - asked-for maintenance feature)      */
/* ------------------------------------------------------------------ */

export function generateLogRotateScript(cfg: DeployConfig): string {
  return `${COMMON_PARAMS(cfg)}${BANNER("Maintenance :: Log Rotation")}
# rotate logs older than 7 days into monthly zip archives, drop archives older than 30 days
$targets = @(
  (Join-Path $cfg.DeployPath 'logs'),
  'C:\\ProgramData\\DeployGuard\\logs'
)
$freed = 0
foreach ($dir in $targets) {
  if (-not (Test-Path $dir)) { continue }
  $before = 0
  $beforeSum = (Get-ChildItem $dir -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
  if ($null -ne $beforeSum) { $before = $beforeSum }
  $old = Get-ChildItem $dir -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '\\.(log|txt)$' -and $_.LastWriteTime -lt (Get-Date).AddDays(-7) -and $_.Name -notmatch '\\.(zip|gz)$' }
  if ($old) {
    $archDir = Join-Path $dir 'archive'
    if (-not (Test-Path $archDir)) { New-Item -ItemType Directory -Path $archDir -Force | Out-Null }
    $zip = Join-Path $archDir ("logs-{0}.zip" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
    try {
      Compress-Archive -Path ($old.FullName) -DestinationPath $zip -Force -ErrorAction Stop
      $old | Remove-Item -Force -ErrorAction SilentlyContinue
      Write-Host ("[OK]   archived {0} old log file(s) from {1} ({2})" -f $old.Count, $dir, $zip)
    } catch { Write-Host ("[WARN] could not archive logs in {0}: {1} (files may be in use by the service)" -f $dir, $_.Exception.Message) -ForegroundColor Yellow }
  } else {
    Write-Host "[OK]   no logs older than 7 days in $dir"
  }
  # drop archives older than 30 days
  $archDir2 = Join-Path $dir 'archive'
  if (Test-Path $archDir2) {
    $stale = Get-ChildItem $archDir2 -Filter '*.zip' -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) }
    if ($stale) { $stale | Remove-Item -Force -ErrorAction SilentlyContinue; Write-Host ("[OK]   removed {0} archive(s) older than 30 days" -f $stale.Count) }
  }
  $after = 0
  $afterSum = (Get-ChildItem $dir -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
  if ($null -ne $afterSum) { $after = $afterSum }
  $freed += [math]::Max(0, $before - $after)
}
Write-Host ("[RESULT] log rotation finished - freed {0} MB" -f [math]::Round($freed / 1MB, 1)) -ForegroundColor Green
${STOP_TRANSCRIPT}
`;
}

/* ------------------------------------------------------------------ */
/* versioning: staged releases + safe switch + rollback                 */
/* ------------------------------------------------------------------ */

/** shared extraction/copy logic that stages the source into a target folder */
function stageSourceInto(cfg: DeployConfig, targetDir: string): string {
  return `$stageTarget = ${pq(targetDir)}
if ($cfg.SourceType -eq 'path') {
  $src = $cfg.SourcePath
  $srcBackend  = Join-Path $src 'backend'
  $srcFrontend = Join-Path $src 'frontend'
  if (Test-Path $srcBackend) {
    robocopy $srcBackend (Join-Path $stageTarget 'backend') /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy backend failed with code $LASTEXITCODE - check access to $src" }
    Write-Host "[OK]   backend source copied (robocopy /MIR)"
  } else { throw "backend folder not found under $src - the new source must contain backend\\" }
  if (Test-Path $srcFrontend) {
    robocopy $srcFrontend (Join-Path $stageTarget 'frontend') /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy frontend failed with code $LASTEXITCODE" }
    Write-Host "[OK]   frontend source copied (robocopy /MIR)"
  } else { Write-Host "[WARN] no frontend folder - the current published site stays as-is" }
} else {
  if (-not (Test-Path $cfg.SourcePath)) { throw "source ZIP not found: $($cfg.SourcePath) (the panel temp upload may have been cleaned - upload the ZIP again)" }
  Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue
  $zipEntries = 0
  try {
    $zip = [System.IO.Compression.ZipFile]::OpenRead($cfg.SourcePath)
    $zipEntries = $zip.Entries.Count
    $zip.Dispose()
  } catch { $zipEntries = 0 }
  if ($zipEntries -le 0) { throw "the uploaded file is not a readable ZIP archive: $($cfg.SourcePath) - re-upload the ZIP (the previous upload may have been truncated)" }

  Get-ChildItem $env:TEMP -Filter 'deployguard_*' -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.CreationTime -lt (Get-Date).AddHours(-6) } |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

  $stage = Join-Path $env:TEMP ("deployguard_{0}_{1}" -f $cfg.Name, (Get-Date -Format 'yyyyMMddHHmmss'))
  New-Item -ItemType Directory -Path $stage -Force | Out-Null

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
  if (Test-Path $srcBackend)  { robocopy $srcBackend  (Join-Path $stageTarget 'backend')  /MIR /NFL /NDL /NJH /NJS /NP | Out-Null; if ($LASTEXITCODE -ge 8) { throw "robocopy backend failed with code $LASTEXITCODE" }; Write-Host "[OK]   backend copied from archive" }
  if (Test-Path $srcFrontend) { robocopy $srcFrontend (Join-Path $stageTarget 'frontend') /MIR /NFL /NDL /NJH /NJS /NP | Out-Null; if ($LASTEXITCODE -ge 8) { throw "robocopy frontend failed with code $LASTEXITCODE" }; Write-Host "[OK]   frontend copied from archive" }
  Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
}
`;
}

/** carry runtime state (env, sqlite db, uploads) from the active release to the new one */
const STATE_COPY_BLOCK = `
# ---- carry runtime state (.env, sqlite db, media/uploads) from the running version ----
$releasesDir = Join-Path $cfg.DeployPath 'releases'
$activeFile  = Join-Path $releasesDir '.active'
$prevTag     = 'ROOT'
if (Test-Path $activeFile) { $prevTag = (Get-Content $activeFile -Raw -ErrorAction SilentlyContinue).Trim() }
$stateSrc = Join-Path $cfg.DeployPath 'backend'
if ($prevTag -ne 'ROOT' -and $prevTag -and (Test-Path (Join-Path $releasesDir ($prevTag + '\\backend')))) {
  $stateSrc = Join-Path $releasesDir ($prevTag + '\\backend')
}
Write-Host ("[..]   carrying runtime state from: {0} (active: {1})" -f $stateSrc, $prevTag)
foreach ($f in @('.env') ) {
  $p = Join-Path $stateSrc $f
  if (Test-Path $p) { Copy-Item $p (Join-Path $stateTargetBackend $f) -Force; Write-Host "[OK]   state copied: $f" }
}
Get-ChildItem $stateSrc -File -ErrorAction SilentlyContinue | Where-Object { $_.Extension -in '.sqlite3','.db','.sqlite' } | ForEach-Object {
  Copy-Item $_.FullName (Join-Path $stateTargetBackend $_.Name) -Force; Write-Host ("[OK]   state copied: {0}" -f $_.Name)
}
foreach ($d in @('media','uploads','static')) {
  $p = Join-Path $stateSrc $d
  if (Test-Path $p) { robocopy $p (Join-Path $stateTargetBackend $d) /E /NFL /NDL /NJH /NJS /NP | Out-Null; Write-Host "[OK]   state copied: $d\ (folder)" }
}
`;

export function generateUpdateScripts(cfg: DeployConfig, tag: string): GeneratedScript[] {
  const relDir = `${cfg.deployPath}\\releases\\${tag}`;
  const relBackend = `${relDir}\\backend`;

  const preflight = `${COMMON_PARAMS(cfg)}${BANNER("Update :: Preflight")}
${ADMIN_CHECK}${transcriptBlock(`C:\\ProgramData\\DeployGuard\\logs\\${cfg.name}-update-preflight.log`)}
$failures = 0
function Check($name, $ok, $detail) {
  if ($ok) { Write-Host ("[OK]   {0}  {1}" -f $name, $detail) -ForegroundColor Green }
  else     { Write-Host ("[FAIL] {0}  {1}" -f $name, $detail) -ForegroundColor Red; $script:failures++ }
}
function Warn($name, $detail) { Write-Host ("[WARN] {0}  {1}" -f $name, $detail) -ForegroundColor Yellow }

Check "Existing deployment folder" (Test-Path $cfg.DeployPath) $cfg.DeployPath
$serviceName = "deployguard-$($cfg.Name)"
$svc = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if (-not $svc) { Warn "current service" "$serviceName not installed - the update will install it" }
if ($cfg.SourceType -eq 'zip') { Check "Source ZIP exists" (Test-Path $cfg.SourcePath) $cfg.SourcePath }
else { Check "Source path exists" (Test-Path $cfg.SourcePath) $cfg.SourcePath }
try {
  $d = Get-PSDrive -Name ([System.IO.Path]::GetPathRoot($cfg.DeployPath).TrimEnd(':\\')) -ErrorAction Stop
  $freeGb = [math]::Round($d.Free / 1GB, 2)
  Check "at least 1 GB free on the deploy drive" ($freeGb -ge 1) ("$freeGb GB free - a release copy + build needs space")
} catch { Warn "disk space" "could not read drive usage" }

Write-Host ""
if ($failures -gt 0) {
  Write-Host "[RESULT] Update preflight FAILED with $failures error(s). Update aborted." -ForegroundColor Red
  ${STOP_TRANSCRIPT}
  exit 1
}
Write-Host "[RESULT] Update preflight passed. The running version stays live until the final switch." -ForegroundColor Green
${STOP_TRANSCRIPT}
`;

  const prepare = `${COMMON_PARAMS(cfg)}${BANNER("Update :: Stage New Release (non-destructive)")}
${ADMIN_CHECK}${transcriptBlock(`C:\\ProgramData\\DeployGuard\\logs\\${cfg.name}-update-prepare.log`)}
$tag = ${pq(tag)}
$releasesDir = Join-Path $cfg.DeployPath 'releases'
$relDir = Join-Path $releasesDir $tag
$stateTargetBackend = Join-Path $relDir 'backend'
foreach ($d in @($releasesDir, $relDir, $stateTargetBackend, (Join-Path $relDir 'frontend'), (Join-Path $relDir 'www'))) {
  if (-not (Test-Path $d)) {
    try { New-Item -ItemType Directory -Path $d -Force | Out-Null }
    catch { throw ("could not create folder {0}: {1}" -f $d, $_.Exception.Message) }
  }
  Write-Host ("[OK]   dir ready: {0}" -f $d)
}

# fresh staging: remove leftovers from a previous failed attempt with the same tag
if (Test-Path (Join-Path $relDir 'backend')) { Remove-Item (Join-Path $relDir 'backend') -Recurse -Force -ErrorAction SilentlyContinue }
if (Test-Path (Join-Path $relDir 'frontend')) { Remove-Item (Join-Path $relDir 'frontend') -Recurse -Force -ErrorAction SilentlyContinue }

${stageSourceInto(cfg, relDir)}
${STATE_COPY_BLOCK}

$meta = @{
  tag       = $tag
  createdAt = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
  source    = $cfg.SourcePath
  app       = $cfg.DisplayName
} | ConvertTo-Json
[System.IO.File]::WriteAllText((Join-Path $relDir 'release.json'), $meta, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "[OK]   release.json written"

Write-Host ("[RESULT] release {0} staged at {1} - the running version is untouched" -f $tag, $relDir) -ForegroundColor Green
${STOP_TRANSCRIPT}
`;

  const backend = `${COMMON_PARAMS(cfg)}${BANNER("Update :: Backend Dependencies (shared venv)")}
${ADMIN_CHECK}${transcriptBlock(`C:\\ProgramData\\DeployGuard\\logs\\${cfg.name}-update-backend.log`)}
$tag = ${pq(tag)}
$relBackend = Join-Path $cfg.DeployPath ('releases\\' + $tag + '\\backend')
if (-not (Test-Path $relBackend)) { throw "staged release backend not found: $relBackend - re-run the prepare step first" }
$backendDir = Join-Path $cfg.DeployPath 'backend'

# shared virtual environment (kept outside releases so state and caches survive updates)
if (-not (Get-Command python -ErrorAction SilentlyContinue)) { throw "python not found in PATH - install Python 3.11+ (64-bit) and retry" }
if (-not (Test-Path (Join-Path $backendDir '.venv'))) {
  Push-Location $backendDir
  python -m venv .venv
  if ($LASTEXITCODE -ne 0) { throw "python -m venv failed" }
  Pop-Location
}
Write-Host "[OK]   shared virtual environment ready"

$venvPython = Join-Path $backendDir '.venv\\Scripts\\python.exe'
Push-Location $relBackend
if (Test-Path (Join-Path $relBackend 'requirements.txt')) {
  & $venvPython -m pip install --upgrade pip --quiet
  & $venvPython -m pip install -r requirements.txt --quiet
  if ($LASTEXITCODE -ne 0) { throw "pip install failed - check internet access on the server or a private PyPI mirror" }
  Write-Host "[OK]   requirements.txt of the new release installed"
} else {
  Write-Host "[WARN] requirements.txt not found in the new release - installing uvicorn only"
  & $venvPython -m pip install uvicorn --quiet
}
Pop-Location

Write-Host "[RESULT] backend dependencies for the new release are ready." -ForegroundColor Green
${STOP_TRANSCRIPT}
`;

  const frontend = `${COMMON_PARAMS(cfg)}${BANNER("Update :: Frontend Build (staged, not published)")}
${ADMIN_CHECK}${transcriptBlock(`C:\\ProgramData\\DeployGuard\\logs\\${cfg.name}-update-frontend.log`)}
$tag = ${pq(tag)}
$relFrontend = Join-Path $cfg.DeployPath ('releases\\' + $tag + '\\frontend')
$relWww = Join-Path $cfg.DeployPath ('releases\\' + $tag + '\\www')
if (-not (Test-Path (Join-Path $relFrontend 'package.json'))) {
  Write-Host "[WARN] no package.json in the new release frontend - keeping the current published site; nothing to build"
  ${STOP_TRANSCRIPT}
  exit 0
}
Push-Location $relFrontend
if (Test-Path (Join-Path $relFrontend 'package-lock.json')) { npm ci --no-audit --no-fund } else { npm install --no-audit --no-fund }
if ($LASTEXITCODE -ne 0) { throw "npm install failed - check internet access / node version" }
Write-Host "[OK]   npm dependencies installed"

npm run build
if ($LASTEXITCODE -ne 0) { throw "npm run build failed - fix the frontend build errors and retry" }
Write-Host "[OK]   production build created"

$dist = @('dist','build') | ForEach-Object { Join-Path $relFrontend $_ } | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $dist) { throw "build output (dist/ or build/) not found" }
robocopy $dist $relWww /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "copy to release www failed with code $LASTEXITCODE" }
Write-Host ("[OK]   build staged in {0} (not published yet)" -f $relWww)
Pop-Location
Write-Host "[RESULT] frontend for the new release is staged." -ForegroundColor Green
${STOP_TRANSCRIPT}
`;

  const switchScript = `${COMMON_PARAMS(cfg)}${BANNER("Update :: Safe Switch (with automatic rollback)")}
${ADMIN_CHECK}${transcriptBlock(`C:\\ProgramData\\DeployGuard\\logs\\${cfg.name}-update-switch.log`)}
$tag = ${pq(tag)}
$relDir = Join-Path $cfg.DeployPath ('releases\\' + $tag)
$relBackend = Join-Path $relDir 'backend'
$relWww = Join-Path $relDir 'www'
if (-not (Test-Path $relBackend)) { throw "staged release not found: $relDir - re-run the prepare step" }

$serviceName = "deployguard-$($cfg.Name)"
$serviceExe  = Join-Path $cfg.DeployPath ('service\\{0}-service.exe' -f $cfg.Name)
$xmlPath     = Join-Path $cfg.DeployPath ('service\\{0}-service.xml' -f $cfg.Name)
if (-not (Test-Path $serviceExe)) { throw "service executable not found: $serviceExe - run the initial deployment first" }

# keep an exact backup of the current service definition for instant rollback
$xmlBackup = "$xmlPath.bak_$tag"
Copy-Item $xmlPath $xmlBackup -Force
Write-Host "[OK]   current service definition backed up"

# 1) publish the new frontend (www) - static files are harmless to swap
if (Test-Path (Join-Path $relWww 'index.html')) {
  robocopy $relWww (Join-Path $cfg.DeployPath 'www') /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "publishing new frontend failed with robocopy code $LASTEXITCODE" }
  Write-Host "[OK]   new frontend published to www"
}

# 2) stop the service
$svc = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -ne 'Stopped') { Stop-Service $serviceName -Force; Start-Sleep 2; Write-Host "[OK]   service stopped" }

# 3) retarget the service to the new release backend
$xml = Get-Content $xmlPath -Raw
$newXml = $xml -replace '(?s)<workingdirectory>[^<]*</workingdirectory>', ('<workingdirectory>' + $relBackend + '</workingdirectory>')
if ($newXml -eq $xml) { throw "could not retarget the service working directory in $xmlPath - unexpected service definition" }
Set-Content -Path $xmlPath -Value $newXml -Encoding UTF8
Write-Host ("[OK]   service retargeted to {0}" -f $relBackend)

# 4) reinstall + start
& $serviceExe uninstall | Out-Null
Start-Sleep 1
& $serviceExe install
if ($LASTEXITCODE -ne 0) { throw "service install failed (WinSW exit code $LASTEXITCODE)" }
try { Start-Service $serviceName } catch {
  Copy-Item $xmlBackup $xmlPath -Force
  & $serviceExe uninstall | Out-Null; Start-Sleep 1; & $serviceExe install | Out-Null
  try { Start-Service $serviceName } catch {}
  throw "service start failed: $($_.Exception.Message) - the previous version was restored automatically; check wrapper logs in $($cfg.DeployPath)\\logs"
}

# 5) health gate: if the new backend does not answer, roll back automatically
$deadline = (Get-Date).AddSeconds(90)
$up = $false
while ((Get-Date) -lt $deadline) {
  $t = Test-NetConnection -ComputerName 127.0.0.1 -Port $cfg.BackendPort -WarningAction SilentlyContinue
  if ($t.TcpTestSucceeded) { $up = $true; break }
  Start-Sleep 2
}
if (-not $up) {
  Write-Host "[FAIL] the new release did not answer on port $($cfg.BackendPort) within 90s - rolling back" -ForegroundColor Red
  Copy-Item $xmlBackup $xmlPath -Force
  & $serviceExe uninstall | Out-Null; Start-Sleep 1; & $serviceExe install | Out-Null
  try { Start-Service $serviceName; Start-Sleep 3 } catch {}
  throw "update failed: new backend never listened on port $($cfg.BackendPort) - the previous version is ACTIVE again. Check backend logs in $($cfg.DeployPath)\\logs, fix the issue, then retry from the prepare step"
}

# 6) mark the active release
$activeFile = Join-Path $cfg.DeployPath 'releases\\.active'
Set-Content -Path $activeFile -Value $tag -Encoding ASCII
Write-Host ("[OK]   backend listening on 127.0.0.1:{0}" -f $cfg.BackendPort)
Write-Host ("[RESULT] release {0} is now ACTIVE - the previous version is kept in releases\\ for instant rollback" -f $tag) -ForegroundColor Green
${STOP_TRANSCRIPT}
`;

  return [
    {
      id: "update-preflight",
      fileName: "U1-Update-Preflight.ps1",
      title: "بررسی پیش از به‌روزرسانی",
      description: "کنترل وجود سامانه فعلی، منبع کد جدید و فضای دیسک — نسخه در حال اجرا تا سوییچ نهایی دست‌نخورده می‌ماند",
      content: preflight,
    },
    {
      id: "update-prepare",
      fileName: "U2-Stage-Release.ps1",
      title: "آماده‌سازی نسخه جدید (غیرمخرب)",
      description: "استخراج کد جدید در پوشه releases، انتقال وضعیت (.env، دیتابیس sqlite، رسانه‌ها) و ثبت release.json — بدون هیچ تغییری در نسخه در حال اجرا",
      content: prepare,
    },
    {
      id: "update-backend",
      fileName: "U3-Backend-Deps.ps1",
      title: "وابستگی‌های بک‌اند نسخه جدید",
      description: "نصب requirements.txt نسخه جدید در venv مشترک — سرویس هنوز روی نسخه فعلی اجرا می‌شود",
      content: backend,
    },
    {
      id: "update-frontend",
      fileName: "U4-Frontend-Build.ps1",
      title: "ساخت فرانت‌اند نسخه جدید",
      description: "npm ci + build در پوشه نسخه جدید و مرحله‌بندی خروجی — انتشار فقط در سوییچ نهایی انجام می‌شود",
      content: frontend,
    },
    {
      id: "update-switch",
      fileName: "U5-Safe-Switch.ps1",
      title: "سوییچ ایمن به نسخه جدید",
      description: "توقف سرویس، تغییر مقصد به نسخه جدید، انتشار www و health-gate: اگر بک‌اند جدید تا ۹۰ ثانیه بالا نیاید، به‌طور خودکار به نسخه قبلی بازمی‌گردد",
      content: switchScript,
    },
    {
      id: "update-verify",
      fileName: "U6-Verify.ps1",
      title: "اعتبارسنجی پس از به‌روزرسانی",
      description: "کنترل سرویس، پورت، پروب HTTP و https دامنه — همان اعتبارسنجی استقرار اولیه",
      content: script06(cfg),
    },
  ];
}

export const UPDATE_STEPS = [
  { id: "update-preflight", scriptId: "update-preflight", title: "بررسی پیش از به‌روزرسانی" },
  { id: "update-prepare", scriptId: "update-prepare", title: "آماده‌سازی نسخه جدید" },
  { id: "update-backend", scriptId: "update-backend", title: "وابستگی‌های بک‌اند" },
  { id: "update-frontend", scriptId: "update-frontend", title: "ساخت فرانت‌اند" },
  { id: "update-switch", scriptId: "update-switch", title: "سوییچ ایمن" },
  { id: "update-verify", scriptId: "update-verify", title: "اعتبارسنجی نهایی" },
];

export function generateRollbackScript(cfg: DeployConfig, tag: string): string {
  return `${COMMON_PARAMS(cfg)}${BANNER("Rollback :: Return to a Known-Good Release")}
${ADMIN_CHECK}${transcriptBlock(`C:\\ProgramData\\DeployGuard\\logs\\${cfg.name}-rollback.log`)}
$tag = ${pq(tag)}
$releasesDir = Join-Path $cfg.DeployPath 'releases'
$target = Join-Path $releasesDir $tag
$targetBackend = Join-Path $target 'backend'
if (-not (Test-Path $targetBackend)) { throw "release folder not found: $target - nothing to roll back to" }

$serviceName = "deployguard-$($cfg.Name)"
$serviceExe  = Join-Path $cfg.DeployPath ('service\\{0}-service.exe' -f $cfg.Name)
$xmlPath     = Join-Path $cfg.DeployPath ('service\\{0}-service.xml' -f $cfg.Name)
$xmlBackup   = "$xmlPath.bak_rollback_$(Get-Date -Format yyyyMMddHHmmss)"
Copy-Item $xmlPath $xmlBackup -Force
Write-Host "[OK]   current service definition backed up"

# stop the service
$svc = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -ne 'Stopped') { Stop-Service $serviceName -Force; Start-Sleep 2; Write-Host "[OK]   service stopped" }

# retarget the service to the known-good release
$xml = Get-Content $xmlPath -Raw
$newXml = $xml -replace '(?s)<workingdirectory>[^<]*</workingdirectory>', ('<workingdirectory>' + $targetBackend + '</workingdirectory>')
if ($newXml -eq $xml) { throw "could not retarget the service working directory in $xmlPath" }
Set-Content -Path $xmlPath -Value $newXml -Encoding UTF8
Write-Host ("[OK]   service retargeted to {0}" -f $targetBackend)

& $serviceExe uninstall | Out-Null
Start-Sleep 1
& $serviceExe install
if ($LASTEXITCODE -ne 0) { throw "service install failed (WinSW exit code $LASTEXITCODE)" }
try { Start-Service $serviceName } catch {
  Copy-Item $xmlBackup $xmlPath -Force
  & $serviceExe uninstall | Out-Null; Start-Sleep 1; & $serviceExe install | Out-Null
  try { Start-Service $serviceName } catch {}
  throw "rollback failed while starting the service: $($_.Exception.Message) - the previous definition was restored; check wrapper logs"
}

$deadline = (Get-Date).AddSeconds(90)
$up = $false
while ((Get-Date) -lt $deadline) {
  $t = Test-NetConnection -ComputerName 127.0.0.1 -Port $cfg.BackendPort -WarningAction SilentlyContinue
  if ($t.TcpTestSucceeded) { $up = $true; break }
  Start-Sleep 2
}
if (-not $up) { throw "rollback done but backend did not answer on port $($cfg.BackendPort) within 90s - check backend logs" }

# republish the frontend of that release if it exists
if (Test-Path (Join-Path $target 'www\\index.html')) {
  robocopy (Join-Path $target 'www') (Join-Path $cfg.DeployPath 'www') /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
  Write-Host "[OK]   frontend of release $tag republished"
}

Set-Content -Path (Join-Path $releasesDir '.active') -Value $tag -Encoding ASCII
Write-Host ("[RESULT] rolled back to release {0} - site is back on the last known-good version" -f $tag) -ForegroundColor Green
Write-Host "[WARN]  rollback restores CODE only - database schema changes made by the newer release are NOT reverted automatically; use your app's migration tooling for that" -ForegroundColor Yellow
${STOP_TRANSCRIPT}
`;
}
