"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Upload, FolderInput, Loader2, PlayCircle, CheckCircle2, XCircle, RotateCcw,
  Lightbulb, HeartPulse, RefreshCcwDot, History, Undo2,
  TriangleAlert, CircleCheck, Info,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { LiveConsole, fa, faTime } from "./bits";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { GeneratedScript, HealthReport, StepState } from "@/lib/types";

export interface DeployRowLite {
  id: string;
  name: string;
  displayName: string;
  domain: string;
  backendPort: number;
  deployBase: string;
  deployPath: string;
  activeReleaseTag: string | null;
}

const inputCls =
  "w-full h-11 rounded-xl bg-white/[0.05] border border-white/10 px-3.5 text-sm outline-none focus:border-violet-400/50 focus:ring-2 focus:ring-violet-500/20 transition-all placeholder:text-muted-foreground/50";
const labelCls = "text-xs font-medium text-muted-foreground mb-1.5 block";

/* ================================================================== */
/* Update dialog — staged release + safe switch                        */
/* ================================================================== */

type RunStatus = "idle" | "planning" | "planned" | "running" | "success" | "failed";

export function UpdateDialog({
  target, open, onOpenChange, onDone,
}: {
  target: DeployRowLite | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}) {
  const [sourceType, setSourceType] = useState<"path" | "zip">("zip");
  const [sourcePath, setSourcePath] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadInfo, setUploadInfo] = useState<{ name: string; size: number } | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [steps, setSteps] = useState<StepState[]>([]);
  const [scripts, setScripts] = useState<GeneratedScript[]>([]);
  const [status, setStatus] = useState<RunStatus>("idle");
  const [activeStep, setActiveStep] = useState(-1);
  const [confirmed, setConfirmed] = useState(false);
  const runRef = useRef(false);

  useEffect(() => {
    if (!open) {
      setRunId(null);
      setSteps([]);
      setScripts([]);
      setStatus("idle");
      setActiveStep(-1);
      setConfirmed(false);
      setUploadInfo(null);
      setSourcePath("");
      runRef.current = false;
    }
  }, [open]);

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
      setSourcePath(data.path);
      setUploadInfo({ name: data.name, size: data.size });
      toast({ title: "ZIP نسخهٔ جدید آپلود شد", description: `${data.name} — آماده استقرار` });
    } catch {
      toast({ title: "خطا در آپلود فایل", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const generatePlan = async () => {
    if (!target) return;
    setStatus("planning");
    try {
      const res = await fetch("/api/deploy/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "update",
          name: target.name,
          displayName: target.displayName,
          domain: target.domain,
          backendPort: target.backendPort,
          sourceType,
          sourcePath,
          deployBase: target.deployBase,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "تولید پلن به‌روزرسانی ناموفق", description: data.error, variant: "destructive" });
        setStatus("idle");
        return;
      }
      setRunId(data.runId);
      setScripts(data.scripts);
      setSteps(data.steps);
      setStatus("planned");
      toast({ title: "پلن به‌روزرسانی تولید شد", description: "نسخهٔ فعلی تا «سوییچ ایمن» فعال می‌ماند" });
    } catch {
      toast({ title: "خطا در تولید پلن", variant: "destructive" });
      setStatus("idle");
    }
  };

  const runPlan = async (startIndex = 0) => {
    if (!runId || !target || runRef.current) return;
    runRef.current = true;
    setStatus("running");
    let failed = false;
    for (let i = startIndex; i < steps.length; i++) {
      setActiveStep(i);
      setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, status: "running", output: [] } : s)));
      try {
        const res = await fetch("/api/deploy/step", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runId, stepIndex: i }),
        });
        const data = await res.json();
        if (!res.ok) {
          failed = true;
          setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, status: "failed", output: [data.error ?? "خطا"] } : s)));
          break;
        }
        const resultStep: StepState = data.step;
        setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...resultStep } : s)));
        if (resultStep.status === "failed") {
          failed = true;
          break;
        }
      } catch {
        failed = true;
        break;
      }
    }
    setActiveStep(-1);
    setStatus(failed ? "failed" : "success");
    runRef.current = false;
    if (!failed) {
      toast({ title: "به‌روزرسانی کامل شد 🎉", description: `نسخهٔ جدید «${target.displayName}» فعال است` });
      onDone();
    } else {
      toast({ title: "به‌روزرسانی با خطا متوقف شد", variant: "destructive" });
    }
  };

  if (!target) return null;
  const canPlan = sourcePath.trim().length > 0;
  const isRunning = status === "running";
  const failIdx = steps.findIndex((s) => s.status === "failed");
  const failedStep = failIdx >= 0 ? steps[failIdx] : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl w-[calc(100vw-2rem)] max-h-[88vh] overflow-y-auto bg-[#0d1327]/95 backdrop-blur-2xl border-white/10 rounded-2xl shadow-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <RefreshCcwDot className="w-5 h-5 text-teal-300" />
            به‌روزرسانی «{target.displayName}» به نسخهٔ جدید
          </DialogTitle>
        </DialogHeader>

        <p className="text-[11px] leading-5 text-muted-foreground rounded-xl border border-sky-300/20 bg-sky-400/[0.06] p-3">
          کد جدید در پوشهٔ <span className="font-mono" dir="ltr">releases\</span> آماده‌سازی و تست می‌شود و نسخهٔ در حال اجرا
          تا «سوییچ ایمن» دست‌نخورده می‌ماند. اگر بک‌اند جدید بالا نیاید، به‌طور خودکار به نسخهٔ قبلی بازمی‌گردد. توجه:
          بازگشت کد، تغییرات دیتابیس را خودکار برنمی‌گرداند.
        </p>

        {status === "idle" || status === "planning" ? (
          <div className="space-y-4 mt-2">
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setSourceType("zip")}
                className={cn(
                  "flex items-center gap-3 rounded-xl border p-3.5 text-right transition-all",
                  sourceType === "zip" ? "border-teal-400/40 bg-teal-500/12" : "border-white/10 bg-white/[0.02] hover:bg-white/[0.04]"
                )}
              >
                <Upload className={cn("w-4.5 h-4.5 w-5 h-5", sourceType === "zip" ? "text-teal-300" : "text-muted-foreground")} />
                <div>
                  <div className="text-sm font-bold">آپلود ZIP نسخهٔ جدید</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">همان ساختار backend/ + frontend/</div>
                </div>
              </button>
              <button
                onClick={() => setSourceType("path")}
                className={cn(
                  "flex items-center gap-3 rounded-xl border p-3.5 text-right transition-all",
                  sourceType === "path" ? "border-teal-400/40 bg-teal-500/12" : "border-white/10 bg-white/[0.02] hover:bg-white/[0.04]"
                )}
              >
                <FolderInput className={cn("w-5 h-5", sourceType === "path" ? "text-teal-300" : "text-muted-foreground")} />
                <div>
                  <div className="text-sm font-bold">مسیر پوشه روی سرور</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">کد جدید از قبل روی سرور ریخته شده</div>
                </div>
              </button>
            </div>

            {sourceType === "path" ? (
              <div>
                <label className={labelCls}>مسیر کامل کد نسخهٔ جدید</label>
                <input
                  className={cn(inputCls, "ltr-input")}
                  placeholder="D:\Sources\new-version"
                  value={sourcePath}
                  onChange={(e) => setSourcePath(e.target.value)}
                  dir="ltr"
                />
              </div>
            ) : (
              <label
                className={cn(
                  "flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 bg-white/[0.02] py-7 cursor-pointer hover:border-teal-400/40 hover:bg-teal-500/5 transition-all",
                  uploading && "pointer-events-none opacity-60"
                )}
              >
                <input type="file" accept=".zip" className="hidden" onChange={(e) => e.target.files?.[0] && uploadZip(e.target.files[0])} />
                {uploading ? (
                  <>
                    <Loader2 className="w-6 h-6 text-teal-300 animate-spin" />
                    <span className="text-xs text-muted-foreground">در حال آپلود…</span>
                  </>
                ) : (
                  <>
                    <Upload className="w-6 h-6 text-teal-300" />
                    <span className="text-xs font-bold">فایل ZIP نسخهٔ جدید را اینجا رها کنید یا کلیک کنید</span>
                    {uploadInfo && (
                      <span className="text-[10px] text-emerald-300">
                        ✓ {uploadInfo.name} ({fa((uploadInfo.size / 1024 / 1024).toFixed(1))} MB) آپلود شد
                      </span>
                    )}
                  </>
                )}
              </label>
            )}

            <button
              onClick={generatePlan}
              disabled={!canPlan || status === "planning"}
              className="w-full h-11 rounded-xl bg-gradient-to-l from-teal-600 to-emerald-500 text-white text-sm font-black shadow-xl shadow-teal-900/30 hover:opacity-90 transition-opacity flex items-center justify-center gap-2 disabled:opacity-40"
            >
              {status === "planning" ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
              تولید پلن به‌روزرسانی (۶ اسکریپت)
            </button>
          </div>
        ) : (
          <div className="space-y-3 mt-2">
            <div className="space-y-1.5">
              {steps.map((s, i) => (
                <div
                  key={s.id}
                  className={cn(
                    "flex items-center justify-between rounded-xl border px-3 py-2.5",
                    s.status === "success" ? "border-emerald-400/20 bg-emerald-400/[0.06]"
                      : s.status === "running" ? "border-teal-400/35 bg-teal-400/[0.08]"
                      : s.status === "failed" ? "border-rose-400/30 bg-rose-400/[0.08]"
                      : "border-white/8 bg-white/[0.02]"
                  )}
                >
                  <div className="flex items-center gap-2.5">
                    <span className={cn(
                      "w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-black",
                      s.status === "success" ? "bg-emerald-400/20 text-emerald-300"
                        : s.status === "running" ? "bg-teal-400/25 text-teal-200"
                        : s.status === "failed" ? "bg-rose-400/25 text-rose-300"
                        : "bg-white/5 text-muted-foreground"
                    )}>
                      {s.status === "success" ? <CheckCircle2 className="w-4 h-4" />
                        : s.status === "failed" ? <XCircle className="w-4 h-4" />
                        : s.status === "running" ? <Loader2 className="w-4 h-4 animate-spin" />
                        : fa(i + 1)}
                    </span>
                    <div>
                      <div className="text-xs font-bold">{s.title}</div>
                      <div className="text-[10px] text-muted-foreground" dir="ltr">{scripts[i]?.fileName}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <LiveConsole
              lines={activeStep >= 0 ? steps[activeStep]?.output ?? [] : steps[Math.max(0, steps.findIndex((s) => s.status !== "pending"))]?.output ?? []}
              running={status === "running"}
              maxHeight={220}
            />

            {status === "planned" && (
              <div className="space-y-2">
                <label className="flex items-start gap-2.5 rounded-xl border border-white/10 bg-white/[0.03] p-3 cursor-pointer">
                  <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5 accent-teal-500" />
                  <span className="text-[11px] leading-5 text-muted-foreground">
                    تأیید می‌کنم نسخهٔ جدید به‌صورت stage می‌شود و در «سوییچ ایمن» سرویس چند ثانیه متوقف و روی نسخهٔ جدید
                    راه‌اندازی می‌شود (در صورت خطا، بازگشت خودکار).
                  </span>
                </label>
                <button
                  onClick={() => runPlan()}
                  disabled={!confirmed || isRunning}
                  className="w-full h-11 rounded-xl bg-gradient-to-l from-emerald-600 to-teal-500 text-white text-sm font-black shadow-xl shadow-emerald-900/30 hover:opacity-90 transition-opacity flex items-center justify-center gap-2 disabled:opacity-40"
                >
                  <PlayCircle className="w-4 h-4" /> اجرای به‌روزرسانی
                </button>
              </div>
            )}

            {status === "success" && (
              <div className="rounded-xl border border-emerald-400/25 bg-emerald-400/[0.07] p-4 flex items-center gap-2 text-sm font-black text-emerald-200">
                <CheckCircle2 className="w-5 h-5" /> نسخهٔ جدید فعال شد — نسخهٔ قبلی در تاریخچهٔ نسخه‌ها برای بازگشت حفظ شده است
              </div>
            )}

            {status === "failed" && (
              <div className="rounded-xl border border-rose-400/25 bg-rose-400/[0.07] p-4 text-xs leading-5">
                <div className="flex items-center gap-2 font-black text-rose-200 mb-2">
                  <XCircle className="w-4 h-4" /> به‌روزرسانی در مرحله «{failedStep?.title ?? "—"}» متوقف شد
                </div>
                {failedStep?.analysis && (
                  <div className="space-y-2">
                    <div className="rounded-lg bg-white/[0.04] border border-white/10 p-3">
                      <div className="text-[10px] text-muted-foreground mb-1">علت احتمالی (تحلیل خودکار)</div>
                      <div className="text-foreground font-bold">{failedStep.analysis.cause}</div>
                    </div>
                    {failedStep.analysis.hints.length > 0 && (
                      <ul className="rounded-lg bg-amber-400/[0.06] border border-amber-300/20 p-3 space-y-1 text-[11px] text-amber-100/90 list-disc pr-4">
                        {failedStep.analysis.hints.map((h, i) => (
                          <li key={i}>{h}</li>
                        ))}
                      </ul>
                    )}
                    <p className="text-rose-100/80">
                      اگر خطا در «سوییچ ایمن» رخ داده باشد، نسخهٔ قبلی به‌طور خودکار فعال شده است.
                    </p>
                  </div>
                )}
                <button
                  onClick={() => runPlan(Math.max(0, failIdx))}
                  disabled={isRunning}
                  className="mt-3 w-full h-10 rounded-xl bg-gradient-to-l from-amber-500 to-rose-500 text-white text-xs font-black hover:opacity-90 transition-opacity flex items-center justify-center gap-2 disabled:opacity-40"
                >
                  <RotateCcw className="w-4 h-4" /> تلاش دوباره از مرحلهٔ ناموفق
                </button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ================================================================== */
/* Health dialog — multi-level check + log rotation                    */
/* ================================================================== */

export function HealthDialog({
  target, open, onOpenChange,
}: {
  target: DeployRowLite | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [report, setReport] = useState<HealthReport | null>(null);
  const [output, setOutput] = useState<string[]>([]);
  const [checking, setChecking] = useState(false);
  const [rotating, setRotating] = useState(false);

  const runCheck = useCallback(async () => {
    if (!target) return;
    setChecking(true);
    try {
      const res = await fetch("/api/health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: target.id }),
      });
      const data = await res.json();
      if (res.ok) {
        setReport(data.report);
        setOutput(data.output ?? []);
      } else {
        toast({ title: "بررسی سلامت ناموفق", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "خطا در بررسی سلامت", variant: "destructive" });
    } finally {
      setChecking(false);
    }
  }, [target]);

  useEffect(() => {
    if (open && target && !report && !checking) runCheck();
    if (!open) {
      setReport(null);
      setOutput([]);
    }
  }, [open]);

  const rotateLogs = async () => {
    if (!target) return;
    setRotating(true);
    try {
      const res = await fetch("/api/deployments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: target.id, action: "log-rotate" }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        toast({ title: "چرخش لاگ‌ها انجام شد", description: "لاگ‌های قدیمی آرشیو و آرشیوهای کهنه حذف شدند" });
        setOutput(data.output ?? []);
      } else {
        toast({ title: "چرخش لاگ‌ها ناموفق بود", variant: "destructive" });
      }
    } catch {
      toast({ title: "خطا در چرخش لاگ‌ها", variant: "destructive" });
    } finally {
      setRotating(false);
    }
  };

  const statusIcon = (s: string) =>
    s === "ok" ? <CircleCheck className="w-5 h-5 text-emerald-400" />
      : s === "warn" ? <TriangleAlert className="w-5 h-5 text-amber-300" />
      : s === "fail" ? <XCircle className="w-5 h-5 text-rose-400" />
      : <Info className="w-5 h-5 text-sky-300" />;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl w-[calc(100vw-2rem)] max-h-[88vh] overflow-y-auto bg-[#0d1327]/95 backdrop-blur-2xl border-white/10 rounded-2xl shadow-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <HeartPulse className="w-5 h-5 text-rose-300" /> سلامت چندسطحی «{target?.displayName}»
          </DialogTitle>
        </DialogHeader>

        <p className="text-[11px] text-muted-foreground">
          باز بودن پورت به معنی سالم بودن نیست — این بررسی در ۴ سطح (سرویس، بک‌اند، دیتابیس، Nginx/HTTPS) به‌علاوهٔ هشدارهای نگهداری اجرا می‌شود.
        </p>

        <div className="flex gap-2">
          <button
            onClick={runCheck}
            disabled={checking || !target}
            className="h-10 px-4 rounded-xl bg-rose-500/15 border border-rose-400/30 text-rose-200 text-xs font-bold hover:bg-rose-500/25 transition-colors flex items-center gap-1.5 disabled:opacity-40"
          >
            {checking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCcwDot className="w-3.5 h-3.5" />}
            بررسی مجدد
          </button>
          <button
            onClick={rotateLogs}
            disabled={rotating || !target}
            className="h-10 px-4 rounded-xl bg-amber-500/15 border border-amber-400/30 text-amber-200 text-xs font-bold hover:bg-amber-500/25 transition-colors flex items-center gap-1.5 disabled:opacity-40"
          >
            {rotating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <History className="w-3.5 h-3.5" />}
            چرخش لاگ‌ها
          </button>
          {report && (
            <span className={cn(
              "h-10 px-3 rounded-xl flex items-center text-[11px] font-bold border",
              report.healthy ? "border-emerald-400/25 text-emerald-300 bg-emerald-400/8" : "border-amber-300/25 text-amber-200 bg-amber-300/8"
            )}>
              {report.healthy ? "همهٔ سطوح سالم" : "نیاز به توجه"}
              {report.simulated ? " (شبیه‌سازی)" : ""}
            </span>
          )}
        </div>

        {checking && !report && (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-14 rounded-xl bg-white/[0.03] shimmer" />
            ))}
          </div>
        )}

        {report && (
          <div className="space-y-2">
            {report.levels.map((lvl, i) => (
              <motion.div
                key={lvl.key}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                className={cn(
                  "flex items-start gap-3 rounded-xl border p-3",
                  lvl.status === "ok" ? "border-emerald-400/15 bg-emerald-400/[0.05]"
                    : lvl.status === "warn" ? "border-amber-300/15 bg-amber-300/[0.05]"
                    : lvl.status === "fail" ? "border-rose-400/15 bg-rose-400/[0.05]"
                    : "border-sky-300/15 bg-sky-300/[0.04]"
                )}
              >
                {statusIcon(lvl.status)}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{lvl.title}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5 break-all" dir="auto">{lvl.detail}</div>
                </div>
              </motion.div>
            ))}
            {report.warnings.length > 0 && (
              <div className="rounded-xl border border-amber-300/20 bg-amber-300/[0.05] p-3">
                <div className="text-[11px] font-bold text-amber-200 mb-1">هشدارهای نگهداری</div>
                <ul className="text-[11px] text-amber-100/90 space-y-0.5 list-disc pr-4" dir="auto">
                  {report.warnings.map((w) => (
                    <li key={w.key}>{w.detail}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {output.length > 0 && (
          <details>
            <summary className="text-[10px] text-muted-foreground cursor-pointer hover:text-foreground">خروجی خام اسکریپت سلامت</summary>
            <div className="mt-2">
              <LiveConsole lines={output} maxHeight={180} />
            </div>
          </details>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ================================================================== */
/* Releases dialog — version history + rollback                        */
/* ================================================================== */

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

export function ReleasesDialog({
  target, open, onOpenChange, onDone,
}: {
  target: DeployRowLite | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}) {
  const [rows, setRows] = useState<ReleaseRow[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [rolling, setRolling] = useState<string | null>(null);
  const [output, setOutput] = useState<string[]>([]);
  const [confirmTag, setConfirmTag] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!target) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/deployments/releases?id=${target.id}`);
      const data = await res.json();
      setRows(data.releases ?? []);
      setNote(data.note ?? null);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [target]);

  useEffect(() => {
    if (open && target) {
      load();
      setOutput([]);
      setConfirmTag(null);
    }
  }, [open, load, target]);

  const rollback = async (tag: string) => {
    if (!target) return;
    setRolling(tag);
    try {
      const res = await fetch("/api/deployments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: target.id, action: "rollback", tag }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        toast({ title: `به نسخهٔ ${tag} بازگشت`, description: "کد نسخهٔ قبلی فعال شد (تغییرات دیتابیس برنمی‌گردد)" });
        setConfirmTag(null);
        onDone();
        await load();
      } else {
        toast({ title: "بازگشت ناموفق بود", description: data.analysis?.cause ?? data.error, variant: "destructive" });
      }
      if (data.output) setOutput(data.output);
    } catch {
      toast({ title: "خطا در بازگشت نسخه", variant: "destructive" });
    } finally {
      setRolling(null);
    }
  };

  const statusChip = (r: ReleaseRow) => {
    const s = r.status;
    if (s === "active") return { cls: "border-emerald-400/25 text-emerald-300 bg-emerald-400/8", label: "فعال" };
    if (s === "previous") return { cls: "border-sky-300/25 text-sky-300 bg-sky-300/8", label: "قبلی" };
    if (s === "failed") return { cls: "border-rose-400/25 text-rose-300 bg-rose-400/8", label: "ناموفق" };
    if (s === "staged") return { cls: "border-amber-300/25 text-amber-200 bg-amber-300/8", label: "آماده (تست‌نشده)" };
    return { cls: "border-white/10 text-muted-foreground bg-white/5", label: s };
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl w-[calc(100vw-2rem)] max-h-[88vh] overflow-y-auto bg-[#0d1327]/95 backdrop-blur-2xl border-white/10 rounded-2xl shadow-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <History className="w-5 h-5 text-violet-300" /> تاریخچهٔ نسخه‌ها — {target?.displayName}
          </DialogTitle>
        </DialogHeader>

        {note && (
          <p className="text-[11px] text-muted-foreground rounded-xl border border-white/10 bg-white/[0.03] p-3 leading-5">{note}</p>
        )}

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-16 rounded-xl bg-white/[0.03] shimmer" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-6">
            هنوز نسخه‌ای ثبت نشده — با «به‌روزرسانی» نخستین نسخهٔ جدید ساخته می‌شود
          </p>
        ) : (
          <div className="space-y-2">
            {rows.map((r) => {
              const chip = statusChip(r);
              return (
                <div key={r.tag} className="rounded-xl border border-white/10 bg-white/[0.02] p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className={cn("text-[10px] font-bold rounded-full border px-2 py-1 shrink-0", chip.cls)}>
                        {r.isMarker && r.status === "active" ? "فعال (روی دیسک)" : chip.label}
                      </span>
                      <div className="min-w-0">
                        <div className="text-xs font-bold font-mono" dir="ltr">{r.tag}</div>
                        <div className="text-[10px] text-muted-foreground truncate" dir="ltr">{r.path}</div>
                      </div>
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0">{faTime(r.createdAt)}</span>
                  </div>
                  {r.note && <div className="text-[10px] text-muted-foreground mt-1.5">{r.note}</div>}
                  <div className="flex items-center gap-2 mt-2.5">
                    <span className={cn(
                      "text-[10px] rounded-md px-2 py-0.5 border",
                      r.onDisk ? "border-emerald-400/20 text-emerald-300" : "border-rose-400/20 text-rose-300"
                    )}>
                      {r.onDisk ? "پوشه روی دیسک موجود" : "پوشه حذف شده"}
                    </span>
                    {r.hasWww && <span className="text-[10px] rounded-md px-2 py-0.5 border border-white/10 text-muted-foreground">خروجی فرانت موجود</span>}
                    <div className="flex-1" />
                    {r.status !== "active" && r.onDisk && (
                      confirmTag === r.tag ? (
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => rollback(r.tag)}
                            disabled={rolling !== null}
                            className="h-8 px-3 rounded-lg bg-amber-500/90 text-white text-[11px] font-black hover:bg-amber-500 transition-colors flex items-center gap-1.5 disabled:opacity-40"
                          >
                            {rolling === r.tag ? <Loader2 className="w-3 h-3 animate-spin" /> : <Undo2 className="w-3 h-3" />}
                            تأیید بازگشت
                          </button>
                          <button onClick={() => setConfirmTag(null)} className="h-8 px-2.5 rounded-lg border border-white/10 bg-white/[0.03] text-[11px]">
                            انصراف
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmTag(r.tag)}
                          disabled={rolling !== null}
                          className="h-8 px-3 rounded-lg bg-violet-500/15 border border-violet-400/30 text-violet-200 text-[11px] font-bold hover:bg-violet-500/25 transition-colors flex items-center gap-1.5 disabled:opacity-40"
                        >
                          <Undo2 className="w-3 h-3" /> بازگشت به این نسخه
                        </button>
                      )
                    )}
                  </div>
                </div>
              );
            })}
            <p className="text-[10px] text-muted-foreground leading-5 rounded-lg border border-amber-300/20 bg-amber-300/[0.05] p-2.5">
              توجه: بازگشت نسخه فقط «کد» را برمی‌گرداند؛ مهاجرت‌های دیتابیسِ نسخهٔ جدید باید با ابزار خود برنامه مدیریت شوند.
            </p>
          </div>
        )}

        {output.length > 0 && (
          <details open>
            <summary className="text-[10px] text-muted-foreground cursor-pointer hover:text-foreground">خروجی اسکریپت بازگشت</summary>
            <div className="mt-2">
              <LiveConsole lines={output} maxHeight={200} />
            </div>
          </details>
        )}
      </DialogContent>
    </Dialog>
  );
}
