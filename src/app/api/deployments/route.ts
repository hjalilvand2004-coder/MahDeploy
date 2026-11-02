import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { db } from "@/lib/db";
import { executeStep } from "@/lib/executor";
import {
  generateServiceActionScript,
  generateUninstallScript,
  generateRollbackScript,
  generateLogRotateScript,
} from "@/lib/scripts";
import { analyzeFailure } from "@/lib/failure-analysis";
import type { DeployConfig } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function toCfg(d: {
  name: string; displayName: string; domain: string; backendPort: number;
  sourceType: string; sourcePath: string | null; deployBase: string; deployPath: string;
  sslCertPath: string; sslKeyPath: string; nginxPath: string;
  uploadLimitMb: number; proxyTimeoutSec: number; blockDocs: boolean;
}): DeployConfig {
  return {
    name: d.name, displayName: d.displayName, domain: d.domain, backendPort: d.backendPort,
    sourceType: d.sourceType as "path" | "zip", sourcePath: d.sourcePath ?? "",
    deployBase: d.deployBase, deployPath: d.deployPath,
    sslCertPath: d.sslCertPath, sslKeyPath: d.sslKeyPath, nginxPath: d.nginxPath,
    uploadLimitMb: d.uploadLimitMb, proxyTimeoutSec: d.proxyTimeoutSec, blockDocs: d.blockDocs,
  };
}

/** GET /api/deployments — list all deployments with latest run + active release */
export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const deployments = await db.deployment.findMany({
    where: { status: { not: "removed" } },
    orderBy: { createdAt: "desc" },
    include: {
      runs: { orderBy: { createdAt: "desc" }, take: 1 },
      releases: { orderBy: { createdAt: "desc" } },
    },
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
      deployBase: d.deployBase,
      deployPath: d.deployPath,
      sslCertPath: d.sslCertPath,
      sslKeyPath: d.sslKeyPath,
      nginxPath: d.nginxPath,
      uploadLimitMb: d.uploadLimitMb,
      proxyTimeoutSec: d.proxyTimeoutSec,
      blockDocs: d.blockDocs,
      status: d.status,
      statusDetail: d.statusDetail,
      lastDeployedAt: d.lastDeployedAt,
      createdAt: d.createdAt,
      lastRunId: d.runs[0]?.id ?? null,
      lastRunStatus: d.runs[0]?.status ?? null,
      lastRunKind: d.runs[0]?.kind ?? null,
      activeReleaseTag: d.releases.find((r) => r.status === "active")?.tag ?? null,
      releaseCount: d.releases.length,
    })),
  });
}

/** POST /api/deployments — actions: start/stop/restart/remove/rollback/log-rotate */
export async function POST(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const action = body.action as "start" | "stop" | "restart" | "remove" | "rollback" | "log-rotate";
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
          : `دستور ${action} روی سرویس deployguard-${deployment.name} ناموفق بود: ${analyzeFailure(result.output, result.error).cause}`,
      },
    });
    return NextResponse.json({ ok: result.ok, output: result.output, status: newStatus, simulated: result.simulated });
  }

  if (action === "log-rotate") {
    const script = generateLogRotateScript(cfg);
    const result = await executeStep("log-rotate", script, cfg, () => {});
    await db.logEntry.create({
      data: {
        deploymentId: id,
        level: result.ok ? "success" : "error",
        step: "log-rotate",
        message: result.ok
          ? `چرخش لاگ‌های «${deployment.displayName}» انجام شد — لاگ‌های قدیمی آرشیو شدند`
          : `چرخش لاگ‌ها ناموفق بود: ${analyzeFailure(result.output, result.error).cause}`,
      },
    });
    return NextResponse.json({ ok: result.ok, output: result.output, simulated: result.simulated });
  }

  if (action === "rollback") {
    const tag = String(body.tag ?? "");
    if (!tag) return NextResponse.json({ error: "tag الزامی است" }, { status: 400 });
    const target = await db.release.findFirst({ where: { deploymentId: id, tag } });
    if (!target) return NextResponse.json({ error: "نسخهٔ مورد نظر یافت نشد" }, { status: 404 });

    const script = generateRollbackScript(cfg, tag);
    const result = await executeStep(`rollback-${tag}`, script, cfg, () => {});
    const analysis = result.ok ? null : analyzeFailure(result.output, result.error);

    if (result.ok) {
      await db.release.update({ where: { id: target.id }, data: { status: "active" } });
      await db.release.updateMany({
        where: { deploymentId: id, id: { not: target.id }, status: "active" },
        data: { status: "previous" },
      });
    }
    await db.deployment.update({
      where: { id },
      data: { status: result.ok ? "active" : "failed", statusDetail: result.ok ? null : "بازگشت به نسخهٔ قبلی ناموفق بود" },
    });
    await db.logEntry.create({
      data: {
        deploymentId: id,
        level: result.ok ? "success" : "error",
        step: "rollback",
        message: result.ok
          ? `«${deployment.displayName}» به نسخهٔ ${tag} بازگشت — نسخهٔ قبلی برای بازگشت مجدد حفظ می‌شود (تغییرات دیتابیس خودکار برنمی‌گردد)`
          : `بازگشت به نسخهٔ ${tag} ناموفق بود: ${analysis?.cause ?? "خطای نامشخص"}`,
      },
    });
    return NextResponse.json({ ok: result.ok, output: result.output, analysis, simulated: result.simulated });
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
