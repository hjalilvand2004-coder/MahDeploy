import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { db } from "@/lib/db";
import { generateDeployScripts, DEPLOY_STEPS } from "@/lib/scripts";
import type { DeployConfig } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/deploy/plan — build the full PowerShell plan for a deployment */
export async function POST(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "bad request" }, { status: 400 });

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
  };

  // create/update the deployment record
  const existing = await db.deployment.findUnique({ where: { name } });
  const deployment = existing
    ? await db.deployment.update({ where: { name }, data: { ...cfg, status: "planned", statusDetail: null } })
    : await db.deployment.create({ data: { ...cfg, status: "planned" } });

  const scripts = generateDeployScripts(cfg);
  const steps = DEPLOY_STEPS.map((s) => ({
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
      kind: "deploy",
      scripts: JSON.stringify(scripts),
      steps: JSON.stringify(steps),
      status: "planned",
    },
  });

  await db.logEntry.create({
    data: {
      deploymentId: deployment.id,
      level: "info",
      step: "plan",
      message: `پلن استقرار «${displayName}» روی ${domain}:${backendPort} تولید شد (${scripts.length} اسکریپت PowerShell)`,
    },
  });

  return NextResponse.json({ deploymentId: deployment.id, runId: run.id, scripts, steps, cfg });
}
