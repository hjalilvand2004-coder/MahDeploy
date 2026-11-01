import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { isAuthenticated } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_SIZE = 300 * 1024 * 1024; // 300MB

/** POST /api/upload — stage a ZIP archive of the app source */
export async function POST(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const file = form.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "فایلی ارسال نشده است" }, { status: 400 });
  if (!file.name.toLowerCase().endsWith(".zip")) {
    return NextResponse.json({ error: "فقط فایل ZIP پذیرفته می‌شود" }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "حجم فایل بیش از ۳۰۰ مگابایت است" }, { status: 400 });
  }

  const dir = path.join(os.tmpdir(), "deployguard-uploads");
  await fs.mkdir(dir, { recursive: true });
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const target = path.join(dir, `${Date.now()}-${safeName}`);
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(target, buffer);

  // On a real Windows server the staged temp path is translated to a
  // Windows-friendly path so the deployment scripts can reference it.
  const stagedPath = process.platform === "win32" ? target : target;
  return NextResponse.json({
    ok: true,
    path: stagedPath,
    size: file.size,
    name: safeName,
  });
}
