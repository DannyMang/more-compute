import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  typescript: {
    // Allow production builds to complete even with TypeScript errors
    ignoreBuildErrors: true,
  },
  eslint: {
    // Allow production builds to complete even with ESLint errors
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
