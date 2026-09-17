import { channelEnabled, env } from "@/lib/env";
import {
  deliverEmail,
  hasLiveEmailProvider,
} from "@/lib/email-delivery";
import type { OtpChannel } from "../channel";

// Mail clients need an absolute image URL, and the app is reachable under
// different hosts (localhost, ngrok, prod), so take the origin from the link
// we're already sending rather than a separate setting that could drift.
function assetOrigin(magicLink: string): string {
  try {
    return new URL(magicLink).origin;
  } catch {
    return process.env.AUTH_URL?.trim().replace(/\/+$/, "") || "";
  }
}

function renderHtml(magicLink: string): string {
  // PNG, not the SVG the app uses: Gmail and Outlook drop SVG images.
  const logo = `${assetOrigin(magicLink)}/brand/stridevote-icon-120.png`;
  return `<!doctype html><html><body style="margin:0;background:#eef2f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;padding:32px 16px;color:#1F2733">
  <div style="max-width:440px;margin:0 auto;background:#fff;border-radius:16px;padding:28px">
    <div style="margin-bottom:18px">
      <img src="${logo}" width="28" height="28" alt="" style="width:28px;height:28px;border:0;border-radius:8px;vertical-align:middle">
      <strong style="font-size:16px;vertical-align:middle;padding-left:10px">Stride<span style="color:#378ADD">Vote</span></strong>
    </div>
    <h1 style="font-size:19px;margin:0 0 8px">Sign in to StrideVote</h1>
    <p style="font-size:14px;color:#5b6472;margin:0 0 20px">Tap the button below to sign in. This link expires soon and can be used once.</p>
    <a href="${magicLink}" style="display:inline-block;background:#185FA5;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 20px;border-radius:10px">Sign in</a>
    <p style="font-size:12px;color:#9aa2ad;margin:22px 0 0;word-break:break-all">Or paste this URL: ${magicLink}</p>
  </div></body></html>`;
}

export const emailChannel: OtpChannel = {
  kind: "email-link",
  enabled: channelEnabled("email"),
  get live() {
    return hasLiveEmailProvider();
  },
  async send(to, { magicLink }) {
    if (!magicLink) throw new Error("email-link channel requires a magicLink");
    const message = {
      to,
      subject: "Your StrideVote sign-in link",
      html: renderHtml(magicLink),
      text: `Sign in to StrideVote: ${magicLink}`,
      devKind: "email-link",
      magicLink,
    };
    try {
      await deliverEmail(message);
      return;
    } catch (err) {
      console.error(
        `\u2716 [StrideVote][email-link] delivery to ${to} failed:`,
        err instanceof Error ? err.message : err,
      );
      // In dev, fall through to the on-screen link so a broken provider
      // doesn't lock you out of local sign-in.
      if (!env.isDev) throw err;
    }
    await deliverEmail(message, { forceDevStub: true });
  },
};
