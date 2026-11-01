"use client";

import { motion } from "framer-motion";
import {
  Cpu, MemoryStick, HardDrive, Globe, Server, Boxes, Network, Activity,
  ShieldCheck, AlertTriangle, Clock, TerminalSquare, CircleCheck, Rocket, FlaskConical,
} from "lucide-react";
import { GlassCard, Sparkline, Ticker, StatusDot, fa, faTime } from "./bits";
import { HelpButton } from "./help";
import type { PortUsage, ServerStatus } from "@/lib/types";

interface DeployRow {
  id: string; name: string; displayName: string; domain: string;
  backendPort: number; status: string; lastDeployedAt: string | null;
}

interface LogRow {
  id: string; level: string; step: string; message: string; createdAt: string;
  deployment?: { displayName: string } | null;
}

export function DashboardTab({
  status, cpuHistory, ramHistory, ports, deployments, logs,
  onGoSystems, onGoDeploy, loading,
}: {
  status: ServerStatus | null;
  cpuHistory: number[];
  ramHistory: number[];
  ports: PortUsage[];
  deployments: DeployRow[];
  logs: LogRow[];
  onGoSystems: () => void;
  onGoDeploy: () => void;
  loading: boolean;
}) {
  const mainDisk = status?.disks?.[0];
  const activeCount = deployments.filter((d) => d.status === "active").length;
  const failedCount = deployments.filter((d) => d.status === "failed").length;
  const deployedPorts = ports.filter((p) => p.source === "deployment");
  const systemPorts = ports.filter((p) => p.source === "system");
  const nginxOk = status?.nginx.installed && status?.nginx.running;

  return (
    <div className="space-y-5">
      {/* section help */}
      <div className="flex justify-start">
        <HelpButton topic="dashboard" label="راهنمای داشبورد" variant="chip" />
      </div>

      {/* simulation banner */}
      {status?.mode === "simulation" && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass p-4 flex items-center gap-3 border-teal-400/25 bg-teal-400/[0.05]"
        >
          <FlaskConical className="w-5 h-5 text-teal-300 shrink-0" />
          <p className="text-xs leading-5 text-teal-100/90">
            <b>حالت پیش‌نمایش (شبیه‌سازی):</b> متریک‌های CPU/RAM/دیسک به‌صورت واقعی از همین میزبان خوانده می‌شوند؛ عملیات
            مخصوص ویندوز (اجرای PowerShell، سرویس ویندوز، Nginx) شبیه‌سازی می‌شود. پس از استقرار پنل روی ویندوز سرور،
            همه عملیات به‌صورت واقعی اجرا خواهد شد.
          </p>
        </motion.div>
      )}

      {/* stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <GlassCard hover className="relative overflow-hidden">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Cpu className="w-4 h-4 text-teal-300" /> پردازنده
            </div>
            {!loading && status && <span className="text-[10px] text-muted-foreground/60">{fa(status.cpu.cores)} هسته</span>}
          </div>
          <div className="mt-2 flex items-end justify-between gap-3">
            <div className="text-3xl font-black text-gradient">
              {status ? <Ticker value={status.cpu.percent} suffix="٪" /> : "—"}
            </div>
            <div className="w-28">
              <Sparkline data={cpuHistory} stroke="#2dd4bf" />
            </div>
          </div>
          {status && <p className="mt-1 text-[10px] text-muted-foreground/70 truncate" dir="ltr">{status.cpu.model}</p>}
        </GlassCard>

        <GlassCard hover className="relative overflow-hidden">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <MemoryStick className="w-4 h-4 text-violet-300" /> حافظه RAM
            </div>
            {status && (
              <span className="text-[10px] text-muted-foreground/60">
                {fa(status.ram.usedGb.toFixed(1))} / {fa(status.ram.totalGb.toFixed(1))} GB
              </span>
            )}
          </div>
          <div className="mt-2 flex items-end justify-between gap-3">
            <div className="text-3xl font-black text-gradient">
              {status ? <Ticker value={status.ram.percent} suffix="٪" /> : "—"}
            </div>
            <div className="w-28">
              <Sparkline data={ramHistory} stroke="#a78bfa" />
            </div>
          </div>
        </GlassCard>

        <GlassCard hover>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <HardDrive className="w-4 h-4 text-fuchsia-300" /> دیسک
            </div>
            {mainDisk && <span className="text-[10px] text-muted-foreground/60" dir="ltr">{mainDisk.letter}</span>}
          </div>
          <div className="mt-2 text-3xl font-black text-gradient">
            {mainDisk ? <Ticker value={mainDisk.usedPercent} suffix="٪" /> : "—"}
          </div>
          <div className="mt-2 h-1.5 rounded-full bg-white/8 overflow-hidden">
            <motion.div
              className="h-full rounded-full bg-gradient-to-l from-fuchsia-400 to-violet-400"
              animate={{ width: `${mainDisk?.usedPercent ?? 0}%` }}
              transition={{ duration: 0.8 }}
            />
          </div>
          {mainDisk && (
            <p className="mt-1.5 text-[10px] text-muted-foreground/70">
              {fa(mainDisk.freeGb.toFixed(1))} گیگابایت آزاد از {fa(mainDisk.totalGb.toFixed(1))} GB
            </p>
          )}
        </GlassCard>

        <GlassCard hover>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Globe className="w-4 h-4 text-emerald-300" /> Nginx
            </div>
            {nginxOk ? (
              <span className="flex items-center gap-1.5 text-[10px] text-emerald-300">
                <StatusDot status="active" size={8} /> فعال
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-[10px] text-rose-300">
                <AlertTriangle className="w-3 h-3" /> غیرفعال
              </span>
            )}
          </div>
          <div className="mt-2 text-lg font-black text-gradient">nginx/{status?.nginx.version ?? "—"}</div>
          <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
            <div className="flex items-center justify-between">
              <span>تست کانفیگ</span>
              <span className={status?.nginx.configOk ? "text-emerald-300" : "text-rose-300"}>
                {status?.nginx.configOk ? "successful" : "failed"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>سایت‌های فعال</span>
              <span className="text-foreground font-bold">{fa(activeCount)}</span>
            </div>
          </div>
        </GlassCard>
      </div>

      {/* middle row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* environment */}
        <GlassCard>
          <div className="flex items-center gap-2 text-sm font-bold mb-4">
            <Server className="w-4 h-4 text-violet-300" /> محیط اجرا
          </div>
          <div className="space-y-2.5">
            {[
              { label: "سیستم‌عامل", value: status?.os ?? "…", ok: true, ltr: true },
              { label: "Python", value: status?.services.python ?? "نصب نیست", ok: !!status?.services.python },
              { label: "Node.js", value: status?.services.node ?? "نصب نیست", ok: !!status?.services.node },
              { label: "Nginx", value: status?.nginx.installed ? `v${status.nginx.version}` : "نصب نیست", ok: !!status?.nginx.installed },
              { label: "WinSW", value: status?.services.winsw ?? "در هنگام استقرار دانلود می‌شود", ok: true },
            ].map((row) => (
              <div key={row.label} className="flex items-center justify-between gap-2 rounded-lg bg-white/[0.03] border border-white/8 px-3 py-2">
                <span className="text-xs text-muted-foreground">{row.label}</span>
                <span className={`text-xs font-medium flex items-center gap-1.5 ${row.ok ? "text-emerald-300" : "text-amber-300"}`}>
                  {row.ok && <CircleCheck className="w-3.5 h-3.5" />}
                  <span dir={row.ltr ? "ltr" : undefined} className="truncate max-w-[180px]">{row.value}</span>
                </span>
              </div>
            ))}
            <div className="flex items-center justify-between rounded-lg bg-white/[0.03] border border-white/8 px-3 py-2">
              <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" /> آپ‌تایم سرور
              </span>
              <span className="text-xs font-bold text-gradient">{status ? `${fa(Math.floor(status.uptimeHours))} ساعت` : "…"}</span>
            </div>
          </div>
        </GlassCard>

        {/* deployments summary */}
        <GlassCard>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2 text-sm font-bold">
              <Boxes className="w-4 h-4 text-fuchsia-300" /> سامانه‌های مستقر
            </div>
            <button onClick={onGoSystems} className="text-[11px] text-violet-300 hover:text-violet-200 transition-colors">
              مدیریت سامانه‌ها ←
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2 mb-3">
            {[
              { label: "فعال", count: activeCount, cls: "text-emerald-300 border-emerald-400/20 bg-emerald-400/8" },
              { label: "ناموفق", count: failedCount, cls: "text-rose-300 border-rose-400/20 bg-rose-400/8" },
              { label: "کل", count: deployments.length, cls: "text-violet-200 border-violet-400/20 bg-violet-400/8" },
            ].map((s) => (
              <div key={s.label} className={`rounded-xl border px-2 py-3 text-center ${s.cls}`}>
                <div className="text-2xl font-black">{fa(s.count)}</div>
                <div className="text-[10px] opacity-80 mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>
          <div className="space-y-2 max-h-44 overflow-y-auto">
            {deployments.length === 0 && (
              <div className="text-center py-6">
                <p className="text-xs text-muted-foreground mb-3">هنوز سامانه‌ای مستقر نشده است</p>
                <button
                  onClick={onGoDeploy}
                  className="inline-flex items-center gap-1.5 text-xs font-bold px-3.5 py-2 rounded-lg bg-gradient-to-l from-violet-600 to-fuchsia-600 text-white shadow-lg shadow-violet-900/30 hover:opacity-90 transition-opacity"
                >
                  <Rocket className="w-3.5 h-3.5" /> نخستین استقرار
                </button>
              </div>
            )}
            {deployments.slice(0, 6).map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-2 rounded-lg bg-white/[0.03] border border-white/8 px-3 py-2">
                <div className="flex items-center gap-2 min-w-0">
                  <StatusDot status={d.status} />
                  <div className="min-w-0">
                    <div className="text-xs font-bold truncate">{d.displayName}</div>
                    <div className="text-[10px] text-muted-foreground truncate" dir="ltr">{d.domain}</div>
                  </div>
                </div>
                <span className="text-[10px] rounded-md bg-white/5 border border-white/10 px-1.5 py-0.5" dir="ltr">
                  :{d.backendPort}
                </span>
              </div>
            ))}
          </div>
        </GlassCard>

        {/* ports */}
        <GlassCard>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2 text-sm font-bold">
              <Network className="w-4 h-4 text-teal-300" /> نقشه پورت‌ها
            </div>
            <span className="text-[11px] text-muted-foreground">
              {fa(ports.length)} پورت در حال شنیدن
            </span>
          </div>
          {deployedPorts.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {deployedPorts.map((p) => (
                <span key={p.port} className="inline-flex items-center gap-1 text-[10px] rounded-full border border-teal-400/30 bg-teal-400/10 text-teal-200 px-2 py-0.5" dir="ltr">
                  :{p.port} <span className="opacity-60">←</span> {p.deploymentName}
                </span>
              ))}
            </div>
          )}
          <div className="space-y-1 max-h-52 overflow-y-auto" dir="ltr">
            {ports.slice(0, 12).map((p) => (
              <div key={p.port} className="flex items-center justify-between rounded-md px-2.5 py-1.5 text-[11px] hover:bg-white/[0.04] transition-colors">
                <span className={`font-bold ${p.source === "deployment" ? "text-teal-300" : "text-slate-300"}`}>:{p.port}</span>
                <span className="text-muted-foreground">{p.process}</span>
                <span className="text-muted-foreground/60">pid {p.pid ?? "—"}</span>
              </div>
            ))}
            {ports.length === 0 && <div className="text-[11px] text-muted-foreground text-center py-4">در حال خواندن پورت‌ها…</div>}
          </div>
        </GlassCard>
      </div>

      {/* event feed */}
      <GlassCard>
        <div className="flex items-center gap-2 text-sm font-bold mb-3">
          <Activity className="w-4 h-4 text-amber-300" /> جریان رویدادها
          <span className="text-[10px] font-normal text-muted-foreground">— آخرین عملیات استقرار و اجرای اسکریپت‌ها</span>
        </div>
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {logs.length === 0 && <div className="text-xs text-muted-foreground text-center py-4">رویدادی ثبت نشده است</div>}
          {logs.map((log) => (
            <motion.div
              key={log.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-start gap-3 rounded-lg bg-white/[0.03] border border-white/8 px-3 py-2"
            >
              <span
                className={`mt-1 w-2 h-2 rounded-full shrink-0 ${
                  log.level === "success" ? "bg-emerald-400" : log.level === "error" ? "bg-rose-400" : "bg-sky-300"
                }`}
              />
              <div className="flex-1 min-w-0">
                <p className="text-xs leading-5">{log.message}</p>
                {log.deployment?.displayName && (
                  <span className="text-[10px] text-muted-foreground/70">{log.deployment.displayName}</span>
                )}
              </div>
              <span className="text-[10px] text-muted-foreground/60 shrink-0">{faTime(log.createdAt)}</span>
            </motion.div>
          ))}
        </div>
      </GlassCard>
    </div>
  );
}
