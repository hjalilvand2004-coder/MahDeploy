import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { db } from "@/lib/db";
import { executeStep } from "@/lib/executor";
import { generateHealthScript } from "@/lib/scripts";
import type { DeployConfig, HealthLevel, HealthReport, HealthStatus } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const TITLES: Record<string, string> = {
  service: "سرویس ویندوز",
  backend: "بک‌اند (پورت بک‌اند / health)",
  database: "دیتابیس و وابستگی‌های ضروری",
  nginx: "Nginx و کانفیگ دامنه",
  https: "دسترسی HTTPS از مسیر دامنه",
  disk: "فضای دیسک",
  ssl: "گواهی SSL (انقضا)",
  logs: "حجم لاگ‌ها",
};

function parseReport(output: string[], simulated: boolean): HealthReport {
  const levels: HealthLevel[] = [];
  for (const line of output) {
    const m = line.match(/^\[CHECK\]\s+(\S+)\s+\|\s+(ok|warn|fail|unknown)\s+\|\s+(.*)$/i);
    if (!m) continue;
    const [, key, status, detail] = m;
    levels.push({
      key,
      title: TITLES[key] ?? key,
      status: status.toLowerCase() as HealthStatus,
      detail: detail.trim(),
    });
  }
  // any [WARN] line outside [CHECK] is a free-form warning
  const warnings = output
    .filter((l) => l.includes("[WARN]") && !l.startsWith("[CHECK]"))
    .slice(0, 6)
    .map((l, i) => ({ key: `w${i}`, title: "هشدار", detail: l.replace(/^\[WARN\]\s*/i, "").trim() }));
  const hasFail = levels.some((l) => l.status === "fail");
  const hasOk = levels.some((l) => l.status === "ok");
  return {
    levels,
    warnings,
    healthy: hasOk && !hasFail,
    simulated,
    checkedAt: new Date().toISOString(),
  };
}

/** POST /api/health — run the multi-level health check for one deployment */
export async function POST(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const id = String(body.id ?? "");
  const deployment = await db.deployment.findUnique({ where: { id } });
  if (!deployment) return NextResponse.json({ error: "deployment not found" }, { status: 404 });

  const cfg: DeployConfig = {
    name: deployment.name,
    displayName: deployment.displayName,
    domain: deployment.domain,
    backendPort: deployment.backendPort,
    sourceType: deployment.sourceType as "path" | "zip",
    sourcePath: deployment.sourcePath ?? "",
    deployBase: deployment.deployBase,
    deployPath: deployment.deployPath,
    sslCertPath: deployment.sslCertPath,
    sslKeyPath: deployment.sslKeyPath,
    nginxPath: deployment.nginxPath,
    uploadLimitMb: deployment.uploadLimitMb,
    proxyTimeoutSec: deployment.proxyTimeoutSec,
    blockDocs: deployment.blockDocs,
  };

  const script = generateHealthScript(cfg);
  const result = await executeStep("health", script, cfg, () => {});
  const report = parseReport(result.output, result.simulated);

  await db.logEntry.create({
    data: {
      deploymentId: deployment.id,
      level: report.healthy ? "success" : result.ok ? "info" : "error",
      step: "health",
      message: report.healthy
        ? `بررسی سلامت «${deployment.displayName}»: همه سطوح سالم`
        : `بررسی سلامت «${deployment.displayName}»: نیاز به توجه (${report.levels.filter((l) => l.status === "fail").length} مورد خراب / ${report.levels.filter((l) => l.status === "warn").length} هشدار)`,
    },
  });

  return NextResponse.json({ report, output: result.output });
}
