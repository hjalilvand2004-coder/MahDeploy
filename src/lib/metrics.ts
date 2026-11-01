import { exec } from "child_process";
import { promises as fs } from "fs";
import net from "net";
import os from "os";
import { SIMULATION, type PortUsage, type ServerStatus } from "@/lib/types";

function run(cmd: string, timeout = 8000): Promise<string> {
  return new Promise((resolve) => {
    exec(cmd, { timeout }, (err, stdout) => resolve(err ? "" : stdout.trim()));
  });
}

/* ------------------------------ CPU (real) ------------------------------ */
let lastCpuSnapshot: { idle: number; total: number; time: number } | null = null;

function cpuSnapshot() {
  const cpus = os.cpus();
  let idle = 0, total = 0;
  for (const c of cpus) {
    idle += c.times.idle;
    total += c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq;
  }
  return { idle, total, time: Date.now() };
}

export function cpuPercent(): number {
  const snap = cpuSnapshot();
  if (!lastCpuSnapshot) {
    lastCpuSnapshot = snap;
    return 0;
  }
  const idleDelta = snap.idle - lastCpuSnapshot.idle;
  const totalDelta = snap.total - lastCpuSnapshot.total;
  lastCpuSnapshot = snap;
  if (totalDelta <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((1 - idleDelta / totalDelta) * 100)));
}

/* ------------------------------ RAM / Disks (real) ---------------------- */
async function linuxDisks() {
  try {
    const out = await run("df -P -B1 | tail -n +2");
    const lines = out.split("\n");
    const seen = new Set<string>();
    const disks = [] as { letter: string; totalGb: number; usedGb: number; freeGb: number; usedPercent: number }[];
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 6) continue;
      const [device, total, used, avail, , mount] = parts;
      // skip virtual / pseudo filesystems
      if (/^(tmpfs|shm|udev|devtmpfs|overlay|ossfs|squashfs|proc|sysfs|cgroup)/.test(device)) continue;
      if (/^(\/dev\/shm|\/run|\/sys|\/proc)/.test(mount)) continue;
      if (seen.has(mount) || total === "0") continue;
      seen.add(mount);
      const T = Number(total), U = Number(used), A = Number(avail);
      disks.push({
        letter: mount,
        totalGb: +(T / 1024 ** 3).toFixed(1),
        usedGb: +(U / 1024 ** 3).toFixed(1),
        freeGb: +(A / 1024 ** 3).toFixed(1),
        usedPercent: Math.round((U / (U + A)) * 100),
      });
    }
    // fallback: keep the root filesystem even on exotic setups
    if (disks.length === 0) {
      const root = lines.find((l) => l.trim().split(/\s+/)[5] === "/");
      if (root) {
        const [, total, used, avail] = root.trim().split(/\s+/);
        const T = Number(total), U = Number(used), A = Number(avail);
        disks.push({ letter: "/", totalGb: +(T / 1024 ** 3).toFixed(1), usedGb: +(U / 1024 ** 3).toFixed(1), freeGb: +(A / 1024 ** 3).toFixed(1), usedPercent: Math.round((U / (U + A)) * 100) });
      }
    }
    return disks.sort((a, b) => b.totalGb - a.totalGb).slice(0, 4);
  } catch {
    return [{ letter: "/", totalGb: 40, usedGb: 14.2, freeGb: 25.8, usedPercent: 36 }];
  }
}

function windowsDisksScript() {
  return `
$d = Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object {
  $t=$_.Size; $f=$_.FreeSpace; $u=$t-$f
  "{0}|{1}|{2}|{3}|{4}" -f $_.DeviceID, [math]::Round($t/1GB,1), [math]::Round($u/1GB,1), [math]::Round($f/1GB,1), [math]::Round($u/$t*100,0)
}
$d -join ";"`;
}

function parseWindowsDisks(out: string) {
  return out.split(";").filter(Boolean).map((row) => {
    const [letter, totalGb, usedGb, freeGb, usedPercent] = row.split("|");
    return { letter, totalGb: Number(totalGb), usedGb: Number(usedGb), freeGb: Number(freeGb), usedPercent: Number(usedPercent) };
  });
}

/* ------------------------------ Versions -------------------------------- */
async function detectVersions() {
  const [python, node, nginx] = await Promise.all([
    run("python3 --version 2>&1 || python --version 2>&1"),
    run("node --version 2>&1"),
    run("nginx -v 2>&1"),
  ]);
  return {
    python: python.match(/Python ([\d.]+)/)?.[0] ?? null,
    node: node.match(/v?([\d.]+)/)?.[0] ? `v${node.match(/([\d.]+)/)?.[1]}` : null,
    winsw: null as string | null,
    nginxVersion: nginx.match(/([\d.]+)/)?.[1] ?? null,
  };
}

/* ------------------------------ Status ---------------------------------- */
const NGINX_VERSION_SIM = "1.26.3";

