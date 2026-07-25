"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { can, getManageableCampaignIds, isPlatformAdmin } from "@/lib/authz";
import { ASSIGNABLE_ROLES, DEFAULT_ROLES, normalizeRoles } from "@/lib/roles";
import { normalizePhone } from "@/lib/phone";

export interface AdminResult {
  ok: boolean;
  message: string;
  slug?: string;
}

function fail(message: string): AdminResult {
  return { ok: false, message };
}

function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base || "campaign";
}

async function uniqueSlug(
  base: string,
  exists: (slug: string) => Promise<boolean>,
): Promise<string> {
  let slug = base;
  let n = 1;
  while (await exists(slug)) slug = `${base}-${++n}`;
  return slug;
}

function revalidateCampaign(slug?: string) {
  revalidatePath("/manage");
  if (slug) revalidatePath(`/manage/${slug}`);
  revalidatePath("/campaigns");
  revalidatePath("/canvass");
}

/** Any campaign the list is linked to that the user may manage. */
async function canManageList(userId: string, listId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return false;
  const links = await prisma.listCampaign.findMany({ where: { listId } });
  for (const l of links) {
    if (await can(user, l.campaignId, "lists:manage")) return true;
  }
  return false;
}

// ---- Campaign profile ----
const profileSchema = z.object({
  name: z.string().min(1, "Name is required"),
  office: z.string().min(1, "Office is required"),
  district: z.string().min(1, "District is required"),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Color must be a hex value")
    .default("#185FA5"),
  tags: z.array(z.string().min(1)).default([]),
  volunteers: z.number().int().min(0).default(0),
  centroidLat: z.number().nullable().optional(),
  centroidLng: z.number().nullable().optional(),
  pickupType: z.enum(["locker", "address"]).nullable().optional(),
  pickupLabel: z.string().nullable().optional(),
  pickupDetail: z.string().nullable().optional(),
  contactName: z.string().optional(),
  contactRole: z.string().optional(),
  contactPhone: z.string().optional(),
  contactEmail: z.string().optional(),
});
export type CampaignProfileInput = z.input<typeof profileSchema>;

export async function createCampaign(input: unknown): Promise<AdminResult> {
  const user = await getSessionUser();
  if (!user) return fail("Please sign in.");
  if (!isPlatformAdmin(user)) return fail("Only platform admins can create campaigns.");

  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const d = parsed.data;

  const slug = await uniqueSlug(slugify(d.name), async (s) =>
    Boolean(await prisma.campaign.findUnique({ where: { slug: s } })),
  );

  await prisma.campaign.create({
    data: {
      slug,
      name: d.name,
      office: d.office,
      district: d.district,
      color: d.color,
      tags: d.tags,
      volunteers: d.volunteers,
      centroidLat: d.centroidLat ?? null,
      centroidLng: d.centroidLng ?? null,
      pickupType: d.pickupType ?? null,
      pickupLabel: d.pickupLabel ?? null,
      pickupDetail: d.pickupDetail ?? null,
      contacts:
        d.contactName && d.contactRole
          ? {
              create: [
                {
                  name: d.contactName,
                  role: d.contactRole,
                  phone: d.contactPhone || null,
                  email: d.contactEmail || null,
                },
              ],
            }
          : undefined,
      memberships: {
        create: [
          { userId: user.id, status: "active", roles: ["admin"], joinedAt: new Date() },
        ],
      },
    },
  });

  revalidateCampaign(slug);
  return { ok: true, message: `Created ${d.name}`, slug };
}

export async function updateCampaignProfile(
  campaignId: string,
  input: unknown,
): Promise<AdminResult> {
  const user = await getSessionUser();
  if (!user) return fail("Please sign in.");
  if (!(await can(user, campaignId, "campaign:edit"))) return fail("Not allowed.");

  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const d = parsed.data;

  const campaign = await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      name: d.name,
      office: d.office,
      district: d.district,
      color: d.color,
      tags: d.tags,
      volunteers: d.volunteers,
      centroidLat: d.centroidLat ?? null,
      centroidLng: d.centroidLng ?? null,
      pickupType: d.pickupType ?? null,
      pickupLabel: d.pickupLabel ?? null,
      pickupDetail: d.pickupDetail ?? null,
    },
  });

  if (d.contactName && d.contactRole) {
    const existing = await prisma.campaignContact.findFirst({ where: { campaignId } });
    const contactData = {
      name: d.contactName,
      role: d.contactRole,
      phone: d.contactPhone || null,
      email: d.contactEmail || null,
    };
    if (existing) {
      await prisma.campaignContact.update({ where: { id: existing.id }, data: contactData });
    } else {
      await prisma.campaignContact.create({ data: { campaignId, ...contactData } });
    }
  }

  revalidateCampaign(campaign.slug);
  return { ok: true, message: "Campaign updated" };
}

