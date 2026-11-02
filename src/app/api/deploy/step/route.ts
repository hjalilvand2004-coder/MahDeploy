import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { db } from "@/lib/db";
import { executeStep } from "@/lib/executor";
import { analyzeFailure } from "@/lib/failure-analysis";
import type { DeployConfig, StepState } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** POST /api/deploy/step — run ONE step of a planned deployment run */
export async function POST(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const runId = String(body.runId ?? "");
  const stepIndex = Number(body.stepIndex);

  const run = await db.deployRun.findUnique({ where: { id: runId }, include: { deployment: true } });
  if (!run) return NextResponse.json({ error: "run not found" }, { status: 404 });

  const steps: StepState[] = JSON.parse(run.steps);
  const scripts: { id: string; content: string }[] = JSON.parse(run.scripts);
  if (stepIndex < 0 || stepIndex >= steps.length) {
    return NextResponse.json({ error: "stepIndex نامعتبر" }, { status: 400 });
  }
  if (steps[stepIndex].status === "success") {
    return NextResponse.json({ step: steps[stepIndex], done: stepIndex === steps.length - 1 });
  }

  const deployment = run.deployment;
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

  // mark running
  steps[stepIndex].status = "running";
  steps[stepIndex].startedAt = Date.now();
  steps[stepIndex].output = [];
  await db.deployRun.update({ where: { id: run.id }, data: { steps: JSON.stringify(steps), status: "running" } });
  await db.deployment.update({ where: { id: deployment.id }, data: { status: "deploying", statusDetail: steps[stepIndex].title } });

  const script = scripts.find((s) => s.id === steps[stepIndex].scriptId);
  if (!script) {
    steps[stepIndex].status = "failed";
    await db.deployRun.update({ where: { id: run.id }, data: { steps: JSON.stringify(steps), status: "failed" } });
    return NextResponse.json({ error: "script not found for step" }, { status: 500 });
  }

  const result = await executeStep(steps[stepIndex].id, script.content, cfg, (line) => {
    steps[stepIndex].output.push(line);
  });
  steps[stepIndex].output = result.output;
  steps[stepIndex].durationMs = result.durationMs;
  steps[stepIndex].status = result.ok ? "success" : "failed";
  if (!result.ok) {
    // attach an automatic cause + suggested fixes so the operator can trace the failure
    steps[stepIndex].analysis = analyzeFailure(result.output, result.error);
  }

  const allDone = steps.every((s) => s.status === "success");
  const anyFailed = steps.some((s) => s.status === "failed");

  await db.deployRun.update({
    where: { id: run.id },
    data: { steps: JSON.stringify(steps), status: allDone ? "success" : anyFailed ? "failed" : "running" },
  });

  // keep staged release rows in sync with the update plan progress
  if (run.kind === "update") {
    const release = await db.release.findFirst({ where: { runId: run.id } });
    if (release) {
      const stepId = steps[stepIndex].id;
      if (allDone) {
        await db.release.update({ where: { id: release.id }, data: { status: "active" } });
        await db.release.updateMany({
          where: { deploymentId: deployment.id, id: { not: release.id }, status: "active" },
          data: { status: "previous" },
        });
      } else if (anyFailed && (stepId === "update-switch" || stepId === "update-verify")) {
        await db.release.update({ where: { id: release.id }, data: { status: "failed" } });
      } else if (!anyFailed) {
        await db.release.update({ where: { id: release.id }, data: { status: "staged" } });
      }
    }
  }

  await db.deployment.update({
    where: { id: deployment.id },
    data: {
      status: allDone ? "active" : anyFailed ? "failed" : "deploying",
      statusDetail: allDone ? null : anyFailed ? `نقص در مرحله: ${steps[stepIndex].title}` : steps[stepIndex].title,
      lastDeployedAt: allDone ? new Date() : deployment.lastDeployedAt,
    },
  });

  await db.logEntry.create({
    data: {
      deploymentId: deployment.id,
      level: result.ok ? "success" : "error",
      step: steps[stepIndex].id,
      message: result.ok
        ? `مرحله «${steps[stepIndex].title}» در ${(result.durationMs / 1000).toFixed(1)} ثانیه با موفقیت اجرا شد`
        : `مرحله «${steps[stepIndex].title}» ناموفق بود: ${steps[stepIndex].analysis?.cause ?? result.error ?? "خطای نامشخص"}`,
    },
  });

  return NextResponse.json({
    step: steps[stepIndex],
    done: allDone,
    failed: anyFailed,
    simulated: result.simulated,
  });
}
