import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone", // the Docker image ships only .next/standalone, not all of node_modules; Vercel deploys are unaffected
  cacheComponents: true,
  partialPrefetching: true,
};

export default nextConfig;
