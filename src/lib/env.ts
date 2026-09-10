// Centralized, cloud-agnostic runtime config. Everything is env-driven so the
// same build runs unchanged on AWS, Azure, or locally.

export type AuthChannel = "email" | "sms" | "whatsapp";

function parseChannels(raw: string | undefined): AuthChannel[] {
  const all = (raw ?? "email")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean) as AuthChannel[];
  const valid: AuthChannel[] = ["email", "sms", "whatsapp"];
  const picked = all.filter((c) => valid.includes(c));
  return picked.length ? picked : ["email"];
}

function parseEmails(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** Placeholder shipped in docs — never accept this outside local `next dev`. */
export const EXAMPLE_AUTH_SECRET = "dev-only-secret-change-me";

export function productionAuthSecretRejected(
  secret: string | undefined,
  nodeEnv: string | undefined,
): boolean {
  if (nodeEnv !== "production") return false;
  const s = (secret ?? "").trim();
  return !s || s === EXAMPLE_AUTH_SECRET || s === "dev";
}

const skipDuringNextBuild = process.env.NEXT_PHASE === "phase-production-build";
if (
  !skipDuringNextBuild &&
  productionAuthSecretRejected(process.env.AUTH_SECRET, process.env.NODE_ENV)
) {
  throw new Error(
    "AUTH_SECRET must be a unique secret in production — do not use the example value from .env.example.",
  );
}

export const env = {
  isDev: process.env.NODE_ENV !== "production",
  appName: "StrideVote",
  authUrl: process.env.AUTH_URL ?? "http://localhost:3000",
  authChannels: parseChannels(process.env.AUTH_CHANNELS),
  platformAdminEmails: parseEmails(process.env.PLATFORM_ADMIN_EMAILS),
  mapTileUrl:
    process.env.NEXT_PUBLIC_MAP_TILE_URL ??
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  geocoderUrl: process.env.GEOCODER_URL ?? "https://nominatim.openstreetmap.org",
  /** Bearer token for the local MiniVAN emulator worker. Empty = worker APIs reject. */
  minivanWorkerToken: process.env.MINIVAN_WORKER_TOKEN ?? "",
};

export function channelEnabled(channel: AuthChannel): boolean {
  return env.authChannels.includes(channel);
}
