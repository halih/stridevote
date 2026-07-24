import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { recentDevMessages } from "@/lib/otp/dev-inbox";

// Dev-only: surfaces stubbed magic links / OTP codes so you can sign in locally
// without a real email/SMS provider. Returns nothing in production.
export async function GET(req: Request) {
  if (!env.isDev) return NextResponse.json({ messages: [] });
  const to = new URL(req.url).searchParams.get("to") ?? undefined;
  return NextResponse.json({ messages: recentDevMessages(to) });
}
