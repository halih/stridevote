// Channel-agnostic delivery abstraction. Every auth delivery method (email magic
// link, SMS OTP, WhatsApp OTP) implements this one interface, so swapping a
// provider or enabling a channel is a one-file change + an env flag.

export type OtpChannelKind = "email-link" | "sms" | "whatsapp";

export interface OtpDeliveryPayload {
  /** 6-digit code for sms/whatsapp channels. */
  code?: string;
  /** Full magic-link URL for the email-link channel. */
  magicLink?: string;
}

export interface OtpChannel {
  kind: OtpChannelKind;
  /** Whether this channel is turned on via AUTH_CHANNELS. */
  enabled: boolean;
  /** Whether a real provider is configured (vs. the dev console stub). */
  live: boolean;
  send(to: string, payload: OtpDeliveryPayload): Promise<void>;
}
