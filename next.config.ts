import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Portable container output: `next build` emits a self-contained server in
  // .next/standalone that runs the same on AWS (App Runner/ECS) or Azure
  // (Container Apps/App Service). Config is entirely env-driven.
  output: "standalone",
  // Keep Prisma's engine out of the bundler's module trace (it does dynamic
  // fs/engine loading); it's loaded from node_modules at runtime instead.
  serverExternalPackages: ["@prisma/client", "prisma"],
};

export default nextConfig;
