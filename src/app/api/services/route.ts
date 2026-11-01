import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { db } from "@/lib/db";
import { SIMULATION } from "@/lib/types";
import { probePortListening } from "@/lib/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/services — quick service-control list:
 *  every non-removed deployment with its backend port, saved status and a
 *  live «is the port actually listening right now» probe. */
export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const deployments = await db.deployment.findMany({
    where: { status: { not: "removed" } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, name: true, displayName: true, domain: true,
      backendPort: true, status: true, lastDeployedAt: true,
    },
  });

  const services = await Promise.all(
    deployments.map(async (d) => {
      // planned = plan generated but nothing installed yet → probe is meaningless
      const listening =
        d.status === "planned" ? null : SIMULATION ? d.status === "active" : await probePortListening(d.backendPort);
      return {
        id: d.id,
        name: d.name,
        displayName: d.displayName,
        domain: d.domain,
        backendPort: d.backendPort,
        status: d.status,
        lastDeployedAt: d.lastDeployedAt,
        listening,
      };
    })
  );

  return NextResponse.json({ services });
}