export async function getServerStatus(): Promise<ServerStatus> {
  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  let disks = await linuxDisks();
  let versions = await detectVersions();
  let uptimeHours = +(os.uptime() / 3600).toFixed(1);
  let osName = `${os.type()} ${os.release()}`;

  if (!SIMULATION) {
    // Real Windows path
    const diskOut = await run(`powershell -NoProfile -Command "${windowsDisksScript().replace(/\n/g, " ")}"`);
    if (diskOut) disks = parseWindowsDisks(diskOut);
    const pyOut = await run("powershell -NoProfile -Command \"(Get-Command python -ErrorAction SilentlyContinue).Source; python --version 2>&1\"");
    const nodeOut = await run("powershell -NoProfile -Command \"node --version 2>&1\"");
    const osOut = await run("powershell -NoProfile -Command \"(Get-CimInstance Win32_OperatingSystem).Caption; (Get-CimInstance Win32_OperatingSystem).LastBootUpTime\"");
    const [caption, boot] = osOut.split("\n");
    if (caption) osName = caption.trim();
    if (boot) {
      const bootMs = Date.parse(boot.trim());
      if (!isNaN(bootMs)) uptimeHours = +((Date.now() - bootMs) / 3600000).toFixed(1);
    }
    versions = {
      python: pyOut.match(/Python ([\d.]+)/)?.[0] ?? null,
      node: nodeOut.match(/v?([\d.]+)/)?.[0] ? `v${nodeOut.match(/([\d.]+)/)?.[1]}` : null,
      winsw: null,
      nginxVersion: (await run("powershell -NoProfile -Command \"nginx -v 2>&1\"")).match(/([\d.]+)/)?.[1] ?? null,
    };
  }

  const nginxInstalled = SIMULATION ? true : !!versions.nginxVersion;

  return {
    mode: SIMULATION ? "simulation" : "live",
    os: osName,
    hostname: os.hostname(),
    cpu: {
      percent: cpuPercent(),
      cores: cpus.length,
      model: cpus[0]?.model?.replace(/\s+/g, " ").trim().slice(0, 48) ?? "CPU",
      speedMhz: cpus[0]?.speed ?? 0,
    },
    ram: {
      totalGb: +(totalMem / 1024 ** 3).toFixed(1),
      usedGb: +(usedMem / 1024 ** 3).toFixed(1),
      percent: Math.round((usedMem / totalMem) * 100),
    },
    disks,
    uptimeHours,
    nginx: {
      installed: nginxInstalled,
      version: nginxInstalled ? (versions.nginxVersion ?? NGINX_VERSION_SIM) : "",
      running: nginxInstalled,
      configOk: nginxInstalled,
      confPath: SIMULATION ? "C:\\nginx\\conf\\nginx.conf" : "C:\\nginx\\conf\\nginx.conf",
    },
    services: {
      python: versions.python,
      node: versions.node,
      winsw: SIMULATION ? "WinSW v2.12.0 (simulated)" : null,
    },
    isElevated: SIMULATION ? true : false,
    timestamp: Date.now(),
  };
}

/* ------------------------------ Ports ----------------------------------- */
export async function isPortFree(port: number): Promise<{ free: boolean; owner?: string }> {
  if (!SIMULATION) {
    const out = await run(
      `powershell -NoProfile -Command "Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object LocalPort -eq ${port} | Select-Object -First 1 OwningProcess | ForEach-Object { (Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).ProcessName }"`
    );
    if (out.trim()) return { free: false, owner: out.trim() };
    return { free: true };
  }
  // Linux: real bind test
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", (e: NodeJS.ErrnoException) => {
      resolve({ free: false, owner: e.code === "EACCES" ? "دسترسی ندارند" : "پردازش ناشناس" });
    });
    srv.once("listening", () => {
      srv.close(() => resolve({ free: true }));
    });
    srv.listen(port, "127.0.0.1");
  });
}

const SIM_PORTS: PortUsage[] = [
  { port: 80, pid: 4212, process: "nginx.exe", source: "system" },
  { port: 443, pid: 4212, process: "nginx.exe", source: "system" },
  { port: 3389, pid: 996, process: "svchost.exe", source: "system" },
  { port: 135, pid: 724, process: "svchost.exe", source: "system" },
  { port: 445, pid: 4, process: "System", source: "system" },
  { port: 3000, pid: 5188, process: "node.exe", source: "system" },
];

export async function getPortUsage(
  deployments: { name: string; domain: string; backendPort: number; status: string }[]
): Promise<PortUsage[]> {
  const result: PortUsage[] = [];
  if (!SIMULATION) {
    const out = await run(
      `powershell -NoProfile -Command "Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalPort -Unique | Sort-Object"`
    );
    const ports = out.split("\n").map((p) => parseInt(p.trim())).filter((p) => !isNaN(p) && p > 0);
    for (const p of ports.slice(0, 60)) {
      const ownerOut = await run(
        `powershell -NoProfile -Command "$c = Get-NetTCPConnection -State Listen -LocalPort ${p} -ErrorAction SilentlyContinue | Select-Object -First 1; if ($c) { $proc = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue; \\"{0}|{1}\\" -f $c.OwningProcess, $proc.ProcessName }"`
      );
      const [pid, name] = ownerOut.split("|");
      result.push({ port: p, pid: Number(pid) || null, process: name || "unknown", source: "system" });
    }
  } else {
    result.push(...SIM_PORTS.map((p) => ({ ...p })));
  }
  // layer deployment info on top
  const byPort = new Map(result.map((r) => [r.port, r]));
  for (const d of deployments) {
    const existing = byPort.get(d.backendPort);
    if (existing) {
      existing.source = "deployment";
      existing.deploymentName = d.displayName;
      existing.deploymentDomain = d.domain;
      existing.process = d.status === "active" ? `${d.name}-service.exe` : existing.process;
    } else {
      result.push({
        port: d.backendPort,
        pid: null,
        process: `${d.name}-service.exe`,
        source: "deployment",
        deploymentName: d.displayName,
        deploymentDomain: d.domain,
      });
    }
  }
  return result.sort((a, b) => a.port - b.port);
}
