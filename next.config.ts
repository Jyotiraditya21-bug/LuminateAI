import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";
const basePath = isProd ? "/LuminateAI" : "";

const nextConfig: NextConfig = {
  output: "export" as const,
  basePath,
  ...(basePath ? { assetPrefix: `${basePath}/` } : {}),
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
