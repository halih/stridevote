import { env } from "@/lib/env";
import { pushDevMessage } from "@/lib/otp/dev-inbox";
import { isUndeliverableAddress } from "@/lib/otp/test-address";

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  devKind?: string;
  magicLink?: string;
}

const resendKey = () => process.env.RESEND_API_KEY?.trim() || undefined;
const smtpUrl = () => process.env.SMTP_URL?.trim() || undefined;
const from = () =>
  process.env.EMAIL_FROM?.trim() || "StrideVote <login@stride.vote>";

export function hasLiveEmailProvider(): boolean {
  return Boolean(resendKey() || smtpUrl());
}

export async function deliverEmail(
  message: EmailMessage,
  options: { forceDevStub?: boolean } = {},
): Promise<void> {
  const undeliverable =
    options.forceDevStub ||
    (env.isDev && isUndeliverableAddress(message.to));

  if (!undeliverable && resendKey()) {
    const { Resend } = await import("resend");
    const resend = new Resend(resendKey());
    const { error } = await resend.emails.send({
      from: from(),
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
    if (error) throw new Error(`Resend rejected the message: ${error.message}`);
    return;
  }

  if (!undeliverable && smtpUrl()) {
    const nodemailer = (await import("nodemailer")).default;
    const transport = nodemailer.createTransport(smtpUrl() as string);
    const info = await transport.sendMail({
      from: from(),
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
    console.log(
      `✉️  [StrideVote][email] sent to ${message.to} (${info.messageId})`,
    );
    return;
  }

  if (!env.isDev) {
    throw new Error("No email provider is configured.");
  }

  console.log(
    `\n✉️  [StrideVote][email] -> ${message.to}\n   ${message.subject}\n   ${message.text}\n`,
  );
  pushDevMessage({
    at: Date.now(),
    kind: message.devKind ?? "email",
    to: message.to,
    subject: message.subject,
    text: message.text,
    magicLink: message.magicLink,
  });
}
