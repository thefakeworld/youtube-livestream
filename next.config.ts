import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  outputFileTracingExcludes: {
    "*": ["./node_modules/.prisma/**", "./node_modules/@prisma/engines/**"],
  },
};

export default nextConfig;
