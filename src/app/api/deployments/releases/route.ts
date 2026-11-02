import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { isAuthenticated } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ReleaseRow {
  tag: string;
  path: string;
  status: string;
  createdAt: string;
  note: string | null;
  onDisk: boolean;
  hasWww: boolean;
  isMarker: boolean;
}

/** GET /api/deployments/releases?id=<deploymentId>
 *  version history for one deployment: DB rows merged with the on-disk releases folder */
export async function GET(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const id = req.nextUrl.searchParams.get("id") ?? "";
  const deployment = await db.deployment.findUnique({ where: { id } });
  if (!deployment) return NextResponse.json({ error: "deployment not found" }, { status: 404 });

  const rows = await db.release.findMany({
    where: { deploymentId: id },
    orderBy: { createdAt: "desc" },
  });

  // active marker from disk (source of truth after a manual switch)
  let markerTag: string | null = null;
  try {
    const marker = await fs.readFile(path.join(deployment.deployPath, "releases", ".active"), "utf8");
    markerTag = marker.trim() || null;
  } catch {
    /* no marker yet (legacy root layout) */
  }

  const releases: ReleaseRow[] = [];
  for (const r of rows) {
    let onDisk = false;
    let hasWww = false;
    try {
      await fs.access(path.join(r.path, "backend"));
      onDisk = true;
      try {
        await fs.access(path.join(r.path, "www", "index.html"));
        hasWww = true;
      } catch {}
    } catch {}
    const status = markerTag && r.tag === markerTag && r.status !== "failed" ? "active" : r.status;
    releases.push({
      tag: r.tag,
      path: r.path,
      status,
      createdAt: r.createdAt.toISOString(),
      note: r.note,
      onDisk,
      hasWww,
      isMarker: markerTag === r.tag,
    });
  }

  return NextResponse.json({
    releases,
    markerTag,
    legacy: !markerTag,
    note: !markerTag
      ? "نسخهٔ فعال فعلی در ریشهٔ پوشهٔ استقرار است (چیدمان قدیمی) — با نخستین به‌روزرسانی، چیدمان releases فعال می‌شود"
      : null,
  });
}
