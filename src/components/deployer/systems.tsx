"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Boxes, Globe, FolderOpen, Play, Square, RotateCcw, Trash2, Eye, Loader2,
  ScrollText, FileCode2, ServerCog, ExternalLink, ShieldAlert, Clock, Zip,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { GlassCard, StatusDot, CodeBlock, LiveConsole, fa, faTime } from "./bits";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { GeneratedScript, StepState } from "@/lib/types";

interface DeployRow {
  id: string; name: string; displayName: string; domain: string;
  backendPort: number; sourceType: string; sourcePath: string | null;
  deployPath: string; sslCertPath: string; sslKeyPath: string; nginxPath: string;
  status: string; statusDetail: string | null; lastDeployedAt: string | null;
  createdAt: string; lastRunId: string | null; lastRunStatus: string | null;
}

interface RunDetail {
  id: string; status: string;
  scripts: GeneratedScript[];
  steps: StepState[];
  nginxConf: string;
  deployment: { name: string; displayName: string; domain: string; deployPath: string; nginxPath: string };
}

interface LogRow {
  id: string; level: string; step: string; message: string; createdAt: string;
}

const STATUS_FA: Record<string, string> = {
  active: "فعال",
  deploying: "در حال استقرار",
  planned: "پلن تولیدشده",
  failed: "ناموفق",
  stopped: "متوقف",
  removed: "حذف‌شده",
};

