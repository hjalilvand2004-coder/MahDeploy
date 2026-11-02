import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Portable Windows build: no native sharp requirement at runtime
  images: { unoptimized: true },
  /* type errors now fail the build (v1.3.0: tsc + eslint fully clean) */
  reactStrictMode: false,
};

export default nextConfig;
