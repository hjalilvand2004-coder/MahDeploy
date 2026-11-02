import type { DeployConfig } from "@/lib/types";

/**
 * Simulation engine: when the panel runs outside a real Windows server
 * (e.g. the cloud preview), every deployment step produces a realistic
 * PowerShell console transcript so the whole flow can be experienced.
 * On a real Windows host the actual scripts are executed instead.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface StepScript {
  id: string;
  lines: (cfg: DeployConfig) => string[];
}

const STEPS: Record<string, StepScript> = {
  preflight: {
    id: "preflight",
    lines: (c) => [
      "==============================================================",
      "  DeployGuard :: Preflight Checks",
      `  Target: ${c.displayName}  (${c.domain})`,
      `  Time  : ${now()}`,
      "==============================================================",
      "[OK] Administrator privileges confirmed",
      `[OK]   Port ${c.backendPort} is free`,
      "[OK]   SSL certificate file exists",
      "[OK]   SSL private key file exists",
      "[OK]   Nginx binary  nginx version: nginx/1.26.3",
      "[OK]   Python available  Python 3.12.8",
      "[OK]   Node.js available  v22.14.0",
      `[OK]   Domain DNS resolves  ${c.domain} -> 185.55.12.7`,
      "[OK]   DNS points to this server",
      "[OK]   Source path exists",
      "[OK]   frontend folder detected  True",
      "[OK]   backend  folder detected  True",
      "[OK]   Destination drive ready",
      "[RESULT] Preflight passed. Ready to deploy.",
    ],
  },
  prepare: {
    id: "prepare",
    lines: (c) => [
      "  DeployGuard :: Prepare Folders & Source",
      `[OK]   dir ready: ${c.deployPath}`,
      `[OK]   dir ready: ${c.deployPath}\\backend`,
      `[OK]   dir ready: ${c.deployPath}\\frontend`,
      `[OK]   dir ready: ${c.deployPath}\\www`,
      `[OK]   dir ready: ${c.deployPath}\\logs`,
      `[OK]   dir ready: ${c.deployPath}\\service`,
      `[OK]   dir ready: ${c.deployPath}\\nginx`,
      `[OK]   dir ready: ${c.deployPath}\\scripts`,
      "[OK]   backend source copied (robocopy /MIR)",
      "[OK]   frontend source copied (robocopy /MIR)",
      `[OK]   backend\\.env written`,
      "[RESULT] Preparation completed.",
    ],
  },
  backend: {
    id: "backend",
    lines: (c) => [
      "  DeployGuard :: Backend :: venv + WinSW Service",
      "[OK]   virtual environment ready",
      "[..]   pip install -r requirements.txt",
      "         Collecting fastapi==0.115.8",
      "         Collecting uvicorn[standard]==0.34.0",
      "         Successfully installed fastapi-0.115.8 uvicorn-0.34.0",
      "[OK]   requirements.txt installed",
      "[OK]   WinSW binary staged",
      "[OK]   service definition written",
      `         Service 'deployguard-${c.name}' installed successfully!`,
      `[OK]   service 'deployguard-${c.name}' started`,
      "[..]   waiting for backend to listen on port ...",
      `         TcpTestSucceeded : True`,
      `[OK]   backend listening on 127.0.0.1:${c.backendPort}`,
      "[RESULT] Backend deployment completed.",
    ],
  },
  frontend: {
    id: "frontend",
    lines: (c) => [
      "  DeployGuard :: Frontend :: Build & Publish",
      "[..]   npm ci --no-audit --no-fund",
      "         added 1284 packages, and audited 1285 packages in 38s",
      "[OK]   npm dependencies installed",
      "[..]   npm run build",
      "         vite v6.2.0 building for production...",
      "         transforming (1841) node_modules/react-dom/index.js",
      "         ✓ 2406 modules transformed.",
      "         dist/index.html                 1.42 kB │ gzip:  0.68 kB",
      "         dist/assets/index-Cx9b2q.js   486.73 kB │ gzip: 152.18 kB",
      "         dist/assets/index-8Yp1ac.css   61.94 kB │ gzip: 12.05 kB",
      "         ✓ built in 24.31s",
      "[OK]   production build created",
      "[OK]   build published to www",
      "[RESULT] Frontend deployment completed.",
    ],
  },
  nginx: {
    id: "nginx",
    lines: (c) => [
      "  DeployGuard :: Nginx :: Site Configuration & Reload",
      "[OK]   nginx config lock acquired",
      "[OK]   nginx.conf already includes conf.d and the websocket map",
      "[OK]   SSL certificate valid until 2027-03-15 (134 days left)",
      "[OK]   certificate matches the domain",
      "[OK]   private key matches the certificate (openssl modulus)",
      "[OK]   previous config backed up: " + c.deployPath + "\\nginx-backups\\" + c.name + ".conf.20260101-120000",
      `[OK]   site config written: ${c.nginxPath}\\conf\\conf.d\\${c.name}.conf`,
      "[OK]   firewall rule added for TCP 80",
      "[OK]   firewall rule added for TCP 443",
      "         nginx: the configuration file C:/nginx/conf/nginx.conf syntax is ok",
      "         nginx: configuration file C:/nginx/conf/nginx.conf test is successful",
      "[OK]   nginx configuration test passed",
      "[OK]   nginx reloaded",
      `[RESULT] Nginx site is live at https://${c.domain}`,
    ],
  },
  verify: {
    id: "verify",
    lines: (c) => [
      "  DeployGuard :: Verify :: End-to-End Checks",
      `[OK]   service deployguard-${c.name} is Running`,
      `[OK]   127.0.0.1:${c.backendPort} responds`,
      "[OK]   FastAPI /docs HTTP 200",
      "[OK]   https://" + c.domain + " -> HTTP 200",
      "==============================================================",
      "  Deployment summary",
      "--------------------------------------------------------------",
      `  Site      : https://${c.domain}`,
      `  API       : https://${c.domain}/api  (uvicorn 127.0.0.1:${c.backendPort})`,
      `  Service   : deployguard-${c.name}`,
      `  Folder    : ${c.deployPath}`,
      `  Nginx conf: ${c.nginxPath}\\conf\\conf.d\\${c.name}.conf`,
      "==============================================================",
    ],
  },

  /* ---------------- multi-level health check ---------------- */
  health: {
    id: "health",
    lines: (c) => [
      "  MahDeploy :: Health :: Multi-Level Check",
      `[CHECK] service | ok | deployguard-${c.name} is Running`,
      `[CHECK] backend | ok | backend answered HTTP 200 on /health (127.0.0.1:${c.backendPort})`,
      "[CHECK] database | ok | application /health reports database: connected",
      "[CHECK] nginx | ok | nginx running, per-domain config present: " + c.nginxPath + "\\conf\\conf.d\\" + c.name + ".conf",
      "[CHECK] https | ok | https://" + c.domain + " responded HTTP 200",
      "[CHECK] disk | ok | 42.6 GB free on C: (of 120 GB)",
      "[CHECK] ssl | ok | certificate valid until 2027-03-15 (134 days left)",
      "[CHECK] logs | ok | logs take 6.4 MB",
      "[RESULT] health: 7 ok / 0 warn / 0 fail",
    ],
  },

  /* ---------------- versioned update flow ---------------- */
  "update-preflight": {
    id: "update-preflight",
    lines: (c) => [
      "  MahDeploy :: Update :: Preflight",
      "[OK] Administrator privileges confirmed",
      `[OK]   Existing deployment folder  ${c.deployPath}`,
      `[OK]   service deployguard-${c.name} is installed`,
      "[OK]   Source ZIP exists",
      "[OK]   at least 1 GB free on the deploy drive  42.6 GB free",
      "[RESULT] Update preflight passed. The running version stays live until the final switch.",
    ],
  },
  "update-prepare": {
    id: "update-prepare",
    lines: (c) => [
      "  MahDeploy :: Update :: Stage New Release (non-destructive)",
      `[OK]   dir ready: ${c.deployPath}\\releases\\20260102-093000`,
      "[OK]   archive extracted (631 entries, tar.exe)",
      "[OK]   backend copied from archive",
      "[OK]   frontend copied from archive",
      "[..]   carrying runtime state from: " + c.deployPath + "\\backend (active: ROOT)",
      "[OK]   state copied: .env",
      "[OK]   state copied: db.sqlite3",
      "[OK]   release.json written",
      "[RESULT] release 20260102-093000 staged - the running version is untouched",
    ],
  },
  "update-backend": {
    id: "update-backend",
    lines: (c) => [
      "  MahDeploy :: Update :: Backend Dependencies (shared venv)",
      "[OK]   shared virtual environment ready",
      "         Collecting fastapi==0.116.0",
      "         Successfully installed fastapi-0.116.0",
      "[OK]   requirements.txt of the new release installed",
      "[RESULT] backend dependencies for the new release are ready.",
    ],
  },
  "update-frontend": {
    id: "update-frontend",
    lines: (c) => [
      "  MahDeploy :: Update :: Frontend Build (staged, not published)",
      "         added 1284 packages, and audited 1285 packages in 36s",
      "[OK]   npm dependencies installed",
      "         vite v6.2.0 building for production...",
      "         ✓ 2406 modules transformed.",
      "[OK]   production build created",
      "[OK]   build staged in " + c.deployPath + "\\releases\\20260102-093000\\www (not published yet)",
      "[RESULT] frontend for the new release is staged.",
    ],
  },
  "update-switch": {
    id: "update-switch",
    lines: (c) => [
      "  MahDeploy :: Update :: Safe Switch (with automatic rollback)",
      "[OK]   current service definition backed up",
      "[OK]   new frontend published to www",
      "[OK]   service stopped",
      "[OK]   service retargeted to " + c.deployPath + "\\releases\\20260102-093000\\backend",
      `[OK]   service 'deployguard-${c.name}' started`,
      "[..]   health gate: waiting for the new backend ...",
      `[OK]   backend listening on 127.0.0.1:${c.backendPort}`,
      "[RESULT] release 20260102-093000 is now ACTIVE - the previous version is kept in releases\\ for instant rollback",
    ],
  },
  "update-verify": {
    id: "update-verify",
    lines: (c) => [
      "  MahDeploy :: Verify :: End-to-End Checks",
      `[OK]   service deployguard-${c.name} is Running`,
      `[OK]   127.0.0.1:${c.backendPort} responds`,
      "[OK]   FastAPI /docs HTTP 200",
      "[OK]   https://" + c.domain + " -> HTTP 200",
      "[RESULT] update verified.",
    ],
  },
  rollback: {
    id: "rollback",
    lines: (c) => [
      "  MahDeploy :: Rollback :: Return to a Known-Good Release",
      "[OK]   current service definition backed up",
      "[OK]   service stopped",
      "[OK]   service retargeted to " + c.deployPath + "\\releases\\20260101-113000\\backend",
      `[OK]   service 'deployguard-${c.name}' started`,
      `[OK]   backend listening on 127.0.0.1:${c.backendPort}`,
      "[OK]   frontend of release 20260101-113000 republished",
      "[RESULT] rolled back to release 20260101-113000 - site is back on the last known-good version",
      "[WARN]  rollback restores CODE only - database schema changes are NOT reverted automatically",
    ],
  },
  "log-rotate": {
    id: "log-rotate",
    lines: (c) => [
      "  MahDeploy :: Maintenance :: Log Rotation",
      "[OK]   archived 12 old log file(s) from " + c.deployPath + "\\logs (" + c.deployPath + "\\logs\\archive\\logs-20260102-093500.zip)",
      "[OK]   removed 3 archive(s) older than 30 days",
      "[OK]   no logs older than 7 days in C:\\ProgramData\\DeployGuard\\logs",
      "[RESULT] log rotation finished - freed 214.8 MB",
    ],
  },
};

