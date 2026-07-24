// In-memory ring buffer of stubbed deliveries, so in dev the login screen can
// show the magic link / OTP code without any real provider. Never used in prod.

import { env } from "@/lib/env";

export interface DevMessage {
  at: number;
  kind: string;
  to: string;
  code?: string;
  magicLink?: string;
}

const globalForInbox = globalThis as unknown as { __devInbox?: DevMessage[] };
const inbox: DevMessage[] = (globalForInbox.__devInbox ??= []);

const MAX = 25;

export function pushDevMessage(msg: DevMessage): void {
  if (!env.isDev) return;
  inbox.push(msg);
  while (inbox.length > MAX) inbox.shift();
}

export function recentDevMessages(to?: string): DevMessage[] {
  const list = to ? inbox.filter((m) => m.to === to) : inbox;
  return [...list].reverse();
}
