import { channelEnabled } from "@/lib/env";
import { pushDevMessage } from "../dev-inbox";
import type { OtpChannel } from "../channel";

const RESEND_KEY = process.env.RESEND_API_KEY;
const SMTP_URL = process.env.SMTP_URL;
const FROM = process.env.EMAIL_FROM ?? "StrideVote <login@stride.vote>";

function renderHtml(magicLink: string): string {
  return `<!doctype html><html><body style="margin:0;background:#eef2f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;padding:32px 16px;color:#1F2733">
  <div style="max-width:440px;margin:0 auto;background:#fff;border-radius:16px;padding:28px">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:18px">
      <div style="width:28px;height:28px;border-radius:8px;background:#185FA5"></div>
      <strong style="font-size:16px">Stride<span style="color:#378ADD">Vote</span></strong>
    </div>
    <h1 style="font-size:19px;margin:0 0 8px">Sign in to StrideVote</h1>
    <p style="font-size:14px;color:#5b6472;margin:0 0 20px">Tap the button below to sign in. This link expires soon and can be used once.</p>
    <a href="${magicLink}" style="display:inline-block;background:#185FA5;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 20px;border-radius:10px">Sign in</a>
    <p style="font-size:12px;color:#9aa2ad;margin:22px 0 0;word-break:break-all">Or paste this URL: ${magicLink}</p>
  </div></body></html>`;
}

async function sendViaResend(to: string, magicLink: string): Promise<void> {
  const { Resend } = await import("resend");
  const resend = new Resend(RESEND_KEY);
  await resend.emails.send({
    from: FROM,
    to,
    subject: "Your StrideVote sign-in link",
    html: renderHtml(magicLink),
  });
}

async function sendViaSmtp(to: string, magicLink: string): Promise<void> {
  const nodemailer = (await import("nodemailer")).default;
  const transport = nodemailer.createTransport(SMTP_URL as string);
  await transport.sendMail({
    from: FROM,
    to,
    subject: "Your StrideVote sign-in link",
    html: renderHtml(magicLink),
  });
}

export const emailChannel: OtpChannel = {
  kind: "email-link",
  enabled: channelEnabled("email"),
  live: Boolean(RESEND_KEY || SMTP_URL),
  async send(to, { magicLink }) {
    if (!magicLink) throw new Error("email-link channel requires a magicLink");
    if (RESEND_KEY) return void (await sendViaResend(to, magicLink));
    if (SMTP_URL) return void (await sendViaSmtp(to, magicLink));
    // Dev stub: no provider configured.
    console.log(
      `\n\u2709\uFE0F  [StrideVote][email-link] -> ${to}\n   ${magicLink}\n`,
    );
    pushDevMessage({ at: Date.now(), kind: "email-link", to, magicLink });
  },
};
