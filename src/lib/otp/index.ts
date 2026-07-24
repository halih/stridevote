import crypto from "node:crypto";
import { emailChannel } from "./adapters/email";
import { smsChannel } from "./adapters/sms";
import { whatsappChannel } from "./adapters/whatsapp";
import type { OtpChannel, OtpChannelKind } from "./channel";

const channels: Record<OtpChannelKind, OtpChannel> = {
  "email-link": emailChannel,
  sms: smsChannel,
  whatsapp: whatsappChannel,
};

export function getChannel(kind: OtpChannelKind): OtpChannel {
  return channels[kind];
}

export function enabledPhoneChannels(): OtpChannel[] {
  return [smsChannel, whatsappChannel].filter((c) => c.enabled);
}

/** 6-digit numeric code. */
export function generateCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

/** Salted hash so raw codes are never stored. */
export function hashCode(destination: string, code: string): string {
  const salt = process.env.AUTH_SECRET ?? "dev";
  return crypto
    .createHash("sha256")
    .update(`${destination}:${code}:${salt}`)
    .digest("hex");
}

export const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
export const OTP_MAX_ATTEMPTS = 5;

export type { OtpChannel, OtpChannelKind } from "./channel";