// ---- Membership ----
export async function approveMembership(
  campaignId: string,
  userId: string,
): Promise<AdminResult> {
  const user = await getSessionUser();
  if (!user) return fail("Please sign in.");
  if (!(await can(user, campaignId, "members:approve"))) return fail("Not allowed.");

  const membership = await prisma.campaignMembership.findUnique({
    where: { userId_campaignId: { userId, campaignId } },
  });
  if (!membership) return fail("Request not found.");

  await prisma.campaignMembership.update({
    where: { id: membership.id },
    data: {
      status: "active",
      joinedAt: membership.joinedAt ?? new Date(),
      roles: membership.roles.length ? membership.roles : [...DEFAULT_ROLES],
    },
  });
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  revalidateCampaign(campaign?.slug);
  return { ok: true, message: "Member approved" };
}

export async function denyMembership(
  campaignId: string,
  userId: string,
): Promise<AdminResult> {
  const user = await getSessionUser();
  if (!user) return fail("Please sign in.");
  if (!(await can(user, campaignId, "members:approve"))) return fail("Not allowed.");

  await prisma.campaignMembership.deleteMany({ where: { campaignId, userId } });
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  revalidateCampaign(campaign?.slug);
  return { ok: true, message: "Request declined" };
}

const addMemberSchema = z
  .object({
    email: z.string().email().optional().or(z.literal("")),
    phone: z.string().optional().or(z.literal("")),
    roles: z.array(z.string()).optional(),
  })
  .refine((v) => v.email || v.phone, { message: "Provide an email or phone number" });

export async function addMember(campaignId: string, input: unknown): Promise<AdminResult> {
  const user = await getSessionUser();
  if (!user) return fail("Please sign in.");
  if (!(await can(user, campaignId, "members:add"))) return fail("Not allowed.");

  const parsed = addMemberSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const { email, phone, roles } = parsed.data;

  // Assigning roles beyond the default requires the stronger permission.
  const wantsRoles = roles && roles.length > 0;
  const requested = normalizeRoles(roles ?? [...DEFAULT_ROLES]).filter((r) =>
    ASSIGNABLE_ROLES.includes(r),
  );
  const nonDefault = requested.some((r) => !DEFAULT_ROLES.includes(r));
  if (wantsRoles && nonDefault && !(await can(user, campaignId, "members:assign_roles"))) {
    return fail("You can't assign those roles.");
  }
  const finalRoles = requested.length ? requested : [...DEFAULT_ROLES];

  let target;
  if (email) {
    target = await prisma.user.upsert({
      where: { email: email.toLowerCase() },
      update: {},
      create: { email: email.toLowerCase() },
    });
  } else {
    const normalized = normalizePhone(phone ?? "");
    if (!normalized) return fail("Invalid phone number.");
    target = await prisma.user.upsert({
      where: { phone: normalized },
      update: {},
      create: { phone: normalized },
    });
  }

  await prisma.campaignMembership.upsert({
    where: { userId_campaignId: { userId: target.id, campaignId } },
    update: { status: "active", roles: finalRoles, joinedAt: new Date() },
    create: {
      userId: target.id,
      campaignId,
      status: "active",
      roles: finalRoles,
      joinedAt: new Date(),
    },
  });

  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  revalidateCampaign(campaign?.slug);
  return { ok: true, message: `Added ${email || phone}` };
}

export async function setMemberRoles(
  campaignId: string,
  userId: string,
  roles: string[],
): Promise<AdminResult> {
  const user = await getSessionUser();
  if (!user) return fail("Please sign in.");
  if (!(await can(user, campaignId, "members:assign_roles"))) return fail("Not allowed.");

  const clean = normalizeRoles(roles).filter((r) => ASSIGNABLE_ROLES.includes(r));
  if (!clean.length) return fail("Select at least one role.");

  const membership = await prisma.campaignMembership.findUnique({
    where: { userId_campaignId: { userId, campaignId } },
  });
  if (!membership || membership.status !== "active") return fail("Member not found.");

  await prisma.campaignMembership.update({
    where: { id: membership.id },
    data: { roles: clean },
  });
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  revalidateCampaign(campaign?.slug);
  return { ok: true, message: "Roles updated" };
}

