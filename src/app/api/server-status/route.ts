import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { getServerStatus } from "@/lib/metrics";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const status = await getServerStatus();
  const activeDeployments = await db.deployment.count({ where: { status: "active" } });
  return NextResponse.json({ ...status, activeDeployments });
}
