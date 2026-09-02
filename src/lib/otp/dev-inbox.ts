// Persisted ring buffer of stubbed deliveries so in dev the login screen can
// show the magic link / OTP code without any real provider. Written to disk
// because Next.js can load this module in more than one bundle. Never used in prod.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { env } from "@/lib/env";

export interface DevMessage {
  at: number;
  kind: string;
  to: string;
  code?: string;
  magicLink?: string;
}

const FILE = join(process.cwd(), ".next", "stridevote-dev-inbox.json");
const MAX = 25;

function load(): DevMessage[] {
  try {
    const raw = readFileSync(FILE, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as DevMessage[]) : [];
  } catch {
    return [];
  }
}

function save(messages: DevMessage[]): void {
  try {
    mkdirSync(dirname(FILE), { recursive: true });
    writeFileSync(FILE, JSON.stringify(messages), "utf8");
  } catch {
    /* ignore — login screen will just keep polling */
  }
}

export function pushDevMessage(msg: DevMessage): void {
  if (!env.isDev) return;
  const inbox = load();
  inbox.push(msg);
  while (inbox.length > MAX) inbox.shift();
  save(inbox);
}

export function recentDevMessages(to?: string): DevMessage[] {
  if (!env.isDev) return [];
  const needle = to?.trim().toLowerCase();
  const list = needle
    ? load().filter((m) => m.to.toLowerCase() === needle)
    : load();
  return [...list].reverse();
}
