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

export const env = {
  isDev: process.env.NODE_ENV !== "production",
  appName: "StrideVote",
  authUrl: process.env.AUTH_URL ?? "http://localhost:3000",
  authChannels: parseChannels(process.env.AUTH_CHANNELS),
  mapTileUrl:
    process.env.NEXT_PUBLIC_MAP_TILE_URL ??
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
};

export function channelEnabled(channel: AuthChannel): boolean {
  return env.authChannels.includes(channel);
}
