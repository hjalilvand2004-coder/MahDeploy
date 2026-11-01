"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { CheckCircle2, XCircle, AlertTriangle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CheckResult } from "@/lib/types";

/* ---------------------------------------------------------------- */
/* helpers                                                           */
/* ---------------------------------------------------------------- */

export function fa(n: number | string): string {
  return Number(n).toLocaleString("fa-IR");
}

export function faTime(iso: string | Date): string {
  const d = new Date(iso);
  return d.toLocaleString("fa-IR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* ---------------------------------------------------------------- */
/* Aurora background                                                 */
/* ---------------------------------------------------------------- */

export function AuroraBackground() {
  // deterministic star field (avoids SSR/client hydration mismatch)
  const stars = useMemo(
    () =>
      Array.from({ length: 42 }, (_, i) => ({
        id: i,
        top: (i * 23.7 + 11) % 100,
        left: (i * 37.3 + 5) % 100,
        delay: ((i * 0.73) % 4),
        scale: 0.5 + ((i * 0.137) % 1) * 0.9,
      })),
    []
  );
  return (
    <div aria-hidden className="fixed inset-0 overflow-hidden pointer-events-none">
      <div className="aurora-blob aurora-a w-[560px] h-[560px] -top-40 -right-32 bg-violet-600/30" />
      <div className="aurora-blob aurora-b w-[480px] h-[480px] top-1/3 -left-40 bg-teal-500/20" />
      <div className="aurora-blob aurora-c w-[420px] h-[420px] -bottom-32 right-1/4 bg-fuchsia-500/20" />
      {stars.map((s) => (
        <span
          key={s.id}
          className="star"
          style={{ top: `${s.top}%`, left: `${s.left}%`, animationDelay: `${s.delay}s`, transform: `scale(${s.scale})` }}
        />
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* status dot                                                        */
/* ---------------------------------------------------------------- */

export function StatusDot({ status, size = 10 }: { status: string; size?: number }) {
  const color =
    status === "active"
      ? "bg-emerald-400"
      : status === "failed"
        ? "bg-rose-400"
        : status === "deploying"
          ? "bg-amber-300"
          : status === "stopped"
            ? "bg-slate-400"
            : "bg-sky-300";
  return (
    <span className="relative inline-flex" style={{ width: size, height: size }}>
      <span className={cn("absolute inset-0 rounded-full", color, status === "active" && "glow-pulse")} />
      {status === "active" && (
        <span className={cn("absolute inset-0 rounded-full opacity-60 animate-ping", color)} />
      )}
    </span>
  );
}

/* ---------------------------------------------------------------- */
/* sparkline                                                         */
/* ---------------------------------------------------------------- */

export function Sparkline({
  data,
  stroke = "#2dd4bf",
  height = 44,
  max = 100,
}: {
  data: number[];
  stroke?: string;
  height?: number;
  max?: number;
}) {
  const w = 120;
  const id = useMemo(() => `sp-${Math.random().toString(36).slice(2, 8)}`, []);
  if (data.length < 2) {
    return (
      <svg viewBox={`0 0 ${w} ${height}`} className="w-full" style={{ height }}>
        <line x1="0" y1={height - 4} x2={w} y2={height - 4} stroke={stroke} strokeOpacity="0.25" strokeWidth="2" />
      </svg>
    );
  }
  const pts = data.slice(-40);
  const stepX = w / (pts.length - 1);
  const y = (v: number) => height - 4 - (Math.min(v, max) / max) * (height - 8);
  const path = pts.map((v, i) => `${i === 0 ? "M" : "L"}${(i * stepX).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${path} L${w},${height} L0,${height} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full" style={{ height }} preserveAspectRatio="none">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.35" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={path} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={w} cy={y(pts[pts.length - 1])} r="3" fill={stroke} />
    </svg>
  );
}

/* ---------------------------------------------------------------- */
/* glass card                                                        */
/* ---------------------------------------------------------------- */

export function GlassCard({
  children,
  className,
  hover = false,
}: {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
}) {
  return <div className={cn("glass p-5", hover && "glass-hover", className)}>{children}</div>;
}

/* ---------------------------------------------------------------- */
/* check result rows                                                 */
/* ---------------------------------------------------------------- */

export function CheckRow({ result, index }: { result: CheckResult; index: number }) {
  const icon =
    result.status === "ok" ? (
      <CheckCircle2 className="w-5 h-5 text-emerald-400" />
    ) : result.status === "warn" ? (
      <AlertTriangle className="w-5 h-5 text-amber-300" />
    ) : (
      <XCircle className="w-5 h-5 text-rose-400" />
    );
  return (
    <motion.div
      initial={{ opacity: 0, x: 14 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.07, duration: 0.35 }}
      className={cn(
        "flex items-start gap-3 rounded-xl border p-3",
        result.status === "ok"
          ? "border-emerald-400/15 bg-emerald-400/[0.05]"
          : result.status === "warn"
            ? "border-amber-300/15 bg-amber-300/[0.05]"
            : "border-rose-400/15 bg-rose-400/[0.05]"
      )}
    >
      <div className="mt-0.5">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{result.title}</div>
        <div className="text-xs text-muted-foreground mt-1 leading-5 break-all">{result.message}</div>
        {result.detail && <div className="text-[11px] text-muted-foreground/70 mt-0.5 break-all">{result.detail}</div>}
      </div>
    </motion.div>
  );
}

/* ---------------------------------------------------------------- */
/* code block                                                        */
/* ---------------------------------------------------------------- */

export function CodeBlock({ code, maxHeight = 420, downloadName }: { code: string; maxHeight?: number; downloadName?: string }) {
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLPreElement>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      /* clipboard unavailable */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  const download = () => {
    const blob = new Blob(["\uFEFF" + code], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = downloadName ?? "script.ps1";
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="relative rounded-xl border border-white/10 bg-[#0a0e1f]/80 overflow-hidden w-full min-w-0 max-w-full" dir="ltr">
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 bg-white/[0.03]">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-rose-400/70" />
          <span className="w-2.5 h-2.5 rounded-full bg-amber-300/70" />
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/70" />
        </div>
        <div className="flex items-center gap-2">
          {downloadName && (
            <button
              onClick={download}
              className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              دانلود
            </button>
          )}
          <button
            onClick={copy}
            className="text-[11px] px-2 py-0.5 rounded-md bg-violet-500/15 border border-violet-400/25 text-violet-200 hover:bg-violet-500/25 transition-colors"
          >
            {copied ? "کپی شد ✓" : "کپی"}
          </button>
        </div>
      </div>
      <pre ref={ref} className="terminal overflow-auto p-4 w-full max-w-full min-w-0 block" style={{ maxHeight }}>
        {code}
      </pre>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* live console (terminal)                                           */
/* ---------------------------------------------------------------- */

function lineClass(line: string): string {
  if (line.includes("[OK]")) return "ln-ok";
  if (line.includes("[FAIL]")) return "ln-fail";
  if (line.includes("[WARN]")) return "ln-warn";
  if (line.includes("[..]")) return "ln-run";
  return "ln-plain";
}

export function LiveConsole({
  lines,
  running,
  maxHeight = 340,
}: {
  lines: string[];
  running?: boolean;
  maxHeight?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [lines.length]);
  return (
    <div className="relative rounded-xl border border-white/10 bg-[#070b19]/90 overflow-hidden" dir="ltr">
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 bg-white/[0.03]">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-rose-400/70" />
          <span className="w-2.5 h-2.5 rounded-full bg-amber-300/70" />
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/70" />
          <span className="text-[11px] text-muted-foreground ml-2">PowerShell — live output</span>
        </div>
        {running && <Loader2 className="w-3.5 h-3.5 text-teal-300 animate-spin" />}
      </div>
      <div ref={ref} className="terminal overflow-y-auto p-4" style={{ maxHeight }}>
        {lines.length === 0 && <div className="text-muted-foreground/50">در انتظار اجرای اسکریپت…</div>}
        {lines.map((l, i) => (
          <div key={i} className={lineClass(l)}>
            {l}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* animated number                                                   */
/* ---------------------------------------------------------------- */

export function Ticker({ value, suffix = "" }: { value: number; suffix?: string }) {
  const [display, setDisplay] = useState(value);
  const prev = useRef(value);
  useEffect(() => {
    const from = prev.current;
    const to = value;
    prev.current = value;
    if (from === to) return;
    const start = performance.now();
    const dur = 500;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(from + (to - from) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return (
    <span className="tnum">
      {fa(display)}
      {suffix}
    </span>
  );
}
