"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Power, Play, Square, RotateCcw, ExternalLink, Eye, Loader2, RefreshCw,
  Globe, Activity, Boxes,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { GlassCard, StatusDot, fa, faTime } from "./bits";
import { HelpButton } from "./help";

interface ServiceRow {
  id: string;
  name: string;
  displayName: string;
  domain: string;
  backendPort: number;
  status: string;
  lastDeployedAt: string | null;
  listening: boolean | null;
}

const STATUS_FA: Record<string, string> = {
  active: "فعال",
  deploying: "در حال استقرار",
  planned: "پلن تولیدشده",
  failed: "ناموفق",
  stopped: "متوقف",
};

type SvcAction = "start" | "stop" | "restart";

export function ServicesTab({ onGoSystems }: { onGoSystems: () => void }) {
  const [rows, setRows] = useState<ServiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async (soft = false) => {
    if (soft) setRefreshing(true);
    try {
      const res = await fetch("/api/services");
      if (!res.ok) return;
      const data = await res.json();
      setRows(data.services ?? []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => load(true), 5000);
    return () => clearInterval(t);
  }, [load]);

  const act = async (row: ServiceRow, action: SvcAction) => {
    setActing(`${row.id}:${action}`);
    try {
      const res = await fetch("/api/deployments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, action }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "عملیات ناموفق", description: data.error, variant: "destructive" });
        return;
      }
      if (!data.ok) {
        toast({ title: `دستور ${action === "start" ? "شروع" : action === "stop" ? "توقف" : "ری‌استارت"} روی سرویس ناموفق بود`, description: "خروجی اسکریپت را در تب سامانه‌ها بررسی کنید", variant: "destructive" });
      } else {
        const msg =
          action === "stop" ? `سامانه «${row.displayName}» متوقف شد`
          : action === "start" ? `سامانه «${row.displayName}» راه‌اندازی شد`
          : `سامانه «${row.displayName}» ری‌استارت شد`;
        toast({ title: msg, description: data.simulated ? "در حالت پیش‌نمایش شبیه‌سازی شد" : `سرویس deployguard-${row.name} مدیریت شد` });
      }
      await load();
    } catch {
      toast({ title: "خطا در ارتباط با سرور", variant: "destructive" });
    } finally {
      setActing(null);
    }
  };

  const activeCount = rows.filter((r) => r.status === "active").length;
  const stoppedCount = rows.filter((r) => r.status === "stopped" || r.status === "failed").length;

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="glass h-20 shimmer" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <HelpButton topic="services" label="راهنمای کنترل سرویس‌ها" variant="chip" />
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">
            {rows.length === 0 ? "" : (
              <>
                <b className="text-emerald-300">{fa(activeCount)}</b> فعال · <b className="text-rose-300">{fa(stoppedCount)}</b> متوقف/ناموفق
              </>
            )}
          </span>
          <button
            onClick={() => load(true)}
            title="بررسی مجدد وضعیت"
            className="h-8 w-8 rounded-lg border border-white/10 bg-white/[0.03] flex items-center justify-center text-muted-foreground hover:text-violet-200 transition-colors"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", refreshing && "animate-spin")} />
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <GlassCard className="text-center py-14">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-500/30 to-fuchsia-500/30 border border-white/10 flex items-center justify-center mx-auto mb-4 rotate-3">
            <Power className="w-7 h-7 text-violet-200" />
          </div>
          <h3 className="font-black text-lg">هنوز سرویسی برای کنترل وجود ندارد</h3>
          <p className="text-xs text-muted-foreground mt-2 leading-5">
            پس از نخستین استقرار، فهرست سرویس‌های در حال اجرا روی پورت‌ها همراه دکمه‌های کنترل همین‌جا نمایش داده می‌شود
          </p>
        </GlassCard>
      ) : (
        <div className="space-y-2.5">
          <AnimatePresence initial={false}>
            {rows.map((row, i) => {
              const isPlanned = row.status === "planned";
              const canStop = row.status === "active";
              const canStart = row.status === "stopped" || row.status === "failed";
              const canRestart = !isPlanned;
              const busy = acting !== null;
              return (
                <motion.div
                  key={row.id}
                  layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={{ delay: i * 0.04 }}
                >
                  <GlassCard hover className="px-4 py-3.5">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
                      {/* identity */}
                      <div className="flex items-center gap-2.5 min-w-0 flex-1 basis-52">
                        <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500/25 to-fuchsia-500/25 border border-white/10 flex items-center justify-center shrink-0">
                          <Boxes className="w-5 h-5 text-violet-200" />
                        </span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="font-black text-sm truncate">{row.displayName}</h3>
                            <StatusDot status={row.status} size={7} />
                            <span className={cn(
                              "text-[10px] font-bold shrink-0",
                              row.status === "active" ? "text-emerald-300"
                                : row.status === "failed" ? "text-rose-300"
                                : row.status === "stopped" ? "text-slate-300"
                                : "text-amber-200"
                            )}>
                              {STATUS_FA[row.status] ?? row.status}
                            </span>
                          </div>
                          <p className="text-[10px] text-muted-foreground truncate flex items-center gap-1.5">
                            <Globe className="w-3 h-3 shrink-0" />
                            <span dir="ltr">{row.domain}</span>
                            <span className="opacity-50">·</span>
                            <span className="font-mono" dir="ltr">deployguard-{row.name}</span>
                          </p>
                        </div>
                      </div>

                      {/* port + live listening badge */}
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-mono text-xs font-black rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5" dir="ltr">
                          :{fa(row.backendPort)}
                        </span>
                        {row.listening === null ? (
                          <span className="text-[10px] text-muted-foreground border border-white/10 rounded-full px-2 py-1">بدون سرویس</span>
                        ) : row.listening ? (
                          <span className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-200 border border-emerald-400/25 bg-emerald-400/10 rounded-full px-2 py-1">
                            <Activity className="w-3 h-3" /> روی پورت پاسخ می‌دهد
                          </span>
                        ) : (
                          <span className="flex items-center gap-1.5 text-[10px] font-bold text-rose-200 border border-rose-400/25 bg-rose-400/10 rounded-full px-2 py-1">
                            <Activity className="w-3 h-3" /> پورت بی‌پاسخ
                          </span>
                        )}
                      </div>

                      {/* control buttons */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => act(row, "start")}
                          disabled={busy || !canStart}
                          title="شروع سرویس"
                          className={cn(
                            "h-8 px-3 rounded-lg text-[11px] font-bold border transition-colors flex items-center gap-1.5 disabled:opacity-30 disabled:cursor-not-allowed",
                            "border-emerald-400/25 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/20"
                          )}
                        >
                          {acting === `${row.id}:start` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                          Start
                        </button>
                        <button
                          onClick={() => act(row, "stop")}
                          disabled={busy || !canStop}
                          title="توقف سرویس"
                          className={cn(
                            "h-8 px-3 rounded-lg text-[11px] font-bold border transition-colors flex items-center gap-1.5 disabled:opacity-30 disabled:cursor-not-allowed",
                            "border-rose-400/25 bg-rose-400/10 text-rose-200 hover:bg-rose-400/20"
                          )}
                        >
                          {acting === `${row.id}:stop` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Square className="w-3.5 h-3.5" />}
                          Stop
                        </button>
                        <button
                          onClick={() => act(row, "restart")}
                          disabled={busy || !canRestart}
                          title="ری‌استارت سرویس"
                          className={cn(
                            "h-8 px-3 rounded-lg text-[11px] font-bold border transition-colors flex items-center gap-1.5 disabled:opacity-30 disabled:cursor-not-allowed",
                            "border-amber-300/25 bg-amber-300/10 text-amber-200 hover:bg-amber-300/20"
                          )}
                        >
                          {acting === `${row.id}:restart` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                          Restart
                        </button>
                        {row.status === "active" && (
                          <a
                            href={`https://${row.domain}`}
                            target="_blank"
                            rel="noreferrer"
                            title={`بازکردن https://${row.domain}`}
                            className="h-8 w-8 rounded-lg border border-white/10 bg-white/[0.03] flex items-center justify-center text-muted-foreground hover:text-teal-200 hover:border-teal-400/30 transition-colors"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        )}
                        <button
                          onClick={onGoSystems}
                          title="جزئیات کامل، اسکریپت‌ها و حذف"
                          className="h-8 w-8 rounded-lg border border-white/10 bg-white/[0.03] flex items-center justify-center text-muted-foreground hover:text-violet-200 hover:border-violet-400/30 transition-colors"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {row.status === "failed" && (
                      <p className="mt-2.5 text-[10px] text-rose-200/80 border-t border-white/5 pt-2">
                        این سامانه با خطا مواجه شده — پیش از شروع دوباره، خروجی استقرار را در تب «سامانه‌ها» بررسی کنید
                      </p>
                    )}
                  </GlassCard>
                </motion.div>
              );
            })}
          </AnimatePresence>

          <p className="text-[10px] text-muted-foreground/70 leading-5 px-1">
            وضعیت پورت‌ها هر {fa(5)} ثانیه به‌صورت زنده بازبینی می‌شود؛ حذف کامل سامانه و مشاهدهٔ خروجی اسکریپت‌ها در تب «سامانه‌ها» انجام می‌شود.
            {rows.some((r) => r.lastDeployedAt) && (
              <> آخرین استقرار: {faTime(rows.map((r) => r.lastDeployedAt).filter(Boolean).sort().reverse()[0]!)}</>
            )}
          </p>
        </div>
      )}
    </div>
  );
}
