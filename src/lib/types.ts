export const IS_WINDOWS = process.platform === "win32";
/** In the cloud sandbox we cannot execute PowerShell / manage Nginx on a real
 *  Windows host, so the panel runs in «simulation» mode: all Windows-specific
 *  operations produce realistic logs, while CPU/RAM/Disk metrics stay real. */
export const SIMULATION = !IS_WINDOWS;

export type CheckStatus = "ok" | "warn" | "fail";

export interface CheckResult {
  key: string;
  title: string;
  status: CheckStatus;
  message: string;
  detail?: string;
}

export interface DriveInfo {
  letter: string;
  totalGb: number;
  usedGb: number;
  freeGb: number;
  usedPercent: number;
}

export interface ServerStatus {
  mode: "live" | "simulation";
  os: string;
  hostname: string;
  cpu: { percent: number; cores: number; model: string; speedMhz: number };
  ram: { totalGb: number; usedGb: number; percent: number };
  disks: DriveInfo[];
  uptimeHours: number;
  nginx: { installed: boolean; version: string; running: boolean; configOk: boolean; confPath: string };
  services: { python: string | null; node: string | null; winsw: string | null };
  isElevated: boolean;
  timestamp: number;
}

export interface PortUsage {
  port: number;
  pid: number | null;
  process: string;
  source: "deployment" | "system";
  deploymentName?: string;
  deploymentDomain?: string;
}

export interface DeployConfig {
  name: string;
  displayName: string;
  domain: string;
  backendPort: number;
  sourceType: "path" | "zip";
  sourcePath: string;
  deployBase: string;
  deployPath: string;
  sslCertPath: string;
  sslKeyPath: string;
  nginxPath: string;
}

export interface GeneratedScript {
  id: string;
  fileName: string;
  title: string;
  description: string;
  content: string;
}

export interface StepState {
  id: string;
  scriptId: string;
  title: string;
  status: "pending" | "running" | "success" | "failed";
  output: string[];
  durationMs: number;
  startedAt?: number;
}
