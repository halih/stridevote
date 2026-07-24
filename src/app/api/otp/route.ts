import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { channelEnabled } from "@/lib/env";
import { normalizePhone } from "@/lib/phone";
import { generateCode, getChannel, hashCode, OTP_TTL_MS } from "@/lib/otp";

// Issue a phone/WhatsApp OTP: generate a code, store its hash, deliver via the
// selected channel. Email uses the Auth.js magic-link flow instead of this route.
export async function POST(req: Request) {
  let body: { destination?: string; channel?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const channel = String(body.channel ?? "");
  if (channel !== "sms" && channel !== "whatsapp") {
    return NextResponse.json({ error: "unsupported channel" }, { status: 400 });
  }
  if (!channelEnabled(channel)) {
    return NextResponse.json({ error: "channel not enabled" }, { status: 400 });
  }

  const destination = normalizePhone(String(body.destination ?? ""));
  if (!destination) {
    return NextResponse.json({ error: "invalid phone number" }, { status: 400 });
  }

  const code = generateCode();
  await prisma.otpChallenge.create({
    data: {
      channel,
      destination,
      codeHash: hashCode(destination, code),
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
    },
  });

  await getChannel(channel).send(destination, { code });

  return NextResponse.json({ ok: true, destination });
}
