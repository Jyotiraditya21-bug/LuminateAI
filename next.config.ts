import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'export',
  images: {
    unoptimized: true
  },
  basePath: '/LuminateAI',
  assetPrefix: '/LuminateAI/'
};

export default nextConfig;
