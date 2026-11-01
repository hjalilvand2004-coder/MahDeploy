import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { db } from "@/lib/db";
import { generateNginxConf } from "@/lib/scripts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/deployments/[id]/nginx-conf — regenerate & return the nginx site config */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const d = await db.deployment.findUnique({ where: { id } });
  if (!d) return NextResponse.json({ error: "not found" }, { status: 404 });

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
  });
  return NextResponse.json({
    conf,
    path: `${d.nginxPath}\\conf\\conf.d\\${d.name}.conf`,
    domain: d.domain,
    backendPort: d.backendPort,
  });
}
