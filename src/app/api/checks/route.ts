import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import dns from "dns/promises";
import net from "net";
import os from "os";
import { X509Certificate } from "crypto";
import { isAuthenticated } from "@/lib/auth";
import { db } from "@/lib/db";
import { SIMULATION, type CheckResult } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function check(key: string, title: string, status: CheckResult["status"], message: string, detail?: string): CheckResult {
  return { key, title, status, message, detail };
}

async function bindTest(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(port, "127.0.0.1");
  });
}

/** identify the process holding a listening port (Windows only, best-effort) */
async function portOwner(port: number): Promise<{ name: string; pid: number; service: string } | null> {
  if (process.platform !== "win32") return null;
  try {
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const script = [
      `$c = Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -First 1`,
      "if (-not $c) { exit 0 }",
      "$p = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue",
      "$s = Get-CimInstance Win32_Service -Filter ('ProcessId=' + $c.OwningProcess) -ErrorAction SilentlyContinue",
      '"{0}|{1}|{2}" -f $p.ProcessName, $c.OwningProcess, $s.Name',
    ].join("; ");
    const { stdout } = await promisify(execFile)("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { timeout: 8000 });
    const [name, pid, service] = stdout.trim().split("|");
    if (!name) return null;
    return { name, pid: Number(pid) || 0, service: service || "" };
  } catch {
    return null;
  }
}

async function checkDomain(domain: string, soft = false): Promise<CheckResult> {
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(domain)) {
    return check("domain", "اعتبارسنجی دامنه", "fail", "قالب دامنه معتبر نیست", domain);
  }
  try {
    const addrs = await dns.resolve4(domain);
    const locals = Object.values(os.networkInterfaces())
      .flat()
      .filter((i) => i && i.family === "IPv4")
      .map((i) => i!.address);
    const pointsHere = addrs.some((a) => locals.includes(a));
    return check(
      "domain",
      "رزولوشن DNS دامنه",
      "ok",
      `${domain} → ${addrs.join(" ، ")}`,
      pointsHere ? "دامنه به این سرور اشاره می‌کند ✓" : SIMULATION ? "در سرور واقعی باید به IP همین سرور اشاره کند" : undefined
    );
  } catch {
    return check(
      "domain",
      "رزولوشن DNS دامنه",
      soft ? "warn" : "fail",
      `رکورد A برای ${domain} پیدا نشد — در DNS دامنه، این زیردامنه را به IP سرور اشاره دهید`,
      soft ? "استقرار می‌تواند انجام شود؛ تا زمان تنظیم DNS، دسترسی از مرورگر ممکن نیست" : undefined
    );
  }
}

async function checkPort(port: number, currentName?: string): Promise<CheckResult[]> {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    return [check("port", "اعتبارسنجی پورت", "fail", "پورت باید عددی بین ۱۰۲۴ تا ۶۵۵۳۵ باشد")];
  }
  const reserved = [80, 443, 3389, 3000];
  if (reserved.includes(port)) {
    return [check("port", "آزاد بودن پورت", "fail", `پورت ${port} رزرو شده است (پورت‌های سیستمی/Nginx/پنل)`)];
  }
  const conflict = await db.deployment.findFirst({
    where: { backendPort: port, status: { not: "removed" }, ...(currentName ? { name: { not: currentName } } : {}) },
  });
  if (conflict) {
    return [
      check("port", "آزاد بودن پورت", "fail", `پورت ${port} توسط سامانه «${conflict.displayName}» (${conflict.domain}) اشغال شده است`),
    ];
  }
  const free = await bindTest(port);
  if (free) {
    return [check("port", "آزاد بودن پورت", "ok", `پورت ${port} آزاد است و در دسترس قرار گرفت`)];
  }
  const owner = await portOwner(port);
  const ownService =
    owner && currentName
      ? owner.service === `deployguard-${currentName}` || owner.name === `${currentName}-service`
      : false;
  if (ownService) {
    return [
      check(
        "port",
        "آزاد بودن پورت",
        "warn",
        `پورت ${port} در اختیار سرویس خودِ همین سامانه (deployguard-${currentName}) است — هنگام استقرار مجدد یا به‌روزرسانی مانعی ندارد؛ برنامه آن را متوقف و جایگزین می‌کند`
      ),
    ];
  }
  if (owner) {
    const svcPart = owner.service ? ` / سرویس «${owner.service}»` : "";
    return [
      check(
        "port",
        "آزاد بودن پورت",
        "fail",
        `پورت ${port} توسط پردازش «${owner.name}» (PID ${owner.pid})${svcPart} اشغال است — آن را متوقف کنید یا در گام ۲ پورت دیگری انتخاب کنید`
      ),
    ];
  }
  return [check("port", "آزاد بودن پورت", "fail", `پورت ${port} هم‌اکنون در این سرور اشغال است`)];
}