export function SystemsTab({ refreshKey }: { refreshKey: number }) {
  const [deployments, setDeployments] = useState<DeployRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<DeployRow | null>(null);
  const [run, setRun] = useState<RunDetail | null>(null);
  const [runLoading, setRunLoading] = useState(false);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [acting, setActing] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<DeployRow | null>(null);
  const [openScript, setOpenScript] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/deployments");
      const data = await res.json();
      setDeployments(data.deployments ?? []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const openDetail = async (d: DeployRow) => {
    setDetail(d);
    setRun(null);
    if (d.lastRunId) {
      setRunLoading(true);
      try {
        const [runRes, logsRes] = await Promise.all([fetch(`/api/runs/${d.lastRunId}`), fetch(`/api/logs?limit=25`)]);
        const runData = await runRes.json();
        setRun(runData);
        const logsData = await logsRes.json();
        setLogs(logsData.logs ?? []);
      } catch {
        /* ignore */
      } finally {
        setRunLoading(false);
      }
    }
  };

  const act = async (d: DeployRow, action: "start" | "stop" | "restart" | "remove") => {
    setActing(`${d.id}:${action}`);
    try {
      const res = await fetch("/api/deployments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: d.id, action }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "عملیات ناموفق", description: data.error, variant: "destructive" });
        return;
      }
      if (action === "remove") {
        toast({ title: data.ok ? "سامانه حذف شد" : "حذف با خطا مواجه شد", description: data.ok ? "سرویس، کانفیگ Nginx و پوشه سامانه پاک‌سازی شد" : undefined, variant: data.ok ? "default" : "destructive" });
        setRemoveTarget(null);
        setDetail(null);
      } else {
        toast({ title: data.ok ? `سرویس ${STATUS_FA[data.status] === "فعال" ? "فعال" : "متوقف"} شد` : "عملیات سرویس ناموفق بود", variant: data.ok ? "default" : "destructive" });
      }
      await load();
    } catch {
      toast({ title: "خطا در ارتباط با سرور", variant: "destructive" });
    } finally {
      setActing(null);
    }
  };

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="glass p-5 h-44 shimmer" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {deployments.length === 0 && (
        <GlassCard className="text-center py-14">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-500/30 to-fuchsia-500/30 border border-white/10 flex items-center justify-center mx-auto mb-4 rotate-3">
            <Boxes className="w-7 h-7 text-violet-200" />
          </div>
          <h3 className="font-black text-lg">هنوز سامانه‌ای مستقر نشده است</h3>
          <p className="text-xs text-muted-foreground mt-2 leading-5">
            از تب «استقرار جدید» نخستین سامانه FastAPI + React خود را روی این سرور مستقر کنید
          </p>
        </GlassCard>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {deployments.map((d, i) => (
          <motion.div key={d.id} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
            <GlassCard hover className="h-full flex flex-col">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500/25 to-fuchsia-500/25 border border-white/10 flex items-center justify-center shrink-0">
                    <Boxes className="w-4.5 h-4.5 text-violet-200 w-5 h-5" />
                  </span>
                  <div className="min-w-0">
                    <h3 className="font-black text-sm truncate">{d.displayName}</h3>
                    <p className="text-[10px] text-muted-foreground truncate" dir="ltr">{d.domain}</p>
                  </div>
                </div>
                <span className={cn(
                  "flex items-center gap-1.5 text-[10px] font-bold rounded-full border px-2 py-1 shrink-0",
                  d.status === "active" ? "border-emerald-400/25 text-emerald-300 bg-emerald-400/8"
                    : d.status === "failed" ? "border-rose-400/25 text-rose-300 bg-rose-400/8"
                    : d.status === "stopped" ? "border-slate-400/25 text-slate-300 bg-slate-400/8"
                    : "border-amber-300/25 text-amber-200 bg-amber-300/8"
                )}>
                  <StatusDot status={d.status} size={7} />
                  {STATUS_FA[d.status] ?? d.status}
                </span>
              </div>

              <div className="mt-4 space-y-1.5 text-[11px] flex-1">
                <div className="flex items-center justify-between rounded-lg bg-white/[0.03] px-2.5 py-1.5">
                  <span className="text-muted-foreground flex items-center gap-1.5"><Globe className="w-3 h-3" /> پورت بک‌اند</span>
                  <span className="font-bold" dir="ltr">:{d.backendPort}</span>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-white/[0.03] px-2.5 py-1.5">
                  <span className="text-muted-foreground flex items-center gap-1.5"><FolderOpen className="w-3 h-3" /> پوشه استقرار</span>
                  <span className="font-mono text-[10px] truncate max-w-[160px]" dir="ltr">{d.deployPath}</span>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-white/[0.03] px-2.5 py-1.5">
                  <span className="text-muted-foreground flex items-center gap-1.5"><Clock className="w-3 h-3" /> آخرین استقرار</span>
                  <span className="font-bold">{d.lastDeployedAt ? faTime(d.lastDeployedAt) : "—"}</span>
                </div>
              </div>

              <div className="mt-4 flex items-center gap-1.5">
                <button
                  onClick={() => openDetail(d)}
                  className="flex-1 h-9 rounded-lg bg-violet-500/15 border border-violet-400/30 text-violet-200 text-[11px] font-bold hover:bg-violet-500/25 transition-colors flex items-center justify-center gap-1.5"
                >
                  <Eye className="w-3.5 h-3.5" /> جزئیات
                </button>
                {d.status === "active" ? (
                  <button
                    onClick={() => act(d, "stop")}
                    disabled={acting !== null}
                    title="توقف سرویس"
                    className="h-9 w-9 rounded-lg border border-white/10 bg-white/[0.03] flex items-center justify-center text-muted-foreground hover:text-rose-300 hover:border-rose-400/30 transition-colors disabled:opacity-40"
                  >
                    {acting === `${d.id}:stop` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Square className="w-3.5 h-3.5" />}
                  </button>
                ) : (
                  <button
                    onClick={() => act(d, "start")}
                    disabled={acting !== null || d.status === "planned"}
                    title="راه‌اندازی سرویس"
                    className="h-9 w-9 rounded-lg border border-white/10 bg-white/[0.03] flex items-center justify-center text-muted-foreground hover:text-emerald-300 hover:border-emerald-400/30 transition-colors disabled:opacity-40"
                  >
                    {acting === `${d.id}:start` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                  </button>
                )}
                <button
                  onClick={() => act(d, "restart")}
                  disabled={acting !== null}
                  title="راه‌اندازی مجدد"
                  className="h-9 w-9 rounded-lg border border-white/10 bg-white/[0.03] flex items-center justify-center text-muted-foreground hover:text-amber-300 hover:border-amber-400/30 transition-colors disabled:opacity-40"
                >
                  {acting === `${d.id}:restart` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                </button>
                <button
                  onClick={() => setRemoveTarget(d)}
                  disabled={acting !== null}
                  title="حذف کامل"
                  className="h-9 w-9 rounded-lg border border-white/10 bg-white/[0.03] flex items-center justify-center text-muted-foreground hover:text-rose-300 hover:border-rose-400/30 transition-colors disabled:opacity-40"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </GlassCard>
          </motion.div>
        ))}
      </div>

      {/* detail dialog */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="sm:max-w-4xl w-[calc(100vw-2rem)] max-h-[88vh] overflow-y-auto bg-[#0d1327]/95 backdrop-blur-2xl border-white/10 min-w-0 rounded-2xl shadow-2xl">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2.5 text-lg">
                  <StatusDot status={detail.status} />
                  {detail.displayName}
                  <span className="text-xs font-normal text-muted-foreground" dir="ltr">{detail.domain}</span>
                </DialogTitle>
              </DialogHeader>

              {runLoading ? (
                <div className="space-y-3 py-6">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="h-16 rounded-xl bg-white/[0.04] shimmer" />
                  ))}
                </div>
              ) : (
                <Tabs defaultValue="run" dir="rtl" className="mt-2 min-w-0 w-full">
                  <TabsList className="bg-white/[0.04] border border-white/10 h-auto p-1 flex-wrap">
                    <TabsTrigger value="run" className="text-xs data-[state=active]:bg-violet-500/25">خروجی استقرار</TabsTrigger>
                    <TabsTrigger value="scripts" className="text-xs data-[state=active]:bg-violet-500/25">اسکریپت‌های PowerShell</TabsTrigger>
                    <TabsTrigger value="nginx" className="text-xs data-[state=active]:bg-violet-500/25">کانفیگ Nginx</TabsTrigger>
                    <TabsTrigger value="events" className="text-xs data-[state=active]:bg-violet-500/25">رویدادها</TabsTrigger>
                  </TabsList>

                  <TabsContent value="run" className="mt-3 space-y-2">
                    {run?.steps.map((s) => (
                      <div key={s.id} className={cn(
                        "rounded-xl border px-3.5 py-2.5",
                        s.status === "success" ? "border-emerald-400/20 bg-emerald-400/[0.05]"
                          : s.status === "failed" ? "border-rose-400/25 bg-rose-400/[0.06]"
                          : "border-white/10 bg-white/[0.02]"
                      )}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <StatusDot status={s.status === "success" ? "active" : s.status === "failed" ? "failed" : "planned"} size={8} />
                            <span className="text-xs font-bold">{s.title}</span>
                          </div>
                          {s.durationMs > 0 && (
                            <span className="text-[10px] text-muted-foreground" dir="ltr">{(s.durationMs / 1000).toFixed(1)}s</span>
                          )}
                        </div>
                        {s.output.length > 0 && (
                          <details className="mt-2">
                            <summary className="text-[10px] text-muted-foreground cursor-pointer hover:text-foreground transition-colors">
                              نمایش خروجی اسکریپت ({fa(s.output.length)} خط)
                            </summary>
                            <div className="mt-2">
                              <LiveConsole lines={s.output} maxHeight={220} />
                            </div>
                          </details>
                        )}
                      </div>
                    ))}
                    {!run && <p className="text-xs text-muted-foreground py-4 text-center">رکورد اجرایی برای این سامانه یافت نشد</p>}
                  </TabsContent>

                  <TabsContent value="scripts" className="mt-3 space-y-2.5">
                    {run?.scripts.map((s) => (
                      <div key={s.id} className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
                        <button
                          onClick={() => setOpenScript(openScript === s.id ? null : s.id)}
                          className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.03] transition-colors"
                        >
                          <div className="flex items-center gap-2.5">
                            <FileCode2 className="w-4 h-4 text-violet-300" />
                            <div className="text-right">
                              <div className="text-xs font-bold">{s.title}</div>
                              <div className="text-[10px] text-muted-foreground" dir="ltr">{s.fileName}</div>
                            </div>
                          </div>
                        </button>
                        <AnimatePresence>
                          {openScript === s.id && (
                            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                              <div className="p-3 pt-0">
                                <CodeBlock code={s.content} maxHeight={300} downloadName={s.fileName} />
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    ))}
                    {!run && <p className="text-xs text-muted-foreground py-4 text-center">اسکریپتی ذخیره نشده است</p>}
                  </TabsContent>

                  <TabsContent value="nginx" className="mt-3">
                    {run?.nginxConf ? (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between rounded-lg bg-white/[0.03] border border-white/10 px-3 py-2 text-[11px]">
                          <span className="text-muted-foreground flex items-center gap-1.5"><ServerCog className="w-3.5 h-3.5" /> مسیر فایل</span>
                          <span className="font-mono" dir="ltr">{run.deployment.nginxPath}\conf\conf.d\{run.deployment.name}.conf</span>
                        </div>
                        <CodeBlock code={run.nginxConf} maxHeight={380} downloadName={`${run.deployment.name}.conf`} />
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground py-4 text-center">کانفیگ Nginx در دسترس نیست</p>
                    )}
                  </TabsContent>

                  <TabsContent value="events" className="mt-3 space-y-2">
                    {logs.map((l) => (
                      <div key={l.id} className="flex items-start gap-2.5 rounded-lg bg-white/[0.03] border border-white/8 px-3 py-2">
                        <span className={cn("mt-1 w-2 h-2 rounded-full shrink-0", l.level === "success" ? "bg-emerald-400" : l.level === "error" ? "bg-rose-400" : "bg-sky-300")} />
                        <p className="text-[11px] leading-5 flex-1">{l.message}</p>
                        <span className="text-[10px] text-muted-foreground/60 shrink-0">{faTime(l.createdAt)}</span>
                      </div>
                    ))}
                    {logs.length === 0 && <p className="text-xs text-muted-foreground py-4 text-center">رویدادی ثبت نشده است</p>}
                  </TabsContent>
                </Tabs>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* remove confirm */}
      <Dialog open={!!removeTarget} onOpenChange={(o) => !o && setRemoveTarget(null)}>
        <DialogContent className="sm:max-w-md bg-[#0d1327]/95 backdrop-blur-2xl border-white/10 rounded-2xl shadow-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-rose-200">
              <ShieldAlert className="w-5 h-5" /> حذف کامل سامانه
            </DialogTitle>
          </DialogHeader>
          {removeTarget && (
            <>
              <p className="text-xs leading-6 text-muted-foreground mt-1">
                سامانه «<b className="text-foreground">{removeTarget.displayName}</b>» ({removeTarget.domain}) به‌طور کامل حذف می‌شود:
              </p>
              <ul className="text-[11px] leading-6 text-muted-foreground list-disc pr-5 space-y-1">
                <li>توقف و حذف سرویس ویندوز <span className="font-mono" dir="ltr">deployguard-{removeTarget.name}</span></li>
                <li>حذف کانفیگ <span className="font-mono" dir="ltr">{removeTarget.nginxPath}\conf\conf.d\{removeTarget.name}.conf</span> و ریلود Nginx</li>
                <li>آرشیو لاگ‌ها و سپس حذف پوشه <span className="font-mono" dir="ltr">{removeTarget.deployPath}</span></li>
              </ul>
              <div className="grid grid-cols-2 gap-2 mt-4">
                <button onClick={() => setRemoveTarget(null)} className="h-10 rounded-xl border border-white/10 bg-white/[0.03] text-xs font-bold hover:bg-white/[0.06] transition-colors">
                  انصراف
                </button>
                <button
                  onClick={() => act(removeTarget, "remove")}
                  disabled={acting !== null}
                  className="h-10 rounded-xl bg-rose-600/90 text-white text-xs font-black hover:bg-rose-600 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  {acting === `${removeTarget.id}:remove` ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  حذف قطعی
                </button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