function now() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

export function simulationSteps(): string[] {
  return Object.keys(STEPS);
}

/** simulated output for service management actions (start/stop/restart/remove) */
export async function runSimulatedServiceAction(
  action: "start" | "stop" | "restart" | "uninstall",
  cfg: DeployConfig,
  onLine: (line: string) => void
): Promise<{ ok: boolean; output: string[] }> {
  const service = `deployguard-${cfg.name}`;
  const map: Record<string, string[]> = {
    start: [
      `# DeployGuard :: start service for ${cfg.displayName}`,
      `PS> Start-Service -Name ${service}`,
      `[OK]  ${service} -> Running`,
    ],
    stop: [
      `# DeployGuard :: stop service for ${cfg.displayName}`,
      `PS> Stop-Service -Name ${service} -Force`,
      `[OK]  ${service} -> Stopped`,
    ],
    restart: [
      `# DeployGuard :: restart service for ${cfg.displayName}`,
      `PS> Restart-Service -Name ${service} -Force`,
      `[OK]  ${service} -> Running`,
    ],
    uninstall: [
      `# DeployGuard :: full removal of ${cfg.displayName} (${cfg.domain})`,
      "[OK] Administrator privileges confirmed",
      `PS> Stop-Service ${service} -Force; & ${cfg.deployPath}\\service\\${cfg.name}-service.exe uninstall`,
      `[OK]   service ${service} removed`,
      `PS> Move-Item ${cfg.nginxPath}\\conf\\conf.d\\${cfg.name}.conf *.removed`,
      "[OK]   nginx site removed & reloaded",
      `PS> Copy-Item ${cfg.deployPath}\\logs\\* C:\\ProgramData\\DeployGuard\\backups\\${cfg.name}_...`,
      `PS> Remove-Item ${cfg.deployPath} -Recurse -Force`,
      `[OK]   folder removed: ${cfg.deployPath} (logs archived)`,
      `[RESULT] ${cfg.displayName} fully removed.`,
    ],
  };
  const lines = map[action] ?? [`[FAIL] unknown action ${action}`];
  const output: string[] = [];
  for (const line of lines) {
    await sleep(180 + Math.floor(Math.random() * 160));
    output.push(line);
    onLine(line);
  }
  return { ok: true, output };
}

export async function runSimulatedStep(
  stepId: string,
  cfg: DeployConfig,
  onLine: (line: string) => void
): Promise<{ ok: boolean; output: string[] }> {
  const step = STEPS[stepId];
  if (!step) return { ok: false, output: [`[FAIL] unknown step ${stepId}`] };
  const lines = step.lines(cfg);
  const output: string[] = [];
  for (const line of lines) {
    await sleep(60 + Math.floor(Math.random() * 90));
    output.push(line);
    onLine(line);
  }
  return { ok: true, output };
}
