import type { FailureAnalysis } from "@/lib/types";

/**
 * Parse the raw console output of a failed PowerShell step and produce a
 * human-understandable cause + suggested fixes (in Persian) so the operator
 * can trace what happened without reading raw stack traces.
 */
export function analyzeFailure(lines: string[], error?: string): FailureAnalysis {
  const text = lines.join("\n");
  const failLines = lines.filter((l) => l.includes("[FAIL]"));
  const failLine = failLines[failLines.length - 1] ?? error;

  const rules: { re: RegExp; cause: string; hints: string[] }[] = [
    {
      re: /access is denied|unauthorizedaccess|could not load file or assembly.*access/i,
      cause: "دسترسی کافی وجود ندارد (Access Denied)",
      hints: [
        "پنل را با PowerShell دارای دسترسی Administrator باز کنید (راست‌کلیک → Run as administrator).",
        "اگر پنل به‌عنوان سرویس اجرا می‌شود، سرویس را با حساب دارای دسترسی Administrator اجرا کنید.",
      ],
    },
    {
      re: /nginx.*\[emerg\]|nginx configuration test failed|\[emerg\]/i,
      cause: "کانفیگ Nginx رد شد (nginx -t ناموفق)",
      hints: [
        "خط‌های emerg خروجی بالا مسیر و شماره خط مشکل را نشان می‌دهند — معمولاً مسیر گواهی SSL یا تکراری‌بودن server_name است.",
        "کانفیگ قبلی به‌طور خودکار از پوشه nginx-backups بازگردانی شده است؛ مشکل را رفع و دوباره تلاش کنید.",
      ],
    },
    {
      re: /private key does not match|key\/cert pair/i,
      cause: "کلید خصوصی با گواهی SSL مطابقت ندارد",
      hints: [
        "احتمالاً فایل‌های گواهی مربوط به دامنهٔ دیگری‌اند — مسیرهای CRT و KEY در گام ۱ ویزارد را بررسی کنید.",
        "فایل .key باید دقیقاً همان کلیدی باشد که CSR گواهی با آن ساخته شده است.",
      ],
    },
    {
      re: /ssl certificate expired|certificate could not be read/i,
      cause: "گواهی SSL منقضی یا خراب است",
      hints: [
        "گواهی را تمدید کنید، فایل جدید را در همان مسیر بریزید (یا مسیر را در ویزارد اصلاح کنید) و دوباره تلاش کنید.",
        "برای بررسی سریع: تاریخ انقضا در همان خروجی بالا نمایش داده شده است.",
      ],
    },
    {
      re: /not a readable zip|truncated|zip may be corrupt|extracting the zip failed|tar\.exe failed/i,
      cause: "فایل ZIP خراب یا ناقص آپلود شده است",
      hints: [
        "دوباره ZIP کامل را از تب «استقرار جدید» آپلود کنید — آپلود قبلی ناقص/خراب بوده است.",
        "قبل از آپلود، باز شدن ZIP را روی سیستم خودتان تست کنید.",
      ],
    },
    {
      re: /no 'backend' or 'frontend' folder|expected fastapi backend \+ react frontend/i,
      cause: "ساختار ZIP با ساختار استاندارد همخوان نیست",
      hints: [
        "در ریشه ZIP باید پوشه‌های backend و frontend وجود داشته باشد (یک پوشهٔ لایه‌ای هم پذیرفته می‌شود).",
        "ZIP را طوری بسازید که خود پوشه‌های backend و frontend بایگانی شوند، نه فایل‌های پراکنده.",
      ],
    },
    {
      re: /source zip not found|the panel temp upload may have been cleaned/i,
      cause: "فایل ZIP آپلودشده دیگر روی سرور نیست",
      hints: [
        "فایل موقت آپلود پاک شده است — ZIP را دوباره آپلود کنید و بلافاصله استقرار را اجرا کنید.",
      ],
    },
    {
      re: /pip install failed|no matching distribution|could not find a version/i,
      cause: "نصب وابستگی‌های پایتون (pip) ناموفق بود",
      hints: [
        "دسترسی اینترنت سرور را بررسی کنید؛ اگر سرور محدود است، آینهٔ PyPI داخلی تنظیم کنید.",
        "ورژن پکیج‌های requirements.txt را بررسی کنید (بعضی پکیج‌ها به Python نسخهٔ خاصی نیاز دارند).",
      ],
    },
    {
      re: /python not found|python -m venv failed/i,
      cause: "پایتون در دسترس نیست",
      hints: [
        "Python 3.11+ نسخه 64-bit را نصب کنید و در حین نصب گزینهٔ Add to PATH را بزنید، سپس پنل را دوباره باز کنید.",
      ],
    },
    {
      re: /npm install failed|npm run build failed|npm err/i,
      cause: "نصب یا build فرانت‌اند (npm) ناموفق بود",
      hints: [
        "Node.js نسخهٔ سازگار با پروژه را نصب کنید (LTS پیشنهاد می‌شود) و دوباره تلاش کنید.",
        "خطای واقعی build چند خط بالاتر از [FAIL] در خروجی همین مرحله است — معمولاً خطای تایپ یا وابستگی است.",
      ],
    },
    {
      re: /service install failed|service start failed|winsw exit code/i,
      cause: "ثبت یا راه‌اندازی سرویس ویندوز ناموفق بود",
      hints: [
        "لاگ‌های WinSW را در پوشه logs همان سامانه بررسی کنید (فایل‌های .wrapper.log).",
        "اجرای پنل با دسترسی Administrator لازم است؛ همچنین مطمئن شوید پورت بک‌اند آزاد است.",
      ],
    },
    {
      re: /did not listen on port|never listened on port|did not answer on port/i,
      cause: "بک‌اند روی پورت مشخص بالا نیامد",
      hints: [
        "لاگ بک‌اند (پوشه logs سامانه) را ببینید — معمولاً خطای import یا اتصال دیتابیس علت است.",
        "در به‌روزرسانی، اگر سوییچ ناموفق شود نسخهٔ قبلی خودکار برگردانده می‌شود؛ مشکل کد جدید را رفع و از مرحلهٔ آماده‌سازی دوباره تلاش کنید.",
      ],
    },
    {
      re: /winsw download failed/i,
      cause: "دانلود WinSW ناموفق بود",
      hints: [
        "دسترسی اینترنت سرور به github.com را بررسی کنید، یا فایل WinSW-x64.exe را دستی در C:\\ProgramData\\DeployGuard\\tools قرار دهید.",
      ],
    },
    {
      re: /locked by another deployment/i,
      cause: "کانفیگ مشترک Nginx قفل است",
      hints: [
        "یک استقرار هم‌زمان دیگر در حال تغییر کانفیگ Nginx است — یک دقیقه صبر کنید و دوباره تلاش کنید.",
        "اگر مطمئنید هیچ استقرار دیگری در جریان نیست، فایل قفل (بیش از ۱۰ دقیقه) به‌طور خودکار پاک می‌شود.",
      ],
    },
    {
      re: /robocopy .* failed|could not create folder/i,
      cause: "کپی یا ساخت پوشه‌ها ناموفق بود",
      hints: [
        "دسترسی نوشتن روی مسیر مقصد را بررسی کنید و مطمئن شوید فایل/پوشه‌ای در آن قفل نیست (مثلاً antivirus).",
        "اگر مسیر مقصد درست نیست، آن را در ویزارد (گام ۳) اصلاح کنید.",
      ],
    },
    {
      re: /this script must be run as administrator/i,
      cause: "اسکریپت با دسترسی Administrator اجرا نشد",
      hints: ["پنل را از PowerShell دارای دسترسی Administrator اجرا کنید."],
    },
    {
      re: /port \d+ is free|occupied by|پورت.*اشغال/i,
      cause: "پورت بک‌اند اشغال است",
      hints: [
        "اگر پردازشِ اشغال‌کننده سرویس خودِ همین سامانه باشد (deployguard-…)، نیازی به کاری نیست — برنامه هنگام استقرار آن را متوقف و جایگزین می‌کند و این حالت عادی است.",
        "اگر پردازش دیگری است، در خروجی گام، دستور دقیق توقف آن آمده است (Stop-Service برای سرویس‌ها یا Stop-Process برای برنامه‌ها)؛ اجرا کنید و دکمهٔ Retry را بزنید — مراحل موفق تکرار نمی‌شوند.",
        "یا در گام ۲ ویزارد پورت بک‌اند دیگری انتخاب کنید و برنامه را دوباره بسازید.",
      ],
    },
    {
      re: /the shared nginx config is locked|nginx config lock/i,
      cause: "قفل کانفیگ Nginx در اختیار فرایند دیگری است",
      hints: ["چند لحظه صبر کنید و دوباره تلاش کنید؛ قفل‌های یتیم پس از ۱۰ دقیقه خودکار آزاد می‌شوند."],
    },
  ];

  for (const rule of rules) {
    if (rule.re.test(text)) {
      return { cause: rule.cause, hints: rule.hints, failLine };
    }
  }

  // generic fallback: surface the last FAIL line + transcript hint
  return {
    cause: "خطای نامشخص — جزئیات در خروجی مرحله و لاگ ترنسکریپت موجود است",
    hints: [
      "آخرین خطوط قرمز [FAIL] را ببینید؛ متن خطا معمولاً خودش علت را می‌گوید.",
      "فایل لاگ ترنسکریپت مرحله (مسیر آن در [HINT] خروجی هست) را برای پشتیبانی بفرستید.",
      "پس از رفع مشکل، دکمهٔ «تلاش دوباره از مرحلهٔ ناموفق» را بزنید — مراحل موفق تکرار نمی‌شوند.",
    ],
    failLine,
  };
}

/**
 * Scrub sensitive values (passwords, tokens, secrets) from a console line
 * before it is shown in the terminal or stored in the database.
 */
const SECRET_RE =
  /((?:password|passwd|pwd|token|secret|api[_-]?key|authorization|database_url)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|\S+)/gi;

export function scrubSecrets(line: string): string {
  let out = line.replace(SECRET_RE, "$1***");
  out = out.replace(/(Bearer\s+)[A-Za-z0-9._\-]+/gi, "$1***");
  return out;
}