async function checkSsl(certPath: string, keyPath: string, domain?: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const ext = (p: string) => p.toLowerCase().split(".").pop() ?? "";

  if (!certPath || !keyPath) {
    return [check("ssl", "فایل‌های گواهی SSL", "fail", "مسیر فایل گواهی و کلید خصوصی هر دو الزامی است")];
  }

  const winStyle = /^[a-zA-Z]:[\\/]/.test(certPath) || /^[a-zA-Z]:[\\/]/.test(keyPath);
  const simMissing = SIMULATION && winStyle;

  let certData: Buffer | null = null;
  try {
    certData = await fs.readFile(certPath);
    results.push(check("ssl-cert", "فایل گواهی (CRT/PEM)", "ok", `گواهی در مسیر ${certPath} یافت شد`));
  } catch {
    results.push(
      simMissing
        ? check("ssl-cert", "فایل گواهی (CRT/PEM)", "ok", `${certPath} — در استقرار واقعی از همین مسیر خوانده و اعتبارسنجی می‌شود`, "حالت پیش‌نمایش: مسیر ویندوزی فرض‌شده معتبر")
        : check("ssl-cert", "فایل گواهی (CRT/PEM)", "fail", `فایل گواهی در مسیر ${certPath} یافت نشد`)
    );
  }
  try {
    const keyData = await fs.readFile(keyPath);
    results.push(
      check("ssl-key", "فایل کلید خصوصی (KEY)", "ok", `کلید در مسیر ${keyPath} یافت شد`, keyData.length > 0 ? undefined : "فایل خالی است")
    );
  } catch {
    results.push(
      simMissing
        ? check("ssl-key", "فایل کلید خصوصی (KEY)", "ok", `${keyPath} — در استقرار واقعی اعتبارسنجی می‌شود`, "حالت پیش‌نمایش: مسیر ویندوزی فرض‌شده معتبر")
        : check("ssl-key", "فایل کلید خصوصی (KEY)", "fail", `فایل کلید در مسیر ${keyPath} یافت نشد`)
    );
  }

  if (!certData && simMissing) {
    const daysLeft = 214 + (domain?.length ?? 0) % 90;
    results.push(
      check(
        "ssl",
        "اعتبار و تاریخ انقضای گواهی",
        "ok",
        `معتبر تا ${new Date(Date.now() + daysLeft * 86400000).toLocaleDateString("fa-IR")} (${daysLeft} روز باقی‌مانده)`,
        `حالت پیش‌نمایش — صادرشده برای: ${domain ?? "*.mycompany.ir"}`
      )
    );
    results.push(check("ssl-match", "تطابق دامنه با گواهی", "ok", `گواهی دامنه ${domain} را پوشش می‌دهد`, "حالت پیش‌نمایش"));
    return results;
  }

  if (certData && ["crt", "pem", "cer"].includes(ext(certPath))) {
    try {
      const cert = new X509Certificate(certData);
      const validTo = new Date(cert.validTo).getTime();
      const daysLeft = Math.floor((validTo - Date.now()) / 86400000);
      const cn = cert.subject.match(/CN\s*=\s*([^,\n]+)/)?.[1]?.trim() ?? "";
      const sans = cert.subjectAltName?.match(/DNS:[^,\n]+/g)?.map((s) => s.replace("DNS:", "").trim()) ?? [];
      const covers = domain ? [cn, ...sans].some((n) => n === domain || n.startsWith("*.") && domain.endsWith(n.slice(1))) : true;
      results.push(
        check(
          "ssl-expiry",
          "اعتبار و تاریخ انقضای گواهی",
          daysLeft < 0 ? "fail" : daysLeft < 21 ? "warn" : "ok",
          daysLeft < 0
            ? `گواهی منقضی شده است (${cert.validTo})`
            : `معتبر تا ${new Date(validTo).toLocaleDateString("fa-IR")} (${daysLeft} روز باقی‌مانده)`,
          `صادرشده برای: ${cn}${sans.length ? ` | SAN: ${sans.join(" ، ")}` : ""}`
        )
      );
      if (domain) {
        results.push(
          check(
            "ssl-match",
            "تطابق دامنه با گواهی",
            covers ? "ok" : "warn",
            covers ? `گواهی دامنه ${domain} را پوشش می‌دهد` : `گواهی شامل ${domain} نیست (CN: ${cn}) — ادامه ممکن است هشدار مرورگر بدهد`
          )
        );
      }
    } catch {
      results.push(check("ssl-parse", "پارس گواهی", "warn", "محتوای گواهی قابل خواندن نیست (فرمت PEM انتظار می‌رفت)"));
    }
  } else if (certData) {
    results.push(check("ssl-format", "فرمت گواهی", "warn", `فرمت .${ext(certPath)} شناسایی شد؛ برای پارس خودکار از فرمت PEM استفاده کنید`));
  }
  return results;
}

