import { spawn } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { SIMULATION, type DeployConfig } from "@/lib/types";
import { runSimulatedStep, runSimulatedServiceAction } from "@/lib/simulator";

export interface StepResult {
  ok: boolean;
  output: string[];
  durationMs: number;
  simulated: boolean;
  error?: string;
}

/** Execute a single generated PowerShell script (real mode) or simulate it. */
export async function executeStep(
  stepId: string,
  scriptContent: string,
  cfg: DeployConfig,
  onLine: (line: string) => void
): Promise<StepResult> {
  const startedAt = Date.now();

  if (SIMULATION) {
    // management actions have dedicated simulations
    if (stepId === "uninstall" || stepId.startsWith("service-")) {
      const action = stepId === "uninstall" ? "uninstall" : (stepId.replace("service-", "") as "start" | "stop" | "restart");
      const res = await runSimulatedServiceAction(action, cfg, onLine);
      return { ...res, durationMs: Date.now() - startedAt, simulated: true };
    }
    const res = await runSimulatedStep(stepId, cfg, onLine);
    return { ...res, durationMs: Date.now() - startedAt, simulated: true };
  }

  // ---- real Windows execution ----
  const dir = path.join(os.tmpdir(), "deployguard");
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${cfg.name}-${stepId}-${Date.now()}.ps1`);
  await fs.writeFile(file, "\uFEFF" + scriptContent, "utf8"); // BOM for PS 5.1 UTF-8

  return new Promise((resolve) => {
    const proc = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", file],
      { windowsHide: true }
    );
    const output: string[] = [];
    const push = (buf: Buffer) => {
      for (const line of buf.toString("utf8").split(/\r?\n/)) {
        if (line.trim()) {
          output.push(line);
          onLine(line);
        }
      }
    };
    proc.stdout.on("data", push);
    proc.stderr.on("data", push);
    const timeout = setTimeout(() => proc.kill(), 15 * 60 * 1000);
    proc.on("close", async (code) => {
      clearTimeout(timeout);
      fs.unlink(file).catch(() => {});
      resolve({
        ok: code === 0,
        output,
        durationMs: Date.now() - startedAt,
        simulated: false,
        error: code === 0 ? undefined : `exit code ${code}`,
      });
    });
    proc.on("error", (err) => {
      clearTimeout(timeout);
      resolve({
        ok: false,
        output,
        durationMs: Date.now() - startedAt,
        simulated: false,
        error: err.message,
      });
    });
  });
}
