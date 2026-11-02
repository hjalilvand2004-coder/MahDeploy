import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { db } from "@/lib/db";
import { generateDeployScripts, generateUpdateScripts, DEPLOY_STEPS, UPDATE_STEPS } from "@/lib/scripts";
import type { DeployConfig } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/deploy/plan — build the full PowerShell plan for a deployment
 *  body.kind = "deploy" (initial install) | "update" (new version for an existing deployment) */
export async function POST(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "bad request" }, { status: 400 });

  const kind = body.kind === "update" ? "update" : "deploy";
  const name = String(body.name ?? "").toLowerCase().trim();
  const displayName = String(body.displayName ?? name).trim();
  const domain = String(body.domain ?? "").toLowerCase().trim();
  const backendPort = Number(body.backendPort);
  const sourceType = body.sourceType === "zip" ? "zip" : "path";
  const sourcePath = String(body.sourcePath ?? "").trim();
  const deployBase = String(body.deployBase ?? "C:\\deployments").replace(/[\\/]+$/, "");
  const sslCertPath = String(body.sslCertPath ?? "").trim();
  const sslKeyPath = String(body.sslKeyPath ?? "").trim();
  const nginxPath = String(body.nginxPath ?? "C:\\nginx").replace(/[\\/]+$/, "");
  const uploadLimitMb = [10, 25, 50, 100, 200, 500].includes(Number(body.uploadLimitMb)) ? Number(body.uploadLimitMb) : 100;
  const proxyTimeoutSec = [60, 120, 300, 600].includes(Number(body.proxyTimeoutSec)) ? Number(body.proxyTimeoutSec) : 120;
  const blockDocs = body.blockDocs === true;

  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(name)) {
    return NextResponse.json({ error: "نام سامانه معتبر نیست (حروف انگلیسی کوچک، عدد، خط تیره)" }, { status: 400 });
  }
  if (!domain || !backendPort || !sourcePath || !sslCertPath || !sslKeyPath) {
    return NextResponse.json({ error: "همه فیلدهای الزامی را تکمیل کنید" }, { status: 400 });
  }

  const cfg: DeployConfig = {
    name,
    displayName,
    domain,
    backendPort,
    sourceType,
    sourcePath,
    deployBase,
    deployPath: `${deployBase}\\${name}`,
    sslCertPath,
    sslKeyPath,
    nginxPath,
    uploadLimitMb,
    proxyTimeoutSec,
    blockDocs,
  };

  const stepsMeta = kind === "update" ? UPDATE_STEPS : DEPLOY_STEPS;

  // create/update the deployment record (update plans reuse the stored record)
  const existing = await db.deployment.findUnique({ where: { name } });
  const deployment = existing
    ? await db.deployment.update({
        where: { name },
        data: {
          ...cfg,
          status: "planned",
          statusDetail: null,
          // keep the last successful source when only updating
          sourceType: kind === "update" ? sourceType : existing.sourceType,
          sourcePath: kind === "update" ? sourcePath : existing.sourcePath,
        },
      })
    : await db.deployment.create({ data: { ...cfg, status: "planned" } });

  const updateTag = kind === "update" ? tagFor() : null;
  const scripts = kind === "update" ? generateUpdateScripts(cfg, updateTag!) : generateDeployScripts(cfg);
  const steps = stepsMeta.map((s) => ({
    id: s.id,
    scriptId: s.scriptId,
    title: s.title,
    status: "pending" as const,
    output: [] as string[],
    durationMs: 0,
  }));

  const run = await db.deployRun.create({
    data: {
      deploymentId: deployment.id,
      kind,
      scripts: JSON.stringify(scripts),
      steps: JSON.stringify(steps),
      status: "planned",
    },
  });

  if (kind === "update" && updateTag) {
    await db.release.create({
      data: {
        deploymentId: deployment.id,
        tag: updateTag,
        path: `${cfg.deployPath}\\releases\\${updateTag}`,
        status: "staged",
        runId: run.id,
        note: `منبع: ${sourceType === "zip" ? "آپلود ZIP" : sourcePath}`,
      },
    });
  }

  await db.logEntry.create({
    data: {
      deploymentId: deployment.id,
      level: "info",
      step: "plan",
      message:
        kind === "update"
          ? `پلن به‌روزرسانی «${displayName}» تولید شد (${scripts.length} اسکریپت) — نسخه فعلی تا سوییچ نهایی فعال می‌ماند`
          : `پلن استقرار «${displayName}» روی ${domain}:${backendPort} تولید شد (${scripts.length} اسکریپت PowerShell)`,
    },
  });

  return NextResponse.json({ deploymentId: deployment.id, runId: run.id, kind, scripts, steps, cfg });
}

function tagFor(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
