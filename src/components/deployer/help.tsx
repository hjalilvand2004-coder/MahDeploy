"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  BookOpen, Lightbulb, ShieldAlert, Info, Rocket, CircleHelp,
  Gauge, Boxes, ListChecks, PlayCircle, KeyRound, LayoutDashboard, FolderCog, Power,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { fa } from "./bits";

/* ------------------------------------------------------------------ */
/* help content model                                                  */
/* ------------------------------------------------------------------ */

export type HelpTopic =
  | "overview"
  | "login"
  | "dashboard"
  | "services"
  | "wizard-step1"
  | "wizard-step2"
  | "wizard-step3"
  | "wizard-step4"
  | "wizard-step5"
  | "systems";

interface HelpSection {
  intro: string[];
  steps?: { title: string; text: string }[];
  tips?: string[];
  warn?: string[];
}

interface HelpEntry extends HelpSection {
  title: string;
  icon: React.ElementType;
}

/* ------------------------------------------------------------------ */
/* Persian help content — one entry per panel / wizard step            */
/* ------------------------------------------------------------------ */

export const HELP_TOPICS: Record<HelpTopic, HelpEntry> = {
  overview: {
    title: "راهنمای سریع استقراربان",
    icon: Rocket,
    intro: [
      "استقراربان چهار بخش اصلی دارد و کار با آن به همین ترتیب ساده است: ابتدا سلامت سرور را در داشبورد می‌بینید، بعد با ویزارد ۵ مرحله‌ای سامانه جدید را مستقر می‌کنید، برای کنترل سریع سراغ تب سرویس‌ها می‌روید و کارهای تکمیلی را در بخش سامانه‌ها انجام می‌دهید.",
      "این پنل همه کارهای سنگین را با اسکریپت‌های استاندارد PowerShell خودکار می‌کند: ساخت ساختار پوشه، محیط مجازی پایتون، ثبت سرویس ویندوز، بیلد فرانت‌اند، کانفیگ Nginx و فایروال.",
    ],
    steps: [
      { title: "۱ — داشبورد سرور", text: "وضعیت زنده CPU، رم و دیسک، سلامت Nginx، نقشه پورت‌های اشغال‌شده و جریان رویدادها را یک‌جا می‌بینید." },
      { title: "۲ — استقرار جدید", text: "ویزارد ۵ مرحله‌ای: هویت سامانه ← دامنه و پورت ← مسیرها و SSL ← بررسی نهایی ← اجرا با ترمینال زنده. تا همه بررسی‌ها سبز نشوند، نصب آغاز نمی‌شود." },
      { title: "۳ — سرویس‌ها", text: "فهرست سادهٔ سامانه‌ها با پورت بک‌اند و دکمه‌های Start / Stop / Restart برای مدیریت سریع سرویس‌ها، بدون ورود به جزئیات." },
      { title: "۴ — سامانه‌ها", text: "مدیریت کامل: خروجی استقرار، اسکریپت‌های PowerShell، کانفیگ Nginx، رویدادها و حذف کامل هر سامانه." },
    ],
    tips: [
      "در هر صفحه، دکمه «راهنما» همان بخش را دقیق و گام‌به‌گام توضیح می‌دهد.",
      "مستند کامل و مصور PDF (راهنمای جامع کاربر) نیز همراه پکیج پرتابل عرضه شده است.",
    ],
  },

  login: {
    title: "ورود به پنل و شروع سریع",
    icon: KeyRound,
    intro: [
      "برای ورود فقط به رمز عبور ادمین نیاز دارید. نشست ورود با امضای رمزنگاری‌شده در کوکی ذخیره می‌شود و نیازی به نام کاربری نیست.",
    ],
    steps: [
      { title: "رمز عبور را وارد کنید", text: "رمز پیش‌فرض admin1234 است؛ اگر نخستین ورود شماست همین رمز را بزنید." },
      { title: "بلافاصله رمز را عوض کنید", text: "پس از ورود، از دکمه چرخ‌دنده (تنظیمات) در نوار بالا، رمز جدید با حداقل ۸ کاراکتر ثبت کنید." },
      { title: "نوار «پیش‌نمایش» را بشناسید", text: "اگر نوار فیروزه‌ای پیش‌نمایش را می‌بینید، عملیات مخصوص ویندوز (PowerShell، سرویس، Nginx) شبیه‌سازی می‌شوند؛ روی سرور واقعی همه‌چیز به‌صورت واقعی اجرا می‌شود." },
    ],
    tips: [
      "پکیج پرتابل را در مسیری بدون فاصله و فارسی مثل C:\\MahDeploy قرار دهید و با Start-MahDeploy.bat اجرا کنید.",
      "برای اجرای عملیات مدیریتی واقعی، PowerShell را با دسترسی Administrator باز کنید.",
    ],
    warn: [
      "رمز پیش‌فرض admin1234 را پیش از هر استقرار واقعی حتماً تغییر دهید.",
    ],
  },

  dashboard: {
    title: "راهنمای داشبورد سرور",
    icon: Gauge,
    intro: [
      "داشبورد قلب پایش سرور است و هر ۴ ثانیه به‌روزرسانی می‌شود؛ بدون نیاز به هیچ رفرش دستی، وضعیت واقعی ماشین را جلوی چشم شما نگه می‌دارد.",
    ],
    steps: [
      { title: "کارت‌های پردازنده، رم و دیسک", text: "درصد مصرف فعلی به‌همراه نمودار کوچک روند اخیر. عدد بزرگ درصد مصرف است و زیر کارت دیسک، فضای آزاد باقی‌مانده دیده می‌شود." },
      { title: "کارت Nginx", text: "نصب و فعال‌بودن وب‌سرور، نتیجه تست کانفیگ و تعداد سایت‌های فعال را نشان می‌دهد؛ اگر قرمز است یعنی Nginx نصب نیست یا اجرا نمی‌شود." },
      { title: "محیط اجرا", text: "نسخه Python، Node.js و Nginx نصب‌شده روی سرور و آپ‌تایم ماشین. قبل از استقرار مطمئن شوید Python و Nginx سبز هستند." },
      { title: "سامانه‌های مستقر و نقشه پورت‌ها", text: "خلاصه وضعیت استقرارها (فعال/ناموفق/کل) و فهرست پورت‌های در حال شنیدن؛ پورت‌های مربوط به استقرارها با برچسب فیروزه‌ای مشخص شده‌اند." },
      { title: "جریان رویدادها", text: "آخرین عملیات‌ها: ورود ادمین، تولید پلن، اجرای اسکریپت‌ها و خطاها — برای ردیابی چه اتفاقی افتاده است." },
    ],
    tips: [
      "دکمه «مدیریت سامانه‌ها» در کارت سامانه‌ها، مستقیم به تب مربوطه می‌برد.",
      "اگر دیسک بالای ۹۰٪ اشغال است، پیش از استقرار جدید فضا آزاد کنید.",
    ],
  },

  services: {
    title: "راهنمای کنترل سرویس‌ها و پورت‌ها",
    icon: Power,
    intro: [
      "این تب ساده‌ترین جای پنل برای مدیریت سرویس‌هاست: فهرست همهٔ سامانه‌های مستقرشده، پورت بک‌اند هر کدام و وضعیت زندهٔ آن — با سه دکمهٔ Start (شروع)، Stop (توقف) و Restart (ری‌استارت) در همان ردیف.",
    ],
    steps: [
      { title: "هر ردیف چه می‌گوید", text: "نام سامانه و نشان وضعیت (فعال/متوقف/ناموفق)، دامنه، نام سرویس ویندوز (deployguard-...) و پورت بک‌اند. هر سامانه‌ای که با ویزارد مستقر شده باشد این‌جا دیده می‌شود." },
      { title: "Start / Stop / Restart", text: "Start سرویس متوقف را روشن می‌کند؛ Stop سرویس فعال را می‌ایستاند؛ Restart یک‌باره خاموش و روشن می‌کند (برای اعمال تغییرات کد یا کانفیگ). نتیجه با اعلان اعلام و فهرست بلافاصله تازه می‌شود." },
      { title: "نشان‌های پورت", text: "«روی پورت پاسخ می‌دهد» (سبز) یعنی همین الان پردازشی روی آن پورت در حال شنیدن است؛ «پورت بی‌پاسخ» (قرمز) یعنی سرویس ظاهراً بالا نیست — با Start/Restart برطرف کنید یا لاگ‌ها را بررسی کنید." },
      { title: "لینک و جزئیات", text: "دکمهٔ لینک، سامانه را در مرورگر باز می‌کند (https). دکمهٔ چشم به تب «سامانه‌ها» می‌رود: خروجی استقرار، اسکریپت‌ها، کانفیگ Nginx، رویدادها و حذف کامل آن‌جاست." },
    ],
    tips: [
      "وضعیت پورت‌ها هر ۵ ثانیه خودکار تازه می‌شود؛ دکمهٔ فلش گرد هم برای بررسی فوری هست.",
      "توقف سرویس، سایت را موقتاً از دسترس خارج می‌کند؛ کانفیگ Nginx دست‌نخورده می‌ماند و با Start دوباره برمی‌گردد.",
      "دسترسی Administrator برای مدیریت سرویس‌های ویندوز لازم است؛ در غیر این صورت عملیات فقط شبیه‌سازی می‌شود.",
    ],
    warn: [
      "فقط سرویس‌های سامانه‌های مستقرشده با استقراربان در این فهرست کنترل می‌شوند؛ سرویس‌های سیستمی ویندوز (مثل RDP یا Nginx) از این‌جا دستکاری نمی‌شوند.",
    ],
  },

  "wizard-step1": {
    title: "مرحله ۱ — هویت سامانه",
    icon: Boxes,
    intro: [
      "در این مرحله هویت سامانه و منبع کد آن مشخص می‌شود. این اطلاعات پایه، نام سرویس ویندوز و مسیر پوشه استقرار را تعیین می‌کند.",
    ],
    steps: [
      { title: "نام نمایشی", text: "نام فارسی و خوانا برای نمایش در پنل؛ مثلاً «سامانه مدیریت اسناد». هر چیزی می‌تواند باشد." },
      { title: "شناسه سامانه (اسلاگ انگلیسی)", text: "به‌صورت خودکار از نام ساخته می‌شود ولی فقط حروف کوچک انگلیسی، عدد و خط تیره مجاز است (مثل docs-manager)؛ چون این شناسه در نام سرویس ویندوز، مسیر پوشه‌ها و فایل کانفیگ Nginx استفاده می‌شود." },
      { title: "انتخاب منبع کد", text: "«مسیر پوشه روی سرور» اگر کد از قبل روی سرور است، یا «آپلود ZIP» تا ۳۰۰ مگابایت که در زمان استقرار استخراج می‌شود." },
    ],
    tips: [
      "ساختار استاندارد کد: پوشه backend برای FastAPI و پوشه frontend برای React — هر دو در یک پوشه والد.",
      "اگر اسلاگ خودکار خالی شد (نام کاملاً فارسی است)، آن را دستی انگلیسی وارد کنید.",
    ],
  },

  "wizard-step2": {
    title: "مرحله ۲ — دامنه و پورت",
    icon: ListChecks,
    intro: [
      "اینجا دامنه خریداری‌شده و پورت بک‌اند FastAPI تعیین می‌شود. سامانه قبل از هر چیز آزاد بودن پورت و اتصال DNS دامنه را به‌صورت زنده کنترل می‌کند.",
    ],
    steps: [
      { title: "دامنه اختصاصی", text: "دامنه‌ای که از قبل خریده‌اید و رکورد A آن به IP همین سرور اشاره می‌کند. با دکمه «بررسی»، رزولوشن DNS و تطابق IP کنترل می‌شود." },
      { title: "پورت بک‌اند", text: "یک پورت آزاد مثل 8001؛ دکمه پیشنهاد، نخستین پورت آزاد سرور را خودکار وارد می‌کند و دکمه «بررسی» اشغال‌بودن آن را می‌سنجد." },
      { title: "پیش‌نمایش معماری", text: "نمایی از مسیر ترافیک بعد از استقرار: درخواست https به Nginx روی 443 می‌رسد، مسیر / فایل‌های بیلد React را سرو می‌کند و /api به uvicorn روی پورت بک‌اند پروکسی می‌شود." },
    ],
    tips: [
      "پورت‌های ۸۰ و ۴۴۳ و ۳۳۸۹ مخصوص سیستم هستند و به بک‌اند اختصاص نمی‌یابند.",
      "اگر DNS هنوز ست نشده، هشدار می‌گیرید؛ می‌توانید بعداً ادامه دهید ولی رکورد DNS باید پیش از اجرا تنظیم شود.",
    ],
    warn: [
      "پورت انتخابی نباید روی سیستم اشغال باشد؛ بررسی قرمز یعنی باید پورت دیگری برگزینید.",
    ],
  },

  "wizard-step3": {
    title: "مرحله ۳ — مسیرها و گواهی SSL",
    icon: FolderCog,
    intro: [
      "ساختار پوشه استاندارد استقرار و مسیر گواهی‌های SSL دامنه را مشخص می‌کنید. استقراربان از چیدمان یکسان روی همه سرورها پیروی می‌کند تا نگهداری ساده بماند.",
    ],
    steps: [
      { title: "مسیر پایه استقرار", text: "پیش‌فرض C:\\deployments است؛ زیر هر سامانه پوشه‌های backend، frontend، www، service، logs و scripts ساخته می‌شود." },
      { title: "مسیر نصب Nginx", text: "معمولاً C:\\nginx؛ فایل کانفیگ سامانه در conf\\conf.d\\<نام-سامانه>.conf قرار می‌گیرد." },
      { title: "گواهی و کلید SSL", text: "مسیر کامل فایل .crt/.pem و فایل .key گواهی دامنه‌ای که در مرحله قبل وارد کردید؛ این گواهی برای HTTPS روی پورت ۴۴۳ استفاده می‌شود." },
      { title: "اعتبارسنجی", text: "با دکمه «اعتبارسنجی گواهی SSL» وجود فایل‌ها و تطابق دامنه گواهی با دامنه سامانه کنترل می‌شود." },
    ],
    tips: [
      "گواهی و کلید را از قبل در مسیری مثل C:\\ssl\\certs کپی کرده باشید.",
      "مسیرها را دقیق و کامل وارد کنید؛ این مسیرها در اسکریپت‌های PowerShell استفاده می‌شوند.",
    ],
  },

  "wizard-step4": {
    title: "مرحله ۴ — بررسی نهایی پیش از استقرار",
    icon: ListChecks,
    intro: [
      "همه پیش‌نیازها یک‌جا و به‌صورت زنده دوباره کنترل می‌شوند: فلسفه استقراربان این است که تا همه‌چیز سبز نشود، حتی یک خط از نصب اجرا نشود.",
    ],
    steps: [
      { title: "معنی رنگ‌ها", text: "سبز یعنی بررسی موفق؛ زرد (هشدار) یعنی مانع جدی نیست ولی بهتر است بررسی کنید — مثل DNS که هنوز منتشر نشده؛ قرمز یعنی استقرار ممکن نیست و باید اصلاح شود." },
      { title: "بررسی مجدد", text: "پس از رفع هر مورد قرمز (مثلاً ساختن رکورد DNS یا آزادکردن پورت)، با دکمه «بررسی مجدد» نتیجه تازه بگیرید." },
      { title: "تولید پلن", text: "وقتی همه موارد سبز شد، دکمه «تولید پلن PowerShell استقرار» را بزنید تا ۶ اسکریپت استاندارد استقرار ساخته و نمایش داده شوند." },
    ],
    tips: [
      "می‌توانید پیش از اجرا، محتوای هر اسکریپت را در همین صفحه باز و بازبینی کنید.",
      "هیچ تغییری روی سرور اعمال نشده تا وقتی در مرحله بعد، اجرا را صریحاً تأیید نکنید.",
    ],
  },

  "wizard-step5": {
    title: "مرحله ۵ — اجرا و گزارش زنده",
    icon: PlayCircle,
    intro: [
      "مرحله اجرا: اسکریپت‌های PowerShell به‌ترتیب و با دسترسی Administrator اجرا می‌شوند و خروجی هر خط به‌صورت زنده در ترمینال نمایش داده می‌شود.",
    ],
    steps: [
      { title: "تأیید و اجرا", text: "چک‌باکس تأیید را بزنید و «اجرای استقرار» را کلیک کنید. اجرای هر مرحله پس از اتمام، رنگ سبز می‌گیرد." },
      { title: "۶ اسکریپت استاندارد", text: "Preflight (چک نهایی)، Prepare (ساخت ساختار پوشه و کپی کد)، Backend (venv + pip + ثبت سرویس WinSW)، Frontend (npm install + build و کپی به www)، Nginx (نوشتن کانفیگ + قاعده فایروال + reload) و Verify (تست HTTP و سلامت سرویس)." },
      { title: "کلیک روی هر مرحله", text: "با کلیک روی هر ردیف، کد کامل همان اسکریپت PowerShell نمایش داده می‌شود؛ می‌توانید آن را کپی یا دانلود کنید." },
      { title: "پایان موفق", text: "لینک مستقیم https سامانه، نام سرویس ویندوز و مسیر کانفیگ Nginx نمایش داده می‌شود و سامانه در تب «سامانه‌ها» ثبت می‌گردد." },
    ],
    tips: [
      "اگر مرحله‌ای شکست بخورد، استقرار همان‌جا متوقف می‌شود؛ خروجی قرمز را بخوانید، مشکل سرور را رفع کنید و با دکمه «تلاش دوباره از مرحلهٔ ناموفق» ادامه دهید — مراحل موفق تکرار نمی‌شوند و نیازی به ساخت پلن جدید نیست.",
      "در حالت پیش‌نمایش، خروجی‌ها شبیه‌سازی‌شده‌اند؛ روی ویندوز سرور واقعی همین خروجی‌ها واقعی‌اند.",
    ],
  },

  systems: {
    title: "راهنمای مدیریت سامانه‌های مستقرشده",
    icon: LayoutDashboard,
    intro: [
      "هر سامانه‌ای که با ویزارد مستقر شده باشد این‌جا یک کارت دارد: نام و دامنه، پورت بک‌اند، مسیر پوشه استقرار، زمان آخرین استقرار و نشان وضعیت.",
    ],
    steps: [
      { title: "معنی نشان وضعیت", text: "فعال (سبز): سرویس در حال اجراست؛ متوقف (خاکستری): سرویس Stop شده؛ ناموفق (قرمز): استقرار یا اجرا با خطا مواجه شده؛ در حال استقرار (زرد): عملیات در جریان است." },
      { title: "شروع / توقف / ری‌استارت", text: "دکمه‌های کنار کارت مستقیماً سرویس ویندوز deployguard-<نام> را مدیریت می‌کنند؛ نتیجه عملیات با اعلان (Toast) اعلام می‌شود." },
      { title: "جزئیات", text: "پنجره جزئیات چهار تب دارد: خروجی استقرار (نتیجه هر ۶ اسکریپت)، اسکریپت‌های PowerShell (کد کامل + کپی/دانلود)، کانفیگ Nginx (محتوای فایل conf) و رویدادها (لاگ‌های ثبت‌شده)." },
      { title: "حذف کامل", text: "با تأیید دومرحله‌ای، سرویس ویندوز حذف، کانفیگ Nginx پاک و با ریلود Nginx، لاگ‌ها آرشیو و پوشه سامانه حذف می‌شود؛ دیتابیس خود سامانه نیز همراه پوشه حذف می‌گردد." },
    ],
    tips: [
      "پیش از حذف، از پوشه سامانه (به‌خصوص پوشه logs و فایل‌های دیتابیس) نسخه پشتیبان بگیرید.",
      "اگر کارت «ناموفق» است، از تب خروجی استقرار در جزئیات، علت را پیدا کنید.",
    ],
    warn: [
      "حذف قطعی است و برگشت‌پذیر نیست؛ قبل از تأیید نهایی مطمئن شوید.",
    ],
  },
};

