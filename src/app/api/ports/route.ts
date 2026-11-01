import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { getPortUsage } from "@/lib/metrics";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const deployments = await db.deployment.findMany({
    where: { status: { in: ["active", "deploying", "planned"] } },
    select: { name: true, displayName: true, domain: true, backendPort: true, status: true },
  });
  const ports = await getPortUsage(
    deployments.map((d) => ({
      name: d.name,
      domain: d.domain,
      backendPort: d.backendPort,
      status: d.status,
    }))
  );
  return NextResponse.json({
    ports,
    deployments: deployments.map((d) => ({
      name: d.name,
      displayName: d.displayName,
      domain: d.domain,
      port: d.backendPort,
      status: d.status,
    })),
  });
}
