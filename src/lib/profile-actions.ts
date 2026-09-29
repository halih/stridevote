"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma";
import { getSessionUser } from "@/lib/session";
import { normalizePhone } from "@/lib/phone";
import { displayIdentity, removingLastLoginIdentifier } from "@/lib/profile-identity";
import { geocodeAddress, reverseGeocode } from "@/lib/geocode";

export interface ProfileResult {
  ok: boolean;
  message: string;
}

export interface ResolvedLocation {
  ok: boolean;
  message: string;
  lat?: number;
  lng?: number;
  label?: string;
}

const resolveSchema = z.object({
  method: z.enum(["address", "city", "zip", "gps"]),
  query: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
});

/** Geocode the user's chosen location input so the form can preview it. */
export async function resolveLocation(input: unknown): Promise<ResolvedLocation> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: "Please sign in." };

  const parsed = resolveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid location input." };
  const d = parsed.data;

  try {
    if (d.method === "gps") {
      if (d.lat == null || d.lng == null) {
        return { ok: false, message: "No coordinates from your device." };
      }
      const label = await reverseGeocode(d.lat, d.lng);
      return {
        ok: true,
        message: label ? "Found your location" : "Using your coordinates",
        lat: d.lat,
        lng: d.lng,
        label: label ?? `${d.lat.toFixed(4)}, ${d.lng.toFixed(4)}`,
      };
    }

    const q = (d.query ?? "").trim();
    if (!q) return { ok: false, message: "Enter a location to search." };
    const hit = await geocodeAddress(q, { kind: d.method });
    if (!hit) return { ok: false, message: "Couldn't find that location. Try being more specific." };
    return { ok: true, message: "Location found", lat: hit.lat, lng: hit.lng, label: hit.label };
  } catch {
    return { ok: false, message: "Location lookup failed. Please try again." };
  }
}

const updateSchema = z.object({
  firstName: z.string().trim().max(80).optional().or(z.literal("")),
  lastName: z.string().trim().max(80).optional().or(z.literal("")),
  phone: z.string().trim().optional().or(z.literal("")),
  location: z
    .object({
      lat: z.number(),
      lng: z.number(),
      label: z.string(),
      source: z.enum(["address", "city", "zip", "gps"]),
      addressLine: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      postalCode: z.string().optional(),
    })
    .nullable()
    .optional(),
});

export async function updateProfile(input: unknown): Promise<ProfileResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: "Please sign in." };

  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;

  const firstName = (d.firstName ?? "").trim();
  const lastName = (d.lastName ?? "").trim();
  const identity = displayIdentity(firstName, lastName);

  let phone: string | null = user.phone;
  if (d.phone !== undefined) {
    const raw = (d.phone ?? "").trim();
    if (!raw) {
      phone = null;
    } else {
      const normalized = normalizePhone(raw);
      if (!normalized) return { ok: false, message: "Enter a valid phone number." };
      if (normalized !== user.phone) {
        const clash = await prisma.user.findFirst({
          where: { phone: normalized, NOT: { id: user.id } },
          select: { id: true },
        });
        if (clash) {
          return { ok: false, message: "That phone number is already in use." };
        }
      }
      phone = normalized;
    }
  }

  if (
    removingLastLoginIdentifier({
      email: user.email,
      currentPhone: user.phone,
      nextPhone: phone,
    })
  ) {
    return {
      ok: false,
      message: "This phone number is how you sign in, so it can't be removed.",
    };
  }

  const data: Record<string, unknown> = {
    firstName: firstName || null,
    lastName: lastName || null,
    name: identity.name,
    initials: identity.initials,
    phone,
  };

  if (d.location) {
    const loc = d.location;
    data.homeLat = loc.lat;
    data.homeLng = loc.lng;
    data.area = loc.label;
    data.locationSource = loc.source;
    data.addressLine = loc.addressLine ?? null;
    data.city = loc.city ?? null;
    data.state = loc.state ?? null;
    data.postalCode = loc.postalCode ?? null;
  }

  try {
    await prisma.user.update({ where: { id: user.id }, data });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const target = Array.isArray(err.meta?.target)
        ? (err.meta.target as string[]).join(" ")
        : String(err.meta?.target ?? "");
      if (target.includes("phone")) {
        return { ok: false, message: "That phone number is already in use." };
      }
      if (target.includes("email")) {
        return { ok: false, message: "That email is already in use." };
      }
      return { ok: false, message: "That contact is already in use." };
    }
    throw err;
  }

  revalidatePath("/profile");
  revalidatePath("/campaigns");
  revalidatePath("/canvass");
  return { ok: true, message: "Profile saved" };
}
