"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Rocket, Globe, FolderCog, FileCheck2, PlayCircle, CheckCircle2, XCircle,
  Loader2, Upload, FolderInput, RefreshCw, Wand2, ChevronLeft, ExternalLink,
  TerminalSquare, ShieldCheck, Info, Boxes, RotateCcw, Download,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { GlassCard, CheckRow, LiveConsole, CodeBlock, StatusDot, fa, faTime } from "./bits";
import type { CheckResult, GeneratedScript, StepState } from "@/lib/types";

/* ------------------------------------------------------------------ */

interface WizardConfig {
  displayName: string;
  name: string;
  sourceType: "path" | "zip";
  sourcePath: string;
  domain: string;
  backendPort: string;
  deployBase: string;
  nginxPath: string;
  sslCertPath: string;
  sslKeyPath: string;
}

const DEFAULT_CONFIG: WizardConfig = {
  displayName: "",
  name: "",
  sourceType: "path",
  sourcePath: "",
  domain: "",
  backendPort: "",
  deployBase: "C:\\deployments",
  nginxPath: "C:\\nginx",
  sslCertPath: "",
  sslKeyPath: "",
};

const STEPS_META = [
  { id: 1, title: "هویت سامانه", icon: Boxes },
  { id: 2, title: "دامنه و پورت", icon: Globe },
  { id: 3, title: "مسیرها و SSL", icon: FolderCog },
  { id: 4, title: "بررسی نهایی", icon: FileCheck2 },
  { id: 5, title: "اجرا و گزارش", icon: PlayCircle },
];

type RunStatus = "idle" | "planning" | "planned" | "running" | "success" | "failed";

const inputCls =
  "w-full h-11 rounded-xl bg-white/[0.05] border border-white/10 px-3.5 text-sm outline-none focus:border-violet-400/50 focus:ring-2 focus:ring-violet-500/20 transition-all placeholder:text-muted-foreground/50";
const labelCls = "text-xs font-medium text-muted-foreground mb-1.5 block";