/* ------------------------------------------------------------------ */
/* help dialog                                                         */
/* ------------------------------------------------------------------ */

function HelpDialog({
  topic,
  open,
  onClose,
}: {
  topic: HelpTopic;
  open: boolean;
  onClose: () => void;
}) {
  const entry = HELP_TOPICS[topic];
  const Icon = entry.icon;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl w-[calc(100vw-2rem)] max-h-[85vh] overflow-y-auto bg-[#0d1327]/95 backdrop-blur-2xl border-white/10 rounded-2xl shadow-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5 text-base leading-6">
            <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500/30 to-fuchsia-500/30 border border-white/10 flex items-center justify-center shrink-0">
              <Icon className="w-5 h-5 text-violet-200" />
            </span>
            {entry.title}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-1">
          {entry.intro.map((p, i) => (
            <p key={i} className="text-xs leading-6 text-muted-foreground">
              {p}
            </p>
          ))}

          {entry.steps && (
            <div className="space-y-2">
              {entry.steps.map((s, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-3"
                >
                  <span className="w-6 h-6 rounded-lg bg-gradient-to-br from-violet-500/40 to-fuchsia-500/40 text-[11px] font-black text-white flex items-center justify-center shrink-0 mt-0.5">
                    {fa(i + 1)}
                  </span>
                  <div className="min-w-0">
                    <div className="text-xs font-bold">{s.title}</div>
                    <p className="text-[11px] leading-5 text-muted-foreground mt-1">{s.text}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          )}

          {entry.tips && entry.tips.length > 0 && (
            <div className="rounded-xl border border-amber-300/20 bg-amber-300/[0.05] p-3.5">
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-amber-200 mb-2">
                <Lightbulb className="w-3.5 h-3.5" /> نکته‌ها
              </div>
              <ul className="space-y-1.5">
                {entry.tips.map((t, i) => (
                  <li key={i} className="text-[11px] leading-5 text-amber-100/80 flex items-start gap-1.5">
                    <span className="mt-1.5 w-1 h-1 rounded-full bg-amber-300/70 shrink-0" />
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {entry.warn && entry.warn.length > 0 && (
            <div className="rounded-xl border border-rose-400/20 bg-rose-400/[0.05] p-3.5">
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-rose-200 mb-2">
                <ShieldAlert className="w-3.5 h-3.5" /> هشدار
              </div>
              <ul className="space-y-1.5">
                {entry.warn.map((t, i) => (
                  <li key={i} className="text-[11px] leading-5 text-rose-100/80 flex items-start gap-1.5">
                    <span className="mt-1.5 w-1 h-1 rounded-full bg-rose-400/70 shrink-0" />
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60 pt-1 border-t border-white/8">
            <Info className="w-3 h-3 shrink-0" />
            راهنمای جامع و مصور این سامانه در فایل PDF همراه پکیج پرتابل نیز موجود است.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* help button                                                         */
/* ------------------------------------------------------------------ */

export function HelpButton({
  topic,
  label,
  variant = "ghost",
  className,
}: {
  topic: HelpTopic;
  label?: string;
  variant?: "ghost" | "chip";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="راهنمای این بخش"
        className={cn(
          "flex items-center gap-1.5 transition-colors",
          variant === "chip"
            ? "h-8 px-3 rounded-lg border border-violet-400/25 bg-violet-500/10 text-violet-200 text-[11px] font-bold hover:bg-violet-500/20"
            : "text-[11px] text-muted-foreground hover:text-violet-200",
          className
        )}
      >
        {variant === "chip" ? <BookOpen className="w-3.5 h-3.5" /> : <CircleHelp className="w-3.5 h-3.5" />}
        {label ?? "راهنما"}
      </button>
      <HelpDialog topic={topic} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

/** Header-level help (overview) with its own dialog state — used in the top bar. */
export function HeaderHelpButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="راهنمای پنل"
        className="w-9 h-9 rounded-xl border border-white/10 bg-white/[0.03] flex items-center justify-center text-muted-foreground hover:text-violet-200 transition-colors"
      >
        <CircleHelp className="w-4 h-4" />
      </button>
      <HelpDialog topic="overview" open={open} onClose={() => setOpen(false)} />
    </>
  );
}
