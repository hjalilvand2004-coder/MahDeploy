import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

export const metadata: Metadata = {
  title: "استقراربان — سامانه هوشمند استقرار FastAPI + React روی ویندوز سرور",
  description:
    "پنل مدیریت استقرار سامانه‌ها با Nginx و گواهی SSL روی ویندوز سرور؛ تولید و اجرای استاندارد اسکریپت‌های PowerShell، چک سلامت چندسطحی، نسخه‌بندی و بازگشت، مدیریت پورت‌ها و سامانه‌های مستقر. تهیه شده توسط شرکت ماه افزارهوشمند رسا (MahAI.ir).",
  authors: [{ name: "شرکت ماه افزارهوشمند رسا", url: "https://MahAI.ir" }],
  icons: {
    icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🚀</text></svg>",
  },
};

export const viewport: Viewport = {
  themeColor: "#070B18",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css"
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- monospace font for log output, global */}
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased bg-background text-foreground min-h-screen">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