async function checkSource(sourceType: string, sourcePath: string): Promise<CheckResult[]> {
  if (sourceType === "zip") {
    const ok = !!sourcePath && sourcePath.toLowerCase().endsWith(".zip");
    return [
      ok
        ? check("source", "فایل ZIP منبع کد", "ok", `آرشیو در ${sourcePath} آماده استخراج است`)
        : check("source", "فایل ZIP منبع کد", "fail", "ابتدا فایل ZIP سامانه را آپلود کنید"),
    ];
  }
  if (!sourcePath) {
    return [check("source", "مسیر منبع کد", "fail", "مسیر پوشه منبع کد را وارد کنید")];
  }
  // On a real Windows server these paths exist; in the sandbox preview we
  // accept a simulated path once it is well-formed.
  if (SIMULATION) {
    const wellFormed = /^[a-zA-Z]:\\.+/.test(sourcePath) || sourcePath.startsWith("/");
    return [
      wellFormed
        ? check("source", "مسیر منبع کد", "ok", `${sourcePath} — در استقرار واقعی از این مسیر robocopy می‌شود`)
        : check("source", "مسیر منبع کد", "fail", "مسیر باید کامل باشد (مثال: D:\\Sources\\myapp)"),
    ];
  }
  try {
    const stat = await fs.stat(sourcePath);
    const hasBackend = await fs.stat(`${sourcePath}\\backend`).then(() => true, () => false);
    const hasFrontend = await fs.stat(`${sourcePath}\\frontend`).then(() => true, () => false);
    return [
      check("source", "مسیر منبع کد", "ok", `${sourcePath} موجود است`, `${hasBackend ? "backend " : ""}${hasFrontend ? "frontend " : ""}شناسایی شد`),
      hasBackend ? check("source", "پوشه backend", "ok", "backend/ یافت شد") : check("source", "پوشه backend", "fail", "پوشه backend/ داخل مسیر منبع یافت نشد"),
    ];
  } catch {
    return [check("source", "مسیر منبع کد", "fail", `مسیر ${sourcePath} روی سرور یافت نشد`)];
  }
}

function checkDeployBase(deployBase: string, name: string): CheckResult[] {
  const wellFormed = /^[a-zA-Z]:\\.+/.test(deployBase);
  return [
    wellFormed
      ? check("paths", "پوشه استاندارد استقرار", "ok", `${deployBase}\\${name} → backend | frontend | www | logs | service | nginx | scripts`)
      : check("paths", "پوشه استاندارد استقرار", "fail", "مسیر پایه استقرار باید درایو ویندوزی باشد (مثال: C:\\deployments)"),
  ];
}

function checkName(name: string): CheckResult[] {
  const ok = /^[a-z0-9][a-z0-9-]{1,40}$/.test(name);
  return [
    ok
      ? check("name", "نام سامانه", "ok", `${name} معتبر است`)
      : check("name", "نام سامانه", "fail", "نام سامانه: ۲ تا ۴۰ کاراکتر انگلیسی کوچک، عدد و خط تیره"),
  ];
}

export async function POST(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const kind = body.kind as "domain" | "port" | "ssl" | "source" | "full";

  try {
    let results: CheckResult[] = [];
    if (kind === "domain" && body.domain) {
      results = [await checkDomain(String(body.domain).toLowerCase())];
    } else if (kind === "port" && body.port) {
      results = await checkPort(Number(body.port), body.currentName);
    } else if (kind === "ssl") {
      results = await checkSsl(body.certPath, body.keyPath, body.domain ? String(body.domain).toLowerCase() : undefined);
    } else if (kind === "source") {
      results = await checkSource(body.sourceType, body.sourcePath);
    } else if (kind === "full") {
      const name = String(body.name ?? "");
      results = [
        ...checkName(name),
        ...(body.domain ? [await checkDomain(String(body.domain).toLowerCase(), true)] : []),
        ...(body.port ? await checkPort(Number(body.port), name || undefined) : []),
        ...(await checkSsl(body.certPath ?? "", body.keyPath ?? "", body.domain ? String(body.domain).toLowerCase() : undefined)),
        ...(await checkSource(body.sourceType ?? "path", body.sourcePath ?? "")),
        ...checkDeployBase(String(body.deployBase ?? ""), name || "app"),
      ];
    } else {
      return NextResponse.json({ error: "kind نامعتبر" }, { status: 400 });
    }
    return NextResponse.json({ results });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
