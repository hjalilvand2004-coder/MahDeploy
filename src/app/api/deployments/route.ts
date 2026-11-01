import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { db } from "@/lib/db";
import { executeStep } from "@/lib/executor";
import { generateServiceActionScript, generateUninstallScript } from "@/lib/scripts";
import type { DeployConfig } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function toCfg(d: {
  name: string; displayName: string; domain: string; backendPort: number;
  sourceType: string; sourcePath: string | null; deployBase: string; deployPath: string;
  sslCertPath: string; sslKeyPath: string; nginxPath: string;
}): DeployConfig {
  return {
    name: d.name, displayName: d.displayName, domain: d.domain, backendPort: d.backendPort,
    sourceType: d.sourceType as "path" | "zip", sourcePath: d.sourcePath ?? "",
    deployBase: d.deployBase, deployPath: d.deployPath,
    sslCertPath: d.sslCertPath, sslKeyPath: d.sslKeyPath, nginxPath: d.nginxPath,
  };
}

/** GET /api/deployments — list all deployments with latest run */
export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const deployments = await db.deployment.findMany({
    where: { status: { not: "removed" } },
    orderBy: { createdAt: "desc" },
    include: { runs: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  return NextResponse.json({
    deployments: deployments.map((d) => ({
      id: d.id,
      name: d.name,
      displayName: d.displayName,
      domain: d.domain,
      backendPort: d.backendPort,
      sourceType: d.sourceType,
      sourcePath: d.sourcePath,
      deployPath: d.deployPath,
      sslCertPath: d.sslCertPath,
      sslKeyPath: d.sslKeyPath,
      nginxPath: d.nginxPath,
      status: d.status,
      statusDetail: d.statusDetail,
      lastDeployedAt: d.lastDeployedAt,
      createdAt: d.createdAt,
      lastRunId: d.runs[0]?.id ?? null,
      lastRunStatus: d.runs[0]?.status ?? null,
    })),
  });
}

/** POST /api/deployments — service actions: start/stop/restart/remove */
export async function POST(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const action = body.action as "start" | "stop" | "restart" | "remove";
  const id = String(body.id ?? "");
  const deployment = await db.deployment.findUnique({ where: { id } });
  if (!deployment) return NextResponse.json({ error: "deployment not found" }, { status: 404 });

  const cfg = toCfg(deployment);

  if (action === "start" || action === "stop" || action === "restart") {
    const script = generateServiceActionScript(cfg, action);
    const result = await executeStep(`service-${action}`, script, cfg, () => {});
    const newStatus = !result.ok
      ? deployment.status
      : action === "stop"
        ? "stopped"
        : "active";
    await db.deployment.update({ where: { id }, data: { status: newStatus } });
    await db.logEntry.create({
      data: {
        deploymentId: id,
        level: result.ok ? "success" : "error",
        step: `service-${action}`,
        message: result.ok
          ? `سرویس deployguard-${deployment.name} با دستور ${action} مدیریت شد`
          : `دستور ${action} روی سرویس deployguard-${deployment.name} ناموفق بود`,
      },
    });
    return NextResponse.json({ ok: result.ok, output: result.output, status: newStatus, simulated: result.simulated });
  }

  if (action === "remove") {
    const script = generateUninstallScript(cfg);
    const result = await executeStep("uninstall", script, cfg, () => {});
    await db.deployment.update({
      where: { id },
      data: { status: "removed", statusDetail: result.ok ? null : "حذف با خطا مواجه شد — پوشه/سرویس را دستی بررسی کنید" },
    });
    await db.logEntry.create({
      data: {
        deploymentId: id,
        level: result.ok ? "success" : "error",
        step: "uninstall",
        message: result.ok
          ? `سامانه «${deployment.displayName}» به‌طور کامل حذف شد (سرویس + کانفیگ nginx + پوشه با آرشیو لاگ‌ها)`
          : `حذف «${deployment.displayName}» با خطا مواجه شد`,
      },
    });
    return NextResponse.json({ ok: result.ok, output: result.output, simulated: result.simulated });
  }

  return NextResponse.json({ error: "action نامعتبر" }, { status: 400 });
}
