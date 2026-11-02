"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Rocket, Lock, Eye, EyeOff, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import { AuroraBackground } from "./bits";
import { HelpButton } from "./help";

export function LoginScreen({
  onSuccess,
  simulation,
}: {
  onSuccess: () => void;
  simulation: boolean;
}) {
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "login", password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "ورود ناموفق بود");
        return;
      }
      onSuccess();
    } catch {
      setError("خطا در برقراری ارتباط با سرور");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center p-4">
      <AuroraBackground />
      <motion.div
        initial={{ opacity: 0, y: 26, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full max-w-md"
      >
        <div className="glass-strong p-8">
          <div className="flex flex-col items-center text-center">
            <div className="relative">
              <div className="absolute inset-0 blur-2xl bg-violet-500/40 rounded-full" />
              <div className="relative w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 via-fuchsia-500 to-teal-400 flex items-center justify-center shadow-xl rotate-3">
                <Rocket className="w-8 h-8 text-white -rotate-3" />
              </div>
            </div>
            <h1 className="mt-5 text-3xl font-black tracking-tight">
              استقرار<span className="text-gradient">بان</span>
            </h1>
            <p className="mt-2 text-sm text-muted-foreground leading-6">
              سامانه هوشمند استقرار FastAPI + React روی ویندوز سرور
              <br />
              با Nginx ،SSL و سرویس ویندوز — همه‌چیز استاندارد و خودکار
            </p>
          </div>

          <form onSubmit={submit} className="mt-8 space-y-4">
            <div>
              <label htmlFor="password" className="text-xs font-medium text-muted-foreground mb-1.5 block">
                رمز عبور ادمین
              </label>
              <div className="relative">
                <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  id="password"
                  type={show ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoFocus
                  className="w-full h-11 rounded-xl bg-white/[0.05] border border-white/10 pr-10 pl-10 text-sm outline-none focus:border-violet-400/50 focus:ring-2 focus:ring-violet-500/20 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShow(!show)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label="نمایش رمز"
                >
                  {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {error && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-xs text-rose-300 bg-rose-500/10 border border-rose-400/20 rounded-lg px-3 py-2"
              >
                {error}
              </motion.div>
            )}

            <button
              type="submit"
              disabled={loading || !password}
              className="relative w-full h-11 rounded-xl bg-gradient-to-l from-violet-600 via-fuchsia-600 to-violet-600 bg-[length:200%_100%] hover:bg-[position:100%_0] transition-all duration-500 text-sm font-bold text-white shadow-lg shadow-violet-900/40 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
              ورود به پنل استقرار
            </button>
          </form>

          <div className="flex justify-center mt-5">
            <HelpButton topic="login" label="راهنمای ورود و شروع سریع" variant="chip" />
          </div>

          {simulation && (
            <div className="mt-6 rounded-xl border border-teal-400/20 bg-teal-400/[0.06] p-3 flex items-start gap-2.5">
              <Sparkles className="w-4 h-4 text-teal-300 mt-0.5 shrink-0" />
              <div className="text-[11px] leading-5 text-teal-100/80">
                حالت پیش‌نمایش (شبیه‌سازی) فعال است — رمز پیش‌فرض:{" "}
                <code className="terminal bg-white/10 rounded px-1">admin1234</code>
                <br />
                روی سرور واقعی ویندوز، پنل عملیات واقعی PowerShell را اجرا می‌کند.
              </div>
            </div>
          )}
        </div>

        <p className="text-center text-[11px] text-muted-foreground/60 mt-5">
          برای اجرای عملیات مدیریتی، پنل را در PowerShell با دسترسی Administrator اجرا کنید
        </p>
        <p className="text-center text-[11px] text-muted-foreground/70 mt-2">
          تهیه شده توسط <b className="text-violet-300/90">شرکت ماه افزارهوشمند رسا</b> —{" "}
          <a href="https://MahAI.ir" target="_blank" rel="noreferrer" className="font-bold text-gradient" dir="ltr">
            MahAI.ir
          </a>
        </p>
      </motion.div>
    </div>
  );
}