// ---- Lists ----
const listSchema = z.object({
  name: z.string().min(1, "Name is required"),
  neighborhood: z.string().min(1, "Neighborhood is required"),
  source: z.enum(["minivan", "civibyte", "manual"]),
  sourceRef: z.string().optional().or(z.literal("")),
  doorsCount: z.number().int().min(0).default(0),
  distanceMi: z.number().nullable().optional(),
  centroidLat: z.number().nullable().optional(),
  centroidLng: z.number().nullable().optional(),
});
export type ListInput = z.input<typeof listSchema>;

export async function createList(
  campaignId: string,
  input: unknown,
): Promise<AdminResult> {
  const user = await getSessionUser();
  if (!user) return fail("Please sign in.");
  if (!(await can(user, campaignId, "lists:manage"))) return fail("Not allowed.");

  const parsed = listSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const d = parsed.data;

  const slug = await uniqueSlug(slugify(d.name), async (s) =>
    Boolean(await prisma.list.findUnique({ where: { slug: s } })),
  );

  await prisma.list.create({
    data: {
      slug,
      name: d.name,
      neighborhood: d.neighborhood,
      source: d.source,
      sourceRef: d.sourceRef || null,
      doorsCount: d.doorsCount,
      distanceMi: d.distanceMi ?? null,
      centroidLat: d.centroidLat ?? null,
      centroidLng: d.centroidLng ?? null,
      campaignLinks: { create: [{ campaignId }] },
    },
  });

  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  revalidateCampaign(campaign?.slug);
  return { ok: true, message: `Created ${d.name}` };
}

export async function updateList(listId: string, input: unknown): Promise<AdminResult> {
  const user = await getSessionUser();
  if (!user) return fail("Please sign in.");
  if (!(await canManageList(user.id, listId))) return fail("Not allowed.");

  const parsed = listSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const d = parsed.data;

  await prisma.list.update({
    where: { id: listId },
    data: {
      name: d.name,
      neighborhood: d.neighborhood,
      source: d.source,
      sourceRef: d.sourceRef || null,
      doorsCount: d.doorsCount,
      distanceMi: d.distanceMi ?? null,
      centroidLat: d.centroidLat ?? null,
      centroidLng: d.centroidLng ?? null,
    },
  });

  revalidatePath("/manage");
  revalidatePath("/canvass");
  return { ok: true, message: "List updated" };
}

export async function deleteList(listId: string): Promise<AdminResult> {
  const user = await getSessionUser();
  if (!user) return fail("Please sign in.");
  if (!(await canManageList(user.id, listId))) return fail("Not allowed.");

  const active = await prisma.listCheckout.count({
    where: { listId, status: "active" },
  });
  if (active > 0) return fail("Release active checkouts before deleting this list.");

  await prisma.list.delete({ where: { id: listId } });
  revalidatePath("/manage");
  revalidatePath("/canvass");
  return { ok: true, message: "List deleted" };
}

export async function setListCampaigns(
  listId: string,
  campaignIds: string[],
): Promise<AdminResult> {
  const user = await getSessionUser();
  if (!user) return fail("Please sign in.");
  if (!(await canManageList(user.id, listId))) return fail("Not allowed.");
  if (!campaignIds.length) return fail("Link the list to at least one campaign.");

  // Must be able to manage every target campaign.
  for (const id of campaignIds) {
    if (!(await can(user, id, "lists:manage"))) return fail("Not allowed for a selected campaign.");
  }

  await prisma.$transaction([
    prisma.listCampaign.deleteMany({ where: { listId } }),
    prisma.listCampaign.createMany({
      data: campaignIds.map((campaignId) => ({ listId, campaignId })),
      skipDuplicates: true,
    }),
  ]);

  revalidatePath("/manage");
  revalidatePath("/canvass");
  return { ok: true, message: "List links updated" };
}

// Used by the Manage index redirect when a user administers exactly one campaign.
export async function firstManageableSlug(): Promise<string | null> {
  const user = await getSessionUser();
  if (!user) return null;
  const ids = await getManageableCampaignIds(user);
  if (ids === "all" || ids.length !== 1) return null;
  const campaign = await prisma.campaign.findUnique({ where: { id: ids[0] } });
  return campaign?.slug ?? null;
}
