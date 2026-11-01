"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Rocket, LayoutDashboard, Boxes, Rocket as RocketIcon, Settings, LogOut,
  KeyRound, Loader2, X, FlaskConical, MonitorCog,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { AuroraBackground, fa } from "@/components/deployer/bits";
import { LoginScreen } from "@/components/deployer/login";
import { DashboardTab } from "@/components/deployer/dashboard";
import { DeployWizard } from "@/components/deployer/wizard";
import { SystemsTab } from "@/components/deployer/systems";
import { HeaderHelpButton } from "@/components/deployer/help";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { PortUsage, ServerStatus } from "@/lib/types";

type Tab = "dashboard" | "deploy" | "systems";

interface DeployRow {
  id: string; name: string; displayName: string; domain: string;
  backendPort: number; status: string; lastDeployedAt: string | null;
}

interface LogRow {
  id: string; level: string; step: string; message: string; createdAt: string;
  deployment?: { displayName: string } | null;
}

export default function Home() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [mode, setMode] = useState<"live" | "simulation">("simulation");
  const [tab, setTab] = useState<Tab>("dashboard");
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [cpuHistory, setCpuHistory] = useState<number[]>([]);
  const [ramHistory, setRamHistory] = useState<number[]>([]);
  const [ports, setPorts] = useState<PortUsage[]>([]);
  const [deployments, setDeployments] = useState<DeployRow[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [systemsKey, setSystemsKey] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pwCurrent, setPwCurrent] = useState("");
  const [pwNext, setPwNext] = useState("");
  const [changingPw, setChangingPw] = useState(false);
  const cpuHistRef = useRef<number[]>([]);

  /* ------------------------------ auth ------------------------------ */
  useEffect(() => {
    fetch("/api/auth")
      .then((r) => r.json())
      .then((d) => {
        setAuthed(!!d.authenticated);
        if (d.mode) setMode(d.mode);
      })
      .catch(() => setAuthed(false));
  }, []);

  /* ------------------------------ polling ------------------------------ */
  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/server-status");
      if (res.status === 401) {
        setAuthed(false);
        return;
      }
      const data: ServerStatus = await res.json();
      setStatus(data);
      cpuHistRef.current = [...cpuHistRef.current, data.cpu.percent].slice(-40);
      setCpuHistory(cpuHistRef.current);
      setRamHistory((prev) => [...prev, data.ram.percent].slice(-40));
    } catch {
      /* ignore */
    }
  }, []);

  const loadPorts = useCallback(async () => {
    try {
      const res = await fetch("/api/ports");
      if (!res.ok) return;
      const data = await res.json();
      setPorts(data.ports ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  const loadDeployments = useCallback(async () => {
    try {
      const res = await fetch("/api/deployments");
      if (!res.ok) return;
      const data = await res.json();
      setDeployments(data.deployments ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  const loadLogs = useCallback(async () => {
    try {
      const res = await fetch("/api/logs?limit=20");
      if (!res.ok) return;
      const data = await res.json();
      setLogs(data.logs ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!authed) return;
    loadStatus();
    loadPorts();
    loadDeployments();
    loadLogs();
    const t1 = setInterval(loadStatus, 4000);
    const t2 = setInterval(loadPorts, 20000);
    const t3 = setInterval(loadLogs, 15000);
    return () => {
      clearInterval(t1);
      clearInterval(t2);
      clearInterval(t3);
    };
  }, [authed, loadStatus, loadPorts, loadDeployments, loadLogs]);

  const refreshAll = useCallback(() => {
    loadDeployments();
    loadPorts();
    loadLogs();
  }, [loadDeployments, loadPorts, loadLogs]);

  /* ------------------------------ actions ------------------------------ */
  const logout = async () => {
    await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "logout" }),
    });
    setAuthed(false);
  };

  const changePw = async () => {
    setChangingPw(true);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "change", current: pwCurrent, next: pwNext }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: data.error ?? "تغییر رمز ناموفق", variant: "destructive" });
        return;
      }
      toast({ title: "رمز عبور تغییر کرد", description: "از دفعات بعد با رمز جدید وارد شوید" });
      setSettingsOpen(false);
      setPwCurrent("");
      setPwNext("");
    } finally {
      setChangingPw(false);
    }
  };

  /* ------------------------------ render ------------------------------ */
  if (authed === null) {
    return (
      <div className="relative min-h-screen flex items-center justify-center">
        <AuroraBackground />
        <Loader2 className="w-8 h-8 text-violet-300 animate-spin" />
      </div>
    );
  }

  if (!authed) {
    return <LoginScreen simulation={mode === "simulation"} onSuccess={() => setAuthed(true)} />;
  }

  const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: "dashboard", label: "داشبورد سرور", icon: LayoutDashboard },
    { id: "deploy", label: "استقرار جدید", icon: RocketIcon },
    { id: "systems", label: "سامانه‌ها", icon: Boxes },
  ];

  return (
    <div className="relative min-h-screen flex flex-col">
      <AuroraBackground />

      {/* header */}
      <header className="sticky top-0 z-40 border-b border-white/8 bg-[#070b18]/70 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative shrink-0">
              <div className="absolute inset-0 blur-lg bg-violet-500/40 rounded-xl" />
              <div className="relative w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 via-fuchsia-500 to-teal-400 flex items-center justify-center shadow-lg rotate-2">
                <Rocket className="w-5 h-5 text-white -rotate-2" />
              </div>
            </div>
            <div className="min-w-0">
              <h1 className="font-black text-lg leading-5 truncate">
                استقرار<span className="text-gradient">بان</span>
              </h1>
              <p className="text-[10px] text-muted-foreground truncate">
                استقرار استاندارد FastAPI + React روی ویندوز سرور
              </p>
            </div>
          </div>

          <nav className="hidden md:flex items-center gap-1 rounded-2xl border border-white/10 bg-white/[0.03] p-1">
            {TABS.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    "relative flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all",
                    tab === t.id ? "text-white" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {tab === t.id && (
                    <motion.span
                      layoutId="tab-pill"
                      className="absolute inset-0 rounded-xl bg-gradient-to-l from-violet-600/70 to-fuchsia-600/70 shadow-lg shadow-violet-900/40"
                      transition={{ type: "spring", bounce: 0.18, duration: 0.5 }}
                    />
                  )}
                  <Icon className="w-4 h-4 relative z-10" />
                  <span className="relative z-10">{t.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="flex items-center gap-1.5 shrink-0">
            <HeaderHelpButton />
            {status?.mode === "simulation" && (
              <span className="hidden sm:flex items-center gap-1.5 text-[10px] font-bold text-teal-200 border border-teal-400/25 bg-teal-400/10 rounded-full px-2.5 py-1.5">
                <FlaskConical className="w-3 h-3" /> پیش‌نمایش
              </span>
            )}
            {status?.mode === "live" && (
              <span className="hidden sm:flex items-center gap-1.5 text-[10px] font-bold text-emerald-200 border border-emerald-400/25 bg-emerald-400/10 rounded-full px-2.5 py-1.5">
                <MonitorCog className="w-3 h-3" /> متصل به سرور
              </span>
            )}
            <button
              onClick={() => setSettingsOpen(true)}
              className="w-9 h-9 rounded-xl border border-white/10 bg-white/[0.03] flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
              title="تنظیمات"
            >
              <Settings className="w-4 h-4" />
            </button>
            <button
              onClick={logout}
              className="w-9 h-9 rounded-xl border border-white/10 bg-white/[0.03] flex items-center justify-center text-muted-foreground hover:text-rose-300 transition-colors"
              title="خروج"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* mobile tabs */}
        <nav className="md:hidden flex items-center gap-1 px-4 pb-2.5 overflow-x-auto">
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "flex items-center gap-1.5 rounded-xl px-3 py-2 text-[11px] font-bold whitespace-nowrap border transition-all",
                  tab === t.id
                    ? "border-violet-400/40 bg-violet-500/15 text-white"
                    : "border-white/10 bg-white/[0.02] text-muted-foreground"
                )}
              >
                <Icon className="w-3.5 h-3.5" /> {t.label}
              </button>
            );
          })}
        </nav>
      </header>

      {/* content */}
      <main className="relative z-10 flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6">
        {tab === "dashboard" && (
          <DashboardTab
            status={status}
            cpuHistory={cpuHistory}
            ramHistory={ramHistory}
            ports={ports}
            deployments={deployments}
            logs={logs}
            onGoSystems={() => setTab("systems")}
            onGoDeploy={() => setTab("deploy")}
            loading={status === null}
          />
        )}
        {tab === "deploy" && <DeployWizard simulation={mode === "simulation"} onDeployed={refreshAll} />}
        {tab === "systems" && <SystemsTab refreshKey={systemsKey} />}
      </main>

      {/* footer */}
      <footer className="relative z-10 mt-auto border-t border-white/8 bg-[#070b18]/60 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span>
            استقراربان — استقرار خودکار FastAPI + React با Nginx و SSL روی ویندوز سرور
          </span>
          <span className="flex items-center gap-3">
            <span>{status?.hostname && <span dir="ltr">🖥 {status.hostname}</span>}</span>
            <span>{fa(deployments.filter((d) => d.status === "active").length)} سامانه فعال</span>
          </span>
        </div>
      </footer>

      {/* settings dialog */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="sm:max-w-sm bg-[#0d1327]/95 backdrop-blur-2xl border-white/10 rounded-2xl shadow-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-violet-300" /> تغییر رمز عبور ادمین
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">رمز فعلی</label>
              <input
                type="password"
                value={pwCurrent}
                onChange={(e) => setPwCurrent(e.target.value)}
                className="w-full h-10 rounded-xl bg-white/[0.05] border border-white/10 px-3 text-sm outline-none focus:border-violet-400/50 transition-all"
                dir="ltr"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">رمز جدید (حداقل ۸ کاراکتر)</label>
              <input
                type="password"
                value={pwNext}
                onChange={(e) => setPwNext(e.target.value)}
                className="w-full h-10 rounded-xl bg-white/[0.05] border border-white/10 px-3 text-sm outline-none focus:border-violet-400/50 transition-all"
                dir="ltr"
              />
            </div>
            <button
              onClick={changePw}
              disabled={changingPw || !pwCurrent || pwNext.length < 8}
              className="w-full h-10 rounded-xl bg-gradient-to-l from-violet-600 to-fuchsia-600 text-white text-xs font-black hover:opacity-90 transition-opacity flex items-center justify-center gap-2 disabled:opacity-40"
            >
              {changingPw && <Loader2 className="w-4 h-4 animate-spin" />}
              ثبت رمز جدید
            </button>
            <p className="text-[10px] text-muted-foreground leading-5">
              توصیه امنیتی: رمز پیش‌فرض <span className="font-mono">admin1234</span> را پیش از استقرار واقعی تغییر دهید.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
