import type { NextConfig } from "next";

const isGitHubPages = process.env.GITHUB_PAGES === "true";
const basePath = isGitHubPages ? "/LuminateAI" : "";

const nextConfig: NextConfig = {
  // Only use static export when building for GitHub Pages
  ...(isGitHubPages ? { output: "export" as const } : {}),
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
