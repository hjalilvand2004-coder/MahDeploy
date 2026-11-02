import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { isAuthenticated } from "@/lib/auth";
import { db } from "@/lib/db";
import { generateNginxConf } from "@/lib/scripts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/runs/[id] — full run detail (scripts + steps) for the viewer */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const run = await db.deployRun.findUnique({ where: { id }, include: { deployment: true } });
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });

  const d = run.deployment;
  const conf = generateNginxConf({
    name: d.name,
    displayName: d.displayName,
    domain: d.domain,
    backendPort: d.backendPort,
    sourceType: d.sourceType as "path" | "zip",
    sourcePath: d.sourcePath ?? "",
    deployBase: d.deployBase,
    deployPath: d.deployPath,
    sslCertPath: d.sslCertPath,
    sslKeyPath: d.sslKeyPath,
    nginxPath: d.nginxPath,
    uploadLimitMb: d.uploadLimitMb,
    proxyTimeoutSec: d.proxyTimeoutSec,
    blockDocs: d.blockDocs,
  });

  return NextResponse.json({
    id: run.id,
    kind: run.kind,
    status: run.status,
    scripts: JSON.parse(run.scripts),
    steps: JSON.parse(run.steps),
    deployment: {
      id: d.id,
      name: d.name,
      displayName: d.displayName,
      domain: d.domain,
      backendPort: d.backendPort,
      deployPath: d.deployPath,
      nginxPath: d.nginxPath,
      status: d.status,
    },
    nginxConf: conf,
  });
}