export function DeployWizard({ onDeployed, simulation }: { onDeployed: () => void; simulation: boolean }) {
  const [step, setStep] = useState(1);
  const [cfg, setCfg] = useState<WizardConfig>(DEFAULT_CONFIG);
  const [uploading, setUploading] = useState(false);
  const [uploadInfo, setUploadInfo] = useState<{ name: string; size: number } | null>(null);

  const [domainCheck, setDomainCheck] = useState<CheckResult[] | null>(null);
  const [checkingDomain, setCheckingDomain] = useState(false);
  const [portCheck, setPortCheck] = useState<CheckResult[] | null>(null);
  const [checkingPort, setCheckingPort] = useState(false);
  const [sslCheck, setSslCheck] = useState<CheckResult[] | null>(null);
  const [checkingSsl, setCheckingSsl] = useState(false);

  const [fullChecks, setFullChecks] = useState<CheckResult[] | null>(null);
  const [checkingFull, setCheckingFull] = useState(false);

  const [runId, setRunId] = useState<string | null>(null);
  const [scripts, setScripts] = useState<GeneratedScript[]>([]);
  const [planSteps, setPlanSteps] = useState<StepState[]>([]);
  const [runStatus, setRunStatus] = useState<RunStatus>("idle");
  const [activeStep, setActiveStep] = useState(-1);
  const [confirmed, setConfirmed] = useState(false);
  const [openScript, setOpenScript] = useState<string | null>(null);
  const deployRef = useRef(false);

  const set = <K extends keyof WizardConfig>(key: K, value: WizardConfig[K]) => setCfg((c) => ({ ...c, [key]: value }));

  const slugify = (name: string) => {
    const s =
      name
        .trim()
        .toLowerCase()
        .replace(/[\s_]+/g, "-")
        .replace(/[^a-z0-9-]/g, "")
        .replace(/^-+|-+$/g, "")
        .replace(/-+/g, "-")
        .slice(0, 40);
    return s.length >= 2 ? s : "";
  };

  /* ---------------- live checks ---------------- */

  const checkDomain = useCallback(async () => {
    if (!cfg.domain.trim()) return;
    setCheckingDomain(true);
    try {
      const res = await fetch("/api/checks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "domain", domain: cfg.domain.trim() }),
      });
      const data = await res.json();
      setDomainCheck(data.results ?? []);
    } catch {
      toast({ title: "خطا در بررسی دامنه", variant: "destructive" });
    } finally {
      setCheckingDomain(false);
    }
  }, [cfg.domain]);

  const checkPort = useCallback(async () => {
    const port = Number(cfg.backendPort);
    if (!port) return;
    setCheckingPort(true);
    try {
      const res = await fetch("/api/checks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "port", port }),
      });
      const data = await res.json();
      setPortCheck(data.results ?? []);
    } catch {
      toast({ title: "خطا در بررسی پورت", variant: "destructive" });
    } finally {
      setCheckingPort(false);
    }
  }, [cfg.backendPort]);

  const checkSsl = useCallback(async () => {
    if (!cfg.sslCertPath.trim() && !cfg.sslKeyPath.trim()) return;
    setCheckingSsl(true);
    try {
      const res = await fetch("/api/checks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "ssl",
          certPath: cfg.sslCertPath.trim(),
          keyPath: cfg.sslKeyPath.trim(),
          domain: cfg.domain.trim() || undefined,
        }),
      });
      const data = await res.json();
      setSslCheck(data.results ?? []);
    } catch {
      toast({ title: "خطا در بررسی گواهی SSL", variant: "destructive" });
    } finally {
      setCheckingSsl(false);
    }
  }, [cfg.sslCertPath, cfg.sslKeyPath, cfg.domain]);

  // suggest next free port when entering step 2
  const suggestPort = useCallback(async () => {
    try {
      const res = await fetch("/api/ports");
      const data = await res.json();
      const used = new Set<number>(data.ports.map((p: { port: number }) => p.port));
      const reserved = new Set([80, 443, 3389, 3000]);
      for (let p = 8001; p < 9000; p++) {
        if (!used.has(p) && !reserved.has(p)) {
          set("backendPort", String(p));
          setPortCheck(null);
          return;
        }
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (step === 2 && !cfg.backendPort) suggestPort();
    
  }, [step]);

  /* ---------------- upload ---------------- */

  const uploadZip = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "آپلود ناموفق", description: data.error, variant: "destructive" });
        return;
      }
      set("sourcePath", data.path);
      setUploadInfo({ name: data.name, size: data.size });
      toast({ title: "آرشیو ZIP آپلود شد", description: `${data.name} — آماده استخراج در زمان استقرار` });
    } catch {
      toast({ title: "خطا در آپلود فایل", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  /* ---------------- step guards ---------------- */

  const canNext = useMemo(() => {
    switch (step) {
      case 1:
        return !!cfg.displayName.trim() && !!cfg.name.trim() && !!cfg.sourcePath.trim();
      case 2:
        return !!cfg.domain.trim() && !!cfg.backendPort;
      case 3:
        return !!cfg.deployBase.trim() && !!cfg.sslCertPath.trim() && !!cfg.sslKeyPath.trim();
      default:
        return true;
    }
  }, [step, cfg]);

  const goNext = () => {
    if (step === 1 && !cfg.name) set("name", slugify(cfg.displayName));
    setStep((s) => Math.min(5, s + 1));
    if (step + 1 === 4) setFullChecks(null);
  };

  /* ---------------- full preflight + plan ---------------- */

  const runFullChecks = async () => {
    setCheckingFull(true);
    setFullChecks(null);
    try {
      const res = await fetch("/api/checks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "full",
          name: cfg.name,
          displayName: cfg.displayName,
          domain: cfg.domain.trim(),
          port: Number(cfg.backendPort),
          sourceType: cfg.sourceType,
          sourcePath: cfg.sourcePath,
          deployBase: cfg.deployBase,
          certPath: cfg.sslCertPath,
          keyPath: cfg.sslKeyPath,
        }),
      });
      const data = await res.json();
      setFullChecks(data.results ?? []);
    } catch {
      toast({ title: "خطا در بررسی نهایی", variant: "destructive" });
    } finally {
      setCheckingFull(false);
    }
  };

  useEffect(() => {
    if (step === 4 && !fullChecks && !checkingFull) runFullChecks();
    
  }, [step]);

  const fullOk = useMemo(() => {
    if (!fullChecks) return false;
    return fullChecks.every((r) => r.status !== "fail");
  }, [fullChecks]);

  const generatePlan = async () => {
    setRunStatus("planning");
    try {
      const res = await fetch("/api/deploy/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: cfg.name,
          displayName: cfg.displayName,
          domain: cfg.domain.trim(),
          backendPort: Number(cfg.backendPort),
          sourceType: cfg.sourceType,
          sourcePath: cfg.sourcePath,
          deployBase: cfg.deployBase,
          sslCertPath: cfg.sslCertPath,
          sslKeyPath: cfg.sslKeyPath,
          nginxPath: cfg.nginxPath,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "تولید پلن ناموفق", description: data.error, variant: "destructive" });
        setRunStatus("idle");
        return;
      }
      setRunId(data.runId);
      setScripts(data.scripts);
      setPlanSteps(data.steps);
      setRunStatus("planned");
      setOpenScript(data.scripts[0]?.id ?? null);
      toast({ title: "پلن استقرار تولید شد", description: `${fa(data.scripts.length)} اسکریپت PowerShell آماده اجراست` });
    } catch {
      toast({ title: "خطا در تولید پلن", variant: "destructive" });
      setRunStatus("idle");
    }
  };

  /* ---------------- execution ---------------- */

  const runPlan = async () => {
    if (!runId || deployRef.current) return;
    deployRef.current = true;
    setRunStatus("running");
    let failed = false;
    for (let i = 0; i < planSteps.length; i++) {
      setActiveStep(i);
      setPlanSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, status: "running", output: [] } : s)));
      try {
        const res = await fetch("/api/deploy/step", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runId, stepIndex: i }),
        });
        const data = await res.json();
        if (!res.ok) {
          failed = true;
          setPlanSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, status: "failed", output: [data.error ?? "خطا"] } : s)));
          break;
        }
        const resultStep: StepState = data.step;
        // reveal lines progressively for the live feel
        for (let j = 1; j <= resultStep.output.length; j++) {
          const partial = resultStep.output.slice(0, j);
          setPlanSteps((prev) =>
            prev.map((s, idx) =>
              idx === i
                ? { ...s, output: partial, status: j === resultStep.output.length ? resultStep.status : "running" }
                : s
            )
          );
          await new Promise((r) => setTimeout(r, 55));
        }
        setPlanSteps((prev) => prev.map((s, idx) => (idx === i ? { ...resultStep } : s)));
        if (!data.done && resultStep.status === "failed") {
          failed = true;
          break;
        }
      } catch {
        failed = true;
        break;
      }
    }
    setActiveStep(-1);
    setRunStatus(failed ? "failed" : "success");
    deployRef.current = false;
    if (!failed) {
      toast({ title: "استقرار کامل شد 🎉", description: `سامانه روی https://${cfg.domain} فعال است` });
      onDeployed();
    } else {
      toast({ title: "استقرار با خطا متوقف شد", variant: "destructive" });
    }
  };

  const resetWizard = () => {
    setCfg(DEFAULT_CONFIG);
    setStep(1);
    setRunId(null);
    setScripts([]);
    setPlanSteps([]);
    setRunStatus("idle");
    setFullChecks(null);
    setDomainCheck(null);
    setPortCheck(null);
    setSslCheck(null);
    setUploadInfo(null);
    setConfirmed(false);
  };

  const deployPath = `${cfg.deployBase.replace(/[\\/]+$/, "")}\\${cfg.name || "app"}`;
  const serviceName = `deployguard-${cfg.name || "app"}`;

  /* ================================================================ */

  return (
    <div className="space-y-5">
      {/* stepper */}
      <GlassCard className="!p-4">
        <ol className="flex items-center gap-1.5 sm:gap-2.5">
          {STEPS_META.map((s, i) => {
            const Icon = s.icon;
            const done = step > s.id;
            const current = step === s.id;
            return (
              <li key={s.id} className="flex items-center gap-1.5 sm:gap-2.5 flex-1 last:flex-none">
                <button
                  onClick={() => s.id < step && setStep(s.id)}
                  disabled={s.id >= step}
                  className={cn(
                    "flex items-center gap-2 rounded-xl px-2.5 sm:px-3.5 py-2 border transition-all",
                    current
                      ? "border-violet-400/40 bg-violet-500/15 shadow-lg shadow-violet-900/30"
                      : done
                        ? "border-emerald-400/25 bg-emerald-400/8 cursor-pointer hover:bg-emerald-400/15"
                        : "border-white/8 bg-white/[0.02] opacity-60"
                  )}
                >
                  <span
                    className={cn(
                      "w-7 h-7 rounded-lg flex items-center justify-center",
                      current
                        ? "bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white"
                        : done
                          ? "bg-emerald-400/20 text-emerald-300"
                          : "bg-white/5 text-muted-foreground"
                    )}
                  >
                    {done ? <CheckCircle2 className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
                  </span>
                  <span className={cn("text-xs font-bold hidden md:block", current ? "text-foreground" : "text-muted-foreground")}>
                    {s.title}
                  </span>
                </button>
                {i < STEPS_META.length - 1 && (
                  <div className={cn("h-px flex-1 min-w-2", done ? "bg-gradient-to-l from-emerald-400/40 to-transparent" : "bg-white/8")} />
                )}
              </li>
            );
          })}
        </ol>
      </GlassCard>

      <AnimatePresence mode="wait">
        {/* ------------------------------- step 1 ------------------------------- */}
        {step === 1 && (
          <motion.div key="s1" initial={{ opacity: 0, x: -18 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 18 }} transition={{ duration: 0.3 }}>
            <GlassCard>
              <h2 className="text-lg font-black flex items-center gap-2 mb-1">
                <Boxes className="w-5 h-5 text-violet-300" /> هویت سامانه
              </h2>
              <p className="text-xs text-muted-foreground mb-5">نام نمایشی و شناسه یکتای سامانه و نحوه تأمین کد منبع را مشخص کنید</p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>نام نمایشی سامانه</label>
                  <input
                    className={inputCls}
                    placeholder="مثال: سامانه مدیریت اسناد"
                    value={cfg.displayName}
                    onChange={(e) => {
                      set("displayName", e.target.value);
                      set("name", slugify(e.target.value));
                    }}
                  />
                </div>
                <div>
                  <label className={labelCls}>
                    شناسه سامانه (اسلاگ انگلیسی — برای سرویس ویندوز و پوشه استقرار)
                  </label>
                  <input
                    className={cn(inputCls, "ltr-input")}
                    placeholder="docs-manager"
                    value={cfg.name}
                    onChange={(e) => set("name", slugify(e.target.value))}
                    dir="ltr"
                  />
                  {cfg.name === "" && cfg.displayName.trim() !== "" && (
                    <p className="mt-1.5 text-[10px] text-amber-300">
                      شناسه انگلیسی لازم است (حروف کوچک، عدد، خط تیره) — مثال: docs-manager
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-5">
                <label className={labelCls}>منبع کد سامانه</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => set("sourceType", "path")}
                    className={cn(
                      "flex items-center gap-3 rounded-xl border p-4 text-right transition-all",
                      cfg.sourceType === "path" ? "border-violet-400/40 bg-violet-500/12" : "border-white/10 bg-white/[0.02] hover:bg-white/[0.04]"
                    )}
                  >
                    <FolderInput className={cn("w-5 h-5", cfg.sourceType === "path" ? "text-violet-300" : "text-muted-foreground")} />
                    <div>
                      <div className="text-sm font-bold">مسیر پوشه روی سرور</div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">ساختار استاندارد: backend/ و frontend/</div>
                    </div>
                  </button>
                  <button
                    onClick={() => set("sourceType", "zip")}
                    className={cn(
                      "flex items-center gap-3 rounded-xl border p-4 text-right transition-all",
                      cfg.sourceType === "zip" ? "border-violet-400/40 bg-violet-500/12" : "border-white/10 bg-white/[0.02] hover:bg-white/[0.04]"
                    )}
                  >
                    <Upload className={cn("w-5 h-5", cfg.sourceType === "zip" ? "text-violet-300" : "text-muted-foreground")} />
                    <div>
                      <div className="text-sm font-bold">آپلود فایل ZIP</div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">حداکثر ۳۰۰ مگابایت</div>
                    </div>
                  </button>
                </div>
              </div>

              <div className="mt-4">
                {cfg.sourceType === "path" ? (
                  <div>
                    <label className={labelCls}>مسیر کامل کد روی سرور</label>
                    <input
                      className={cn(inputCls, "ltr-input")}
                      placeholder="D:\Sources\docs-manager"
                      value={cfg.sourcePath}
                      onChange={(e) => set("sourcePath", e.target.value)}
                      dir="ltr"
                    />
                    <p className="mt-1.5 text-[10px] text-muted-foreground">
                      پوشه باید شامل <code className="terminal bg-white/8 px-1 rounded">backend</code> (FastAPI) و{" "}
                      <code className="terminal bg-white/8 px-1 rounded">frontend</code> (React) باشد
                    </p>
                  </div>
                ) : (
                  <div>
                    <label
                      className={cn(
                        "flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 bg-white/[0.02] py-8 cursor-pointer hover:border-violet-400/40 hover:bg-violet-500/5 transition-all",
                        uploading && "pointer-events-none opacity-60"
                      )}
                    >
                      <input
                        type="file"
                        accept=".zip"
                        className="hidden"
                        onChange={(e) => e.target.files?.[0] && uploadZip(e.target.files[0])}
                      />
                      {uploading ? (
                        <>
                          <Loader2 className="w-6 h-6 text-violet-300 animate-spin" />
                          <span className="text-xs text-muted-foreground">در حال آپلود…</span>
                        </>
                      ) : (
                        <>
                          <Upload className="w-6 h-6 text-violet-300" />
                          <span className="text-xs font-bold">فایل ZIP سامانه را اینجا رها کنید یا کلیک کنید</span>
                          {uploadInfo && (
                            <span className="text-[10px] text-emerald-300">
                              ✓ {uploadInfo.name} ({fa((uploadInfo.size / 1024 / 1024).toFixed(1))} MB) آپلود شد
                            </span>
                          )}
                        </>
                      )}
                    </label>
                  </div>
                )}
              </div>
            </GlassCard>
          </motion.div>
        )}

        {/* ------------------------------- step 2 ------------------------------- */}
        {step === 2 && (
          <motion.div key="s2" initial={{ opacity: 0, x: -18 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 18 }} transition={{ duration: 0.3 }}>
            <GlassCard>
              <h2 className="text-lg font-black flex items-center gap-2 mb-1">
                <Globe className="w-5 h-5 text-teal-300" /> دامنه و پورت
              </h2>
              <p className="text-xs text-muted-foreground mb-5">
                دامنه از پیش خریداری‌شده و پورت بک‌اند را وارد کنید — سامانه به‌طور خودکار آزاد بودن پورت و رزولوشن DNS را کنترل می‌کند
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>دامنه اختصاصی سامانه</label>
                  <div className="flex gap-2">
                    <input
                      className={cn(inputCls, "ltr-input flex-1")}
                      placeholder="docs.example.ir"
                      value={cfg.domain}
                      onChange={(e) => {
                        set("domain", e.target.value.toLowerCase().replace(/\s/g, ""));
                        setDomainCheck(null);
                      }}
                      dir="ltr"
                    />
                    <button
                      onClick={checkDomain}
                      disabled={checkingDomain || !cfg.domain.trim()}
                      className="h-11 px-3.5 rounded-xl bg-teal-500/15 border border-teal-400/30 text-teal-200 text-xs font-bold hover:bg-teal-500/25 transition-colors flex items-center gap-1.5 disabled:opacity-40"
                    >
                      {checkingDomain ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                      بررسی
                    </button>
                  </div>
                  <AnimatePresence>
                    {domainCheck?.map((r, i) => (
                      <motion.div key={r.key + r.title + i} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }} className="mt-2">
                        <CheckRow result={r} index={0} />
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>

                <div>
                  <label className={labelCls}>
                    پورت بک‌اند FastAPI{" "}
                    <span className="text-[10px] opacity-70">(پیشنهاد خودکار آزاد)</span>
                  </label>
                  <div className="flex gap-2">
                    <input
                      className={cn(inputCls, "ltr-input flex-1")}
                      placeholder="8001"
                      value={cfg.backendPort}
                      onChange={(e) => {
                        set("backendPort", e.target.value.replace(/\D/g, ""));
                        setPortCheck(null);
                      }}
                      dir="ltr"
                    />
                    <button
                      onClick={suggestPort}
                      className="h-11 px-3 rounded-xl bg-white/5 border border-white/10 text-muted-foreground hover:text-foreground transition-colors"
                      title="پیشنهاد پورت آزاد"
                    >
                      <RefreshCw className="w-4 h-4" />
                    </button>
                    <button
                      onClick={checkPort}
                      disabled={checkingPort || !cfg.backendPort}
                      className="h-11 px-3.5 rounded-xl bg-teal-500/15 border border-teal-400/30 text-teal-200 text-xs font-bold hover:bg-teal-500/25 transition-colors flex items-center gap-1.5 disabled:opacity-40"
                    >
                      {checkingPort ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                      بررسی
                    </button>
                  </div>
                  <AnimatePresence>
                    {portCheck?.map((r, i) => (
                      <motion.div key={r.key + r.title + i} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }} className="mt-2">
                        <CheckRow result={r} index={0} />
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              </div>

              <div className="mt-5 rounded-xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                  <Info className="w-3.5 h-3.5 text-sky-300" /> پیش‌نمایش معماری
                </div>
                <div dir="ltr" className="terminal text-[11px] leading-6 text-slate-300">
                  <span className="ln-ok">https://{cfg.domain || "docs.example.ir"}</span>
                  <span className="ln-plain">  →  Nginx :443 (SSL)</span>
                  <br />
                  <span className="ln-plain">  ├─ /            →  </span>
                  <span className="ln-run">React static build (www)</span>
                  <br />
                  <span className="ln-plain">  └─ /api  /docs  →  </span>
                  <span className="ln-run">uvicorn 127.0.0.1:{cfg.backendPort || "8001"}</span>
                </div>
              </div>
            </GlassCard>
          </motion.div>
        )}

        {/* ------------------------------- step 3 ------------------------------- */}
        {step === 3 && (
          <motion.div key="s3" initial={{ opacity: 0, x: -18 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 18 }} transition={{ duration: 0.3 }}>
            <GlassCard>
              <h2 className="text-lg font-black flex items-center gap-2 mb-1">
                <FolderCog className="w-5 h-5 text-fuchsia-300" /> مسیرها و گواهی SSL
              </h2>
              <p className="text-xs text-muted-foreground mb-5">
                ساختار پوشه استاندارد استقرار و مسیر گواهی‌های SSL خریداری‌شده برای دامنه را مشخص کنید
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>مسیر پایه استقرار (استاندارد)</label>
                  <input
                    className={cn(inputCls, "ltr-input")}
                    value={cfg.deployBase}
                    onChange={(e) => set("deployBase", e.target.value)}
                    dir="ltr"
                  />
                  <div className="mt-2 rounded-xl border border-white/10 bg-[#0a0e1f]/70 p-3" dir="ltr">
                    <div className="terminal text-[10.5px] leading-5">
                      <div className="ln-run">{deployPath}</div>
                      <div className="ln-plain">├── backend\        <span className="opacity-50">← FastAPI + .venv</span></div>
                      <div className="ln-plain">├── frontend\       <span className="opacity-50">← React source</span></div>
                      <div className="ln-plain">├── www\            <span className="opacity-50">← build خروجی (سرو توسط Nginx)</span></div>
                      <div className="ln-plain">├── service\        <span className="opacity-50">← WinSW service</span></div>
                      <div className="ln-plain">├── logs\</div>
                      <div className="ln-plain">└── scripts\</div>
                    </div>
                  </div>
                </div>

                <div>
                  <label className={labelCls}>مسیر نصب Nginx</label>
                  <input className={cn(inputCls, "ltr-input")} value={cfg.nginxPath} onChange={(e) => set("nginxPath", e.target.value)} dir="ltr" />
                  <p className="mt-1.5 text-[10px] text-muted-foreground" dir="ltr">
                    conf → {cfg.nginxPath}\conf\conf.d\{cfg.name || "app"}.conf
                  </p>
                </div>

                <div>
                  <label className={labelCls}>مسیر فایل گواهی (CRT / PEM)</label>
                  <input
                    className={cn(inputCls, "ltr-input")}
                    placeholder="C:\ssl\certs\docs.example.ir.crt"
                    value={cfg.sslCertPath}
                    onChange={(e) => {
                      set("sslCertPath", e.target.value);
                      setSslCheck(null);
                    }}
                    dir="ltr"
                  />
                </div>
                <div>
                  <label className={labelCls}>مسیر کلید خصوصی (KEY)</label>
                  <input
                    className={cn(inputCls, "ltr-input")}
                    placeholder="C:\ssl\certs\docs.example.ir.key"
                    value={cfg.sslKeyPath}
                    onChange={(e) => {
                      set("sslKeyPath", e.target.value);
                      setSslCheck(null);
                    }}
                    dir="ltr"
                  />
                </div>
              </div>

              <div className="mt-4 flex items-center gap-2">
                <button
                  onClick={checkSsl}
                  disabled={checkingSsl}
                  className="h-10 px-4 rounded-xl bg-fuchsia-500/15 border border-fuchsia-400/30 text-fuchsia-200 text-xs font-bold hover:bg-fuchsia-500/25 transition-colors flex items-center gap-1.5 disabled:opacity-40"
                >
                  {checkingSsl ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                  اعتبارسنجی گواهی SSL
                </button>
              </div>
              <AnimatePresence>
                {sslCheck && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-2">
                    {sslCheck.map((r, i) => (
                      <CheckRow key={r.key + r.title + i} result={r} index={i} />
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </GlassCard>
          </motion.div>
        )}

        {/* ------------------------------- step 4 ------------------------------- */}
        {step === 4 && (
          <motion.div key="s4" initial={{ opacity: 0, x: -18 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 18 }} transition={{ duration: 0.3 }}>
            <GlassCard>
              <div className="flex items-center justify-between mb-1">
                <h2 className="text-lg font-black flex items-center gap-2">
                  <FileCheck2 className="w-5 h-5 text-amber-300" /> بررسی نهایی پیش از استقرار
                </h2>
                <button
                  onClick={runFullChecks}
                  disabled={checkingFull}
                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1.5 transition-colors"
                >
                  {checkingFull ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                  بررسی مجدد
                </button>
              </div>
              <p className="text-xs text-muted-foreground mb-5">
                تمام پیش‌نیازها یک‌بار دیگر به‌صورت زنده کنترل می‌شوند — همه موارد باید سبز باشند
              </p>

              {checkingFull && (
                <div className="space-y-2">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="h-[62px] rounded-xl bg-white/[0.03] shimmer" />
                  ))}
                </div>
              )}

              {!checkingFull && fullChecks && (
                <>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                    {fullChecks.map((r, i) => (
                      <CheckRow key={r.key + r.title} result={r} index={i} />
                    ))}
                  </div>

                  <div
                    className={cn(
                      "mt-5 rounded-xl border p-4 flex items-center gap-3",
                      fullOk ? "border-emerald-400/25 bg-emerald-400/[0.06]" : "border-rose-400/25 bg-rose-400/[0.06]"
                    )}
                  >
                    {fullOk ? (
                      <CheckCircle2 className="w-6 h-6 text-emerald-300 shrink-0" />
                    ) : (
                      <XCircle className="w-6 h-6 text-rose-300 shrink-0" />
                    )}
                    <div className="text-sm">
                      {fullOk ? (
                        <>
                          <b>همه بررسی‌ها موفق بود.</b> می‌توانید پلن PowerShell را تولید کنید.
                        </>
                      ) : (
                        <>
                          <b>برخی موارد باید اصلاح شوند.</b> موارد قرمز را برطرف کنید و دوباره بررسی بگیرید.
                        </>
                      )}
                    </div>
                  </div>

                  {fullOk && (
                    <div className="mt-4 flex justify-center">
                      <button
                        onClick={generatePlan}
                        disabled={runStatus === "planning" || runStatus === "planned"}
                        className="relative h-12 px-6 rounded-xl bg-gradient-to-l from-violet-600 via-fuchsia-600 to-violet-600 bg-[length:200%_100%] hover:bg-[position:100%_0] transition-all duration-500 text-sm font-black text-white shadow-xl shadow-violet-900/40 flex items-center gap-2 disabled:opacity-60"
                      >
                        {runStatus === "planning" ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : runStatus === "planned" ? (
                          <CheckCircle2 className="w-4 h-4" />
                        ) : (
                          <Wand2 className="w-4 h-4" />
                        )}
                        {runStatus === "planned" ? "پلن تولید شد — به مرحله اجرا بروید" : runStatus === "planning" ? "در حال تولید پلن…" : "تولید پلن PowerShell استقرار"}
                      </button>
                    </div>
                  )}
                </>
              )}
            </GlassCard>
          </motion.div>
        )}

        {/* ------------------------------- step 5 ------------------------------- */}
        {step === 5 && (
          <motion.div key="s5" initial={{ opacity: 0, x: -18 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 18 }} transition={{ duration: 0.3 }}>
            <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
              {/* steps list */}
              <GlassCard className="xl:col-span-2 !p-4">
                <h3 className="text-sm font-black flex items-center gap-2 mb-3">
                  <TerminalSquare className="w-4 h-4 text-violet-300" /> مراحل استقرار
                </h3>
                <div className="space-y-1.5">
                  {planSteps.map((s, i) => (
                    <button
                      key={s.id}
                      onClick={() => scripts[i] && setOpenScript(openScript === scripts[i].id ? null : scripts[i].id)}
                      className={cn(
                        "w-full flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 transition-all",
                        s.status === "success"
                          ? "border-emerald-400/20 bg-emerald-400/[0.06]"
                          : s.status === "running"
                            ? "border-teal-400/35 bg-teal-400/[0.08]"
                            : s.status === "failed"
                              ? "border-rose-400/30 bg-rose-400/[0.08]"
                              : "border-white/8 bg-white/[0.02]"
                      )}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <StepDot status={s.status} index={i} />
                        <div className="text-right min-w-0">
                          <div className="text-xs font-bold truncate">{s.title}</div>
                          <div className="text-[10px] text-muted-foreground" dir="ltr">
                            {scripts[i]?.fileName}
                            {s.durationMs > 0 && ` — ${(s.durationMs / 1000).toFixed(1)}s`}
                          </div>
                        </div>
                      </div>
                      <ChevronLeft className={cn("w-3.5 h-3.5 text-muted-foreground transition-transform", openScript === scripts[i]?.id && "-rotate-90")} />
                    </button>
                  ))}
                </div>

                {/* summary */}
                {runStatus === "success" && (
                  <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="mt-4 rounded-xl border border-emerald-400/25 bg-emerald-400/[0.07] p-4">
                    <div className="flex items-center gap-2 text-sm font-black text-emerald-200 mb-3">
                      <CheckCircle2 className="w-5 h-5" /> استقرار با موفقیت کامل شد
                    </div>
                    <div className="space-y-1.5 text-[11px]">
                      <a href={`https://${cfg.domain}`} target="_blank" rel="noreferrer" className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2 hover:bg-white/10 transition-colors" dir="ltr">
                        <span className="text-emerald-300 font-bold">https://{cfg.domain}</span>
                        <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
                      </a>
                      <div className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2" dir="ltr">
                        <span className="text-muted-foreground">service</span>
                        <span className="font-bold">{serviceName}</span>
                      </div>
                      <div className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2" dir="ltr">
                        <span className="text-muted-foreground">nginx conf</span>
                        <span className="font-bold">{cfg.nginxPath}\conf\conf.d\{cfg.name}.conf</span>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button onClick={resetWizard} className="h-9 rounded-lg bg-gradient-to-l from-violet-600 to-fuchsia-600 text-white text-xs font-bold hover:opacity-90 transition-opacity">
                        استقرار سامانه جدید
                      </button>
                      <a
                        href={`https://${cfg.domain}/docs`}
                        target="_blank"
                        rel="noreferrer"
                        className="h-9 rounded-lg border border-white/10 bg-white/5 text-xs font-bold flex items-center justify-center gap-1.5 hover:bg-white/10 transition-colors"
                      >
                        <ExternalLink className="w-3.5 h-3.5" /> Swagger API
                      </a>
                    </div>
                  </motion.div>
                )}

                {runStatus === "failed" && (
                  <div className="mt-4 rounded-xl border border-rose-400/25 bg-rose-400/[0.07] p-4 text-xs text-rose-100 leading-5">
                    <b>استقرار در مرحله بالا متوقف شد.</b> خروجی اسکریپت را بررسی کنید؛ پس از رفع مشکل می‌توانید پلن را دوباره اجرا کنید.
                  </div>
                )}

                {runStatus === "planned" && (
                  <div className="mt-4">
                    <label className="flex items-start gap-2.5 rounded-xl border border-white/10 bg-white/[0.03] p-3 cursor-pointer">
                      <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5 accent-violet-500" />
                      <span className="text-[11px] leading-5 text-muted-foreground">
                        تأیید می‌کنم اسکریپت‌های PowerShell تولیدشده با دسترسی <b className="text-foreground">Administrator</b> روی این
                        سرور اجرا شوند و ساختار پوشه، سرویس ویندوز و کانفیگ Nginx مطابق پلن اعمال شود.
                      </span>
                    </label>
                    <button
                      onClick={runPlan}
                      disabled={!confirmed || runStatus === "running"}
                      className="mt-3 w-full h-11 rounded-xl bg-gradient-to-l from-emerald-600 to-teal-500 text-white text-sm font-black shadow-xl shadow-emerald-900/30 hover:opacity-90 transition-opacity flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Rocket className="w-4 h-4" />
                      اجرای استقرار
                    </button>
                  </div>
                )}
              </GlassCard>

              {/* console + scripts */}
              <div className="xl:col-span-3 space-y-4">
                <GlassCard className="!p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-black flex items-center gap-2">
                      <PlayCircle className="w-4 h-4 text-teal-300" /> خروجی زنده
                    </h3>
                    {runStatus === "running" && (
                      <span className="text-[10px] text-teal-300 flex items-center gap-1.5">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        مرحله {fa(activeStep + 1)} از {fa(planSteps.length)}
                      </span>
                    )}
                  </div>
                  <LiveConsole
                    lines={activeStep >= 0 ? planSteps[activeStep]?.output ?? [] : planSteps[planSteps.length - 1]?.output ?? []}
                    running={runStatus === "running"}
                    maxHeight={320}
                  />
                </GlassCard>

                {scripts.length > 0 && openScript && (
                  <GlassCard className="!p-4">
                    {scripts.filter((s) => s.id === openScript).map((s) => (
                      <div key={s.id}>
                        <div className="flex items-center justify-between mb-2.5">
                          <div>
                            <h4 className="text-sm font-black">{s.title}</h4>
                            <p className="text-[10px] text-muted-foreground mt-0.5">{s.description}</p>
                          </div>
                          <span className="text-[10px] rounded-md bg-white/5 border border-white/10 px-2 py-1 font-mono" dir="ltr">
                            {s.fileName}
                          </span>
                        </div>
                        <CodeBlock code={s.content} maxHeight={340} downloadName={s.fileName} />
                      </div>
                    ))}
                  </GlassCard>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* nav buttons */}
      {step < 5 && (
        <div className="flex items-center justify-between">
          <button
            onClick={() => setStep((s) => Math.max(1, s - 1))}
            disabled={step === 1}
            className="h-10 px-5 rounded-xl border border-white/10 bg-white/[0.03] text-xs font-bold text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30"
          >
            مرحله قبل
          </button>
          <button
            onClick={goNext}
            disabled={!canNext}
            className="h-10 px-6 rounded-xl bg-gradient-to-l from-violet-600 to-fuchsia-600 text-white text-xs font-black shadow-lg shadow-violet-900/30 hover:opacity-90 transition-opacity flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            مرحله بعد <ChevronLeft className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}

function StepDot({ status, index }: { status: StepState["status"]; index: number }) {
  return (
    <span
      className={cn(
        "w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-black shrink-0",
        status === "success"
          ? "bg-emerald-400/20 text-emerald-300"
          : status === "running"
            ? "bg-teal-400/25 text-teal-200"
            : status === "failed"
              ? "bg-rose-400/25 text-rose-300"
              : "bg-white/5 text-muted-foreground"
      )}
    >
      {status === "success" ? (
        <CheckCircle2 className="w-4 h-4" />
      ) : status === "failed" ? (
        <XCircle className="w-4 h-4" />
      ) : status === "running" ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : (
        fa(index + 1)
      )}
    </span>
  );
}
