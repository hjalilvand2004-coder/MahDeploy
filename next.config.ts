import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Portable Windows build: no native sharp requirement at runtime
  images: { unoptimized: true },
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
