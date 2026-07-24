import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import type { User } from "@/generated/prisma";

/** Full DB user for the current session, or null if signed out. */
export async function getSessionUser(): Promise<User | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return prisma.user.findUnique({ where: { id: session.user.id } });
}

export function initialsFor(name: string | null | undefined, fallback = "SV"): string {
  if (!name) return fallback;
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return fallback;
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase() || fallback;
}
