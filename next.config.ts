import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'export',
  images: {
    unoptimized: true
  },
  basePath: '/self-updating-RAG',
  assetPrefix: '/self-updating-RAG/'
};

export default nextConfig;
