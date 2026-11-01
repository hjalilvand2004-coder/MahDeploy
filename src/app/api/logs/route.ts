import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/logs — recent event feed */
export async function GET(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 30), 100);
  const logs = await db.logEntry.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { deployment: { select: { displayName: true, domain: true } } },
  });
  return NextResponse.json({ logs });
}
