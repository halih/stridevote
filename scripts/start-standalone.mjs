// Runs the `output: standalone` build locally the same way the container does.
// `next start` does not support standalone output, and `next build` emits
// .next/standalone without static assets or `.env` — the Dockerfile copies the
// assets in and the host supplies the env, so this does both for local runs.
//
// Requires a prior `npm run build`. Port comes from $PORT, else 3000.
import { spawn } from "node:child_process";
import { cpSync, existsSync, rmSync } from "node:fs";

const STANDALONE = ".next/standalone";

if (!existsSync(`${STANDALONE}/server.js`)) {
  console.error("No standalone build found — run `npm run build` first.");
  process.exit(1);
}

for (const [from, to] of [
  [".next/static", `${STANDALONE}/.next/static`],
  ["public", `${STANDALONE}/public`],
]) {
  if (!existsSync(from)) continue;
  // Remove first: copying onto an existing directory nests instead of replacing.
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true });
}

const args = [];
// The standalone server has no .env loader of its own (the container passes
// real env vars instead), so feed it the local file when there is one.
if (existsSync(".env")) args.push("--env-file=.env");
args.push(`${STANDALONE}/server.js`);

const child = spawn(process.execPath, args, {
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_ENV: "production",
    PORT: process.env.PORT ?? "3000",
    HOSTNAME: process.env.HOSTNAME ?? "0.0.0.0",
  },
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
