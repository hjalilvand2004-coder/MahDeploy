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
      "[OK]   conf.d include already present",
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
