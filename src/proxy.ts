import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Optimistic, edge-safe route guard (Next.js 16 proxy, formerly middleware).
// It only checks for the presence of a session cookie — the authoritative check
// happens server-side in the (app) layout via auth(). This avoids importing
// Prisma/Auth into the edge runtime.
const PUBLIC_PREFIXES = [
  "/login",
  "/api/auth",
  "/api/otp",
  "/api/dev",
  "/api/minivan",
  "/brand",
  "/_next",
];

const SESSION_COOKIES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isPublic =
    PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/")) ||
    pathname === "/favicon.ico" ||
    pathname === "/manifest.webmanifest";

  if (isPublic) return NextResponse.next();

  const hasSession = SESSION_COOKIES.some((c) => req.cookies.has(c));
  if (!hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
