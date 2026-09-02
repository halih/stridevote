import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Portable container output: `next build` emits a self-contained server in
  // .next/standalone that runs the same on AWS (App Runner/ECS) or Azure
  // (Container Apps/App Service). Config is entirely env-driven.
  output: "standalone",
  // Keep Prisma's engine out of the bundler's module trace (it does dynamic
  // fs/engine loading); it's loaded from node_modules at runtime instead.
  serverExternalPackages: ["@prisma/client", "prisma"],
  // Next.js blocks HMR / `_next` assets from tunnel hosts unless listed here.
  allowedDevOrigins: [
    "duckie-hammad.ngrok.app",
    "*.ngrok.app",
    "*.ngrok-free.app",
    "*.ngrok.io",
  ],
  async redirects() {
    return [
      {
        source: "/manage",
        destination: "/admin",
        permanent: true,
      },
      {
        source: "/manage/:path*",
        destination: "/admin/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
