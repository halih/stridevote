import { deliverEmail } from "@/lib/email-delivery";
import { env } from "@/lib/env";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function listAvailableEmailContent(
  listName: string,
  programName: string,
  canvassUrl = new URL("/canvass", env.authUrl).toString(),
  reason: "released" | "split" = "released",
) {
  const safeListName = escapeHtml(listName);
  const safeProgramName = escapeHtml(programName);
  const safeUrl = escapeHtml(canvassUrl);
  const subject = `${listName} is available`;
  const text =
    reason === "split"
      ? `${listName} became available when a list you watch in ${programName} was split. Open StrideVote to check it out: ${canvassUrl}`
      : `${listName} is available again in ${programName}. Open StrideVote to check it out: ${canvassUrl}`;
  const explanation =
    reason === "split"
      ? `A new list became available when the list you were watching in ${safeProgramName} was split.`
      : `The list you were watching in ${safeProgramName} was released.`;
  const html = `<!doctype html><html><body style="margin:0;background:#eef2f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;padding:32px 16px;color:#1F2733">
  <div style="max-width:440px;margin:0 auto;background:#fff;border-radius:16px;padding:28px">
    <strong style="font-size:16px">Stride<span style="color:#378ADD">Vote</span></strong>
    <h1 style="font-size:19px;margin:18px 0 8px">${safeListName} is available</h1>
    <p style="font-size:14px;color:#5b6472;margin:0 0 20px">${explanation} Availability is first come, first served.</p>
    <a href="${safeUrl}" style="display:inline-block;background:#185FA5;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 20px;border-radius:10px">View canvass lists</a>
  </div></body></html>`;

  return { subject, text, html };
}

export async function sendListAvailableEmail(
  to: string,
  listName: string,
  programName: string,
  reason: "released" | "split" = "released",
): Promise<void> {
  await deliverEmail({
    to,
    ...listAvailableEmailContent(listName, programName, undefined, reason),
    devKind: "list-available",
  });
}
