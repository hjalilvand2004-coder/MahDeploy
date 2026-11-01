import { NextRequest, NextResponse } from "next/server";
import {
  changePassword,
  createSessionToken,
  isAuthenticated,
  SESSION_COOKIE,
  verifyPassword,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { SIMULATION } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/auth — login / logout / change password */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const action = body.action as "login" | "logout" | "change";

  if (action === "login") {
    const ok = await verifyPassword(String(body.password ?? ""));
    if (!ok) {
      return NextResponse.json({ ok: false, error: "رمز عبور نادرست است" }, { status: 401 });
    }
    const token = await createSessionToken();
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 12,
    });
    await db.logEntry.create({
      data: { level: "info", step: "auth", message: "ورود موفق ادمین به پنل" },
    });
    return res;
  }

  if (action === "logout") {
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
    return res;
  }

  if (action === "change") {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ ok: false, error: "ابتدا وارد شوید" }, { status: 401 });
    }
    const result = await changePassword(String(body.current ?? ""), String(body.next ?? ""));
    if (!result.ok) return NextResponse.json(result, { status: 400 });
    await db.logEntry.create({
      data: { level: "info", step: "auth", message: "رمز عبور ادمین تغییر کرد" },
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: false, error: "action نامعتبر" }, { status: 400 });
}

/** GET /api/auth — session state + panel mode (non-sensitive) */
export async function GET() {
  return NextResponse.json({
    authenticated: await isAuthenticated(),
    mode: SIMULATION ? "simulation" : "live",
  });
}
