import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { db } from "@/lib/db";
import { cookies } from "next/headers";

const SESSION_COOKIE = "dg_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12h

async function getSetting(key: string): Promise<string | null> {
  const row = await db.setting.findUnique({ where: { key } });
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string) {
  await db.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
}

function hashPassword(password: string, salt?: string) {
  const s = salt ?? randomBytes(16).toString("hex");
  const hash = scryptSync(password, s, 64).toString("hex");
  return `${s}:${hash}`;
}

export async function ensureInitialized() {
  const existing = await getSetting("admin_password");
  if (!existing) {
    await setSetting("admin_password", hashPassword("admin1234"));
  }
  let secret = await getSetting("session_secret");
  if (!secret) {
    secret = randomBytes(32).toString("hex");
    await setSetting("session_secret", secret);
  }
}

export async function verifyPassword(password: string): Promise<boolean> {
  await ensureInitialized();
  const stored = await getSetting("admin_password");
  if (!stored) return false;
  const [salt, hash] = stored.split(":");
  const candidate = scryptSync(password, salt, 64).toString("hex");
  try {
    return timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(candidate, "hex"));
  } catch {
    return false;
  }
}

export async function changePassword(current: string, next: string): Promise<{ ok: boolean; error?: string }> {
  if (!(await verifyPassword(current))) return { ok: false, error: "رمز فعلی نادرست است" };
  if (next.length < 8) return { ok: false, error: "رمز جدید باید حداقل ۸ کاراکتر باشد" };
  await setSetting("admin_password", hashPassword(next));
  return { ok: true };
}

function sign(payload: string): string {
  // secret fetched synchronously is not possible; we cache it lazily
  return createHmac("sha256", cachedSecret ?? "fallback").update(payload).digest("hex");
}

let cachedSecret: string | null = null;

export async function loadSecret() {
  await ensureInitialized();
  cachedSecret = (await getSetting("session_secret")) ?? "fallback";
}

export async function createSessionToken(): Promise<string> {
  await loadSecret();
  const payload = JSON.stringify({ exp: Date.now() + SESSION_TTL_MS, jti: randomBytes(8).toString("hex") });
  const b64 = Buffer.from(payload).toString("base64url");
  return `${b64}.${sign(b64)}`;
}

export async function isValidSessionToken(token: string | undefined | null): Promise<boolean> {
  if (!token) return false;
  const [b64, sig] = token.split(".");
  if (!b64 || !sig) return false;
  if (!cachedSecret) await loadSecret();
  const expected = sign(b64);
  try {
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  } catch {
    return false;
  }
  try {
    const payload = JSON.parse(Buffer.from(b64, "base64url").toString());
    return typeof payload.exp === "number" && payload.exp > Date.now();
  } catch {
    return false;
  }
}

export async function isAuthenticated(): Promise<boolean> {
  const store = await cookies();
  return isValidSessionToken(store.get(SESSION_COOKIE)?.value);
}

export { SESSION_COOKIE };
