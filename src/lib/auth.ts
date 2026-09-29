import NextAuth, { AuthError } from "next-auth";
import type { NextAuthConfig } from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import type { Adapter } from "next-auth/adapters";
import Credentials from "next-auth/providers/credentials";
import type { Provider } from "next-auth/providers";
import { prisma } from "@/lib/db";
import { channelEnabled } from "@/lib/env";
import { emailChannel } from "@/lib/otp/adapters/email";
import { hashCode, OTP_MAX_ATTEMPTS } from "@/lib/otp";
import { normalizePhone } from "@/lib/phone";

// Email magic-link provider. Delivery is delegated to our channel abstraction
// (dev stub / Resend / SMTP) via sendVerificationRequest — no SMTP server needed.
const emailProvider = {
  id: "email",
  type: "email",
  name: "Email",
  from: process.env.EMAIL_FROM ?? "StrideVote <login@stride.vote>",
  maxAge: 24 * 60 * 60,
  async sendVerificationRequest({
    identifier,
    url,
  }: {
    identifier: string;
    url: string;
  }) {
    await emailChannel.send(identifier, { magicLink: url });
  },
} as unknown as Provider;

// Phone/WhatsApp OTP via Credentials: verifies a code from OtpChallenge and
// upserts the user by phone. (Credentials requires JWT sessions — set below.)
const otpProvider = Credentials({
  id: "otp",
  name: "One-time code",
  credentials: {
    destination: { label: "Phone" },
    channel: { label: "Channel" },
    code: { label: "Code" },
  },
  async authorize(creds) {
    const destination = normalizePhone(String(creds?.destination ?? ""));
    const channel = String(creds?.channel ?? "");
    const code = String(creds?.code ?? "").trim();
    if (!destination || !code || !["sms", "whatsapp"].includes(channel)) {
      return null;
    }
    const challenge = await prisma.otpChallenge.findFirst({
      where: { destination, channel, consumedAt: null },
      orderBy: { createdAt: "desc" },
    });
    if (!challenge) return null;
    if (challenge.expiresAt < new Date()) return null;
    if (challenge.attempts >= OTP_MAX_ATTEMPTS) return null;

    if (challenge.codeHash !== hashCode(destination, code)) {
      await prisma.otpChallenge.update({
        where: { id: challenge.id },
        data: { attempts: { increment: 1 } },
      });
      return null;
    }
    await prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { consumedAt: new Date() },
    });
    const user = await prisma.user.upsert({
      where: { phone: destination },
      update: {},
      create: { phone: destination },
    });
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
    };
  },
});

// Magic links are single-use, and re-opening one is routine: mail clients
// prefetch URLs and people re-tap the email. The stock adapter consumes the
// token with a `delete` that throws P2025 on the second pass, which Prisma
// reports through its own error log before the adapter swallows it. Look first,
// then consume with `deleteMany` so a spent link is a quiet miss. `deleteMany`
// still reports one affected row to exactly one caller, so racing requests
// can't both claim the same token.
function prismaAdapter(): Adapter {
  const adapter = PrismaAdapter(prisma);
  adapter.useVerificationToken = async ({ identifier, token }) => {
    const existing = await prisma.verificationToken.findUnique({
      where: { identifier_token: { identifier, token } },
    });
    if (!existing) return null;
    const { count } = await prisma.verificationToken.deleteMany({
      where: { identifier, token },
    });
    return count === 1 ? existing : null;
  };
  return adapter;
}

function activeProviders(): Provider[] {
  const list: Provider[] = [];
  if (channelEnabled("email")) list.push(emailProvider);
  if (channelEnabled("sms") || channelEnabled("whatsapp")) list.push(otpProvider);
  if (!list.length) list.push(emailProvider); // never leave auth with no provider
  return list;
}

export const authConfig: NextAuthConfig = {
  adapter: prismaAdapter(),
  // Honor AUTH_URL / X-Forwarded-Host so magic links match the public tunnel.
  trustHost: true,
  session: { strategy: "jwt" },
  // Magic links are single-use, so a re-clicked or expired link raises
  // Verification. Without an error page that lands on Auth.js's own HTML page;
  // send it back to our login form instead.
  pages: { signIn: "/login", verifyRequest: "/login?sent=1", error: "/login" },
  logger: {
    error(error) {
      // Auth.js raises Verification for a used or expired link. That is the
      // user's problem, not the server's, and the login page already explains
      // it — a stack trace here only looks like an outage.
      if (error instanceof AuthError && error.type === "Verification") {
        console.log(
          "[auth] sign-in link already used or expired — sent back to /login",
        );
        return;
      }
      console.error(error);
    },
  },
  providers: activeProviders(),
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.uid = user.id;
      return token;
    },
    async session({ session, token }) {
      if (token?.uid && session.user) {
        const uid = token.uid as string;
        session.user.id = uid;
        const u = await prisma.user.findUnique({ where: { id: uid } });
        if (u) {
          session.user.name = u.name;
          session.user.email = u.email ?? session.user.email;
          session.user.phone = u.phone;
          session.user.initials = u.initials;
          session.user.area = u.area;
          session.user.homeLat = u.homeLat;
          session.user.homeLng = u.homeLng;
        }
      }
      return session;
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
