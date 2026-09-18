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
  async headers() {
    // Dev-only. Turbopack derives dev chunk URLs from module paths, so a file's
    // URL never changes when its contents do. `no-cache` still lets iOS Safari
    // serve its stored copy without revalidating, which strands a phone testing
    // over a tunnel on stale CSS. `no-store` forbids keeping it at all.
    if (process.env.NODE_ENV !== "development") return [];
    return [
      {
        source: "/_next/static/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, must-revalidate" }],
      },
    ];
  },
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
