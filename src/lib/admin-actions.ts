"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { can, canManageAnything, getManageableCampaignIds, isPlatformAdmin } from "@/lib/authz";
import {
  ASSIGNABLE_ROLES,
  DEFAULT_ROLES,
  normalizeRoles,
  permissionsForRoles,
} from "@/lib/roles";
import { normalizePhone } from "@/lib/phone";
import { geocodeRegion, type RegionType } from "@/lib/geocode";
import { pointInPolygon, polygonCentroid } from "@/lib/geo";
import { loadPrecinctsForDistrict } from "@/lib/precincts";
import type { PrecinctOverlay } from "@/lib/precinct-geometry";
import {
  generateHouseholdList,
  previewListGeneration,
  previewTurfBoundary,
  previewTurfPrecinct,
  type ListSourceMode,
} from "@/lib/list-generation";
import {
  sanitizeVoterFilters,
  type VoterFilters,
} from "@/lib/voter-filters";
import {
  ensureActiveProgram,
  snapshotListIntoProgram,
} from "@/lib/canvass/programs";
import { programQuestionSchema } from "@/lib/canvass/outcomes";

export interface AdminResult {
  ok: boolean;
  message: string;
  slug?: string;
  id?: string;
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
  revalidatePath("/admin");
  if (slug) revalidatePath(`/admin/${slug}`);
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
  website: z
    .string()
    .url("Website must be a valid URL")
    .refine((value) => /^https?:\/\//i.test(value), "Website must use http or https")
    .nullable()
    .optional(),
  iconUrl: z
    .string()
    .url("Icon must be a valid image URL")
    .refine((value) => /^https?:\/\//i.test(value), "Icon URL must use http or https")
    .nullable()
    .optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Color must be a hex value")
    .default("#185FA5"),
  tags: z.array(z.string().min(1)).default([]),
  volunteers: z.number().int().min(0).default(0),
  centroidLat: z.number().nullable().optional(),
  centroidLng: z.number().nullable().optional(),
  regionType: z
    .enum(["state", "county", "city", "legislative", "congressional"])
    .nullable()
    .optional(),
  regionName: z.string().nullable().optional(),
  regionState: z.string().nullable().optional(),
  boundary: z.array(z.array(z.number())).nullable().optional(),
  pickupType: z.enum(["locker", "address"]).nullable().optional(),
  pickupLabel: z.string().nullable().optional(),
  pickupAddress: z.string().nullable().optional(),
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

  const campaign = await prisma.campaign.create({
    data: {
      slug,
      name: d.name,
      office: d.office,
      district: d.district,
      website: d.website ?? null,
      iconUrl: d.iconUrl ?? null,
      color: d.color,
      tags: d.tags,
      volunteers: d.volunteers,
      centroidLat: d.centroidLat ?? null,
      centroidLng: d.centroidLng ?? null,
      regionType: d.regionType ?? null,
      regionName: d.regionName ?? null,
      regionState: d.regionState ?? null,
      boundary: d.boundary ?? undefined,
      pickupType: d.pickupType ?? null,
      pickupLabel: d.pickupLabel ?? null,
      pickupAddress: d.pickupAddress ?? null,
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
      programs: {
        create: [{ name: "Default", status: "active", questions: [] }],
      },
    },
  });

  revalidateCampaign(campaign.slug);
  return { ok: true, message: `Created ${d.name}`, slug: campaign.slug };
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
      website: d.website ?? null,
      iconUrl: d.iconUrl ?? null,
      color: d.color,
      tags: d.tags,
      volunteers: d.volunteers,
      pickupType: d.pickupType ?? null,
      pickupLabel: d.pickupLabel ?? null,
      pickupAddress: d.pickupAddress ?? null,
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

export async function deleteCampaign(campaignId: string): Promise<AdminResult> {
  const user = await getSessionUser();
  if (!user) return fail("Please sign in.");
  if (!(await can(user, campaignId, "campaign:delete"))) return fail("Not allowed.");

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: { listLinks: { select: { listId: true } } },
  });
  if (!campaign) return fail("Campaign not found.");

  const listIds = campaign.listLinks.map((link) => link.listId);

  await prisma.$transaction(async (tx) => {
    await tx.campaign.delete({ where: { id: campaignId } });
    await tx.list.deleteMany({
      where: {
        id: { in: listIds },
        campaignLinks: { none: {} },
      },
    });
  });

  revalidatePath("/admin");
  revalidatePath("/campaigns");
  revalidatePath("/canvass");
  return { ok: true, message: `Deleted ${campaign.name}` };
}

export interface RegionResolveResult {
  ok: boolean;
  message: string;
  centroidLat?: number;
  centroidLng?: number;
  boundary?: [number, number][] | null;
  label?: string;
  hasBoundary?: boolean;
}

const regionResolveSchema = z.object({
  regionType: z.enum(["state", "county", "city", "legislative", "congressional"]),
  regionName: z.string().min(1, "Enter a region name"),
  regionState: z.string().default("WA"),
});

/** Resolve a campaign's geographic region to a boundary polygon for preview. */
export async function geocodeCampaignRegion(input: unknown): Promise<RegionResolveResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: "Please sign in." };
  if (!(await canManageAnything(user))) return { ok: false, message: "Not allowed." };

  const parsed = regionResolveSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid region." };
  }
  const { regionType, regionName, regionState } = parsed.data;

  try {
    const region = await geocodeRegion(
      regionType as RegionType["type"],
      regionName,
      regionState || "WA",
    );
    if (!region) {
      return {
        ok: false,
        message:
          regionType === "legislative" || regionType === "congressional"
            ? `Couldn't find ${regionType === "legislative" ? "LD" : "CD"} ${regionName} in ${regionState || "WA"}. Try a number like 32.`
            : "Couldn't find that region. Try a different name.",
      };
    }
    return {
      ok: true,
      message: region.hasBoundary
        ? "Region resolved"
        : "Found a center point, but no boundary outline is available for this region.",
      centroidLat: region.centroidLat,
      centroidLng: region.centroidLng,
      boundary: region.boundary,
      label: region.label,
      hasBoundary: region.hasBoundary,
    };
  } catch (err) {
    console.error("geocodeCampaignRegion failed", err);
    return { ok: false, message: "Region lookup failed. Please try again." };
  }
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
const boundarySchema = z
  .array(
    z.tuple([
      z.number().finite().min(-90).max(90),
      z.number().finite().min(-180).max(180),
    ]),
  )
  .min(3, "Draw at least three points.")
  .max(500, "Turf boundary is too detailed.");

const turfVisibilitySchema = z.enum(["volunteers", "assigned", "draft"]);

const listSchema = z.object({
  name: z.string().min(1, "Name is required"),
  source: z.enum(["minivan", "civibyte", "stridevote"]),
  sourceRef: z.string().optional().or(z.literal("")),
  doorsCount: z.number().int().min(0).default(0),
});
export type ListInput = z.input<typeof listSchema>;

const listUpdateSchema = z.object({
  name: z.string().min(1, "Name is required"),
  sourceRef: z.string().optional().or(z.literal("")),
});

const listSourceModeSchema = z.enum(["all", "filters", "saved"]);

// Present when the turf came from picking an official precinct, which lets doors
// be counted from the voter file instead of from coordinates.
const precinctRefSchema = z.object({
  countyCode: z.string().trim().min(1).max(8),
  code: z.string().trim().min(1).max(32),
});

const turfSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  doorsCount: z.number().int().min(0).default(0),
  boundary: boundarySchema,
  visibility: turfVisibilitySchema.default("draft"),
  assignedUserId: z.string().nullable().optional(),
  programId: z.string().min(1, "Choose a wave"),
  voterSource: listSourceModeSchema.default("all"),
  savedFilterId: z.string().nullable().optional(),
  precinct: precinctRefSchema.nullable().optional(),
  generateVoters: z.boolean().default(true),
});

const turfPreviewSchema = z.object({
  boundary: boundarySchema,
  voterSource: listSourceModeSchema.default("all"),
  savedFilterId: z.string().nullable().optional(),
  precinct: precinctRefSchema.nullable().optional(),
});

const precinctTurfBatchSchema = z.object({
  precincts: z.array(precinctRefSchema).min(2).max(100),
  visibility: turfVisibilitySchema.default("draft"),
  assignedUserId: z.string().nullable().optional(),
  programId: z.string().min(1, "Choose a wave"),
  voterSource: listSourceModeSchema.default("all"),
  savedFilterId: z.string().nullable().optional(),
});

const savedFilterSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  filters: z.record(z.string()).optional(),
});

const generateListSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  mode: listSourceModeSchema,
  filters: z.record(z.string()).optional(),
  savedFilterId: z.string().nullable().optional(),
});

async function validateTurfAssignment(
  campaignId: string,
  visibility: z.infer<typeof turfVisibilitySchema>,
  assignedUserId?: string | null,
): Promise<string | null> {
  if (visibility !== "assigned") return null;
  if (!assignedUserId) return "Choose a volunteer.";

  const membership = await prisma.campaignMembership.findUnique({
    where: { userId_campaignId: { userId: assignedUserId, campaignId } },
  });
  if (
    !membership ||
    membership.status !== "active" ||
    !permissionsForRoles(membership.roles).has("canvass:checkout")
  ) {
    return "That volunteer is not active on this campaign.";
  }
  return null;
}

/**
 * Assigning a turf hands it straight to that volunteer, so they never have to
 * check it out themselves. Idempotent: an assignment they already hold is left
 * alone rather than restarting their progress.
 */
async function checkOutToAssignee(
  listId: string,
  programId: string,
  userId: string,
  doorsCount: number,
): Promise<void> {
  const held = await prisma.listCheckout.findFirst({
    where: { listId, programId, userId, status: "active" },
    select: { id: true },
  });
  if (!held) {
    await prisma.listCheckout.create({
      data: {
        listId,
        programId,
        userId,
        status: "active",
        progressTotal: doorsCount,
      },
    });
  }
  await prisma.listWatch.deleteMany({ where: { listId, userId } });
}

export async function loadCampaignPrecincts(
  campaignId: string,
): Promise<{ ok: true; precincts: PrecinctOverlay[] } | AdminResult> {
  const user = await getSessionUser();
  if (!user) return fail("Please sign in.");
  if (!(await can(user, campaignId, "lists:manage"))) return fail("Not allowed.");

  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) return fail("Campaign not found.");
  const districtBoundary = Array.isArray(campaign.boundary)
    ? (campaign.boundary as [number, number][])
    : null;
  if (!districtBoundary?.length) {
    return fail("Set this campaign's geographic region before loading precincts.");
  }

  try {
    const precincts = await loadPrecinctsForDistrict(
      districtBoundary,
      campaign.regionState,
      campaignId,
    );
    return { ok: true, precincts };
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Could not load precincts");
  }
}

/** Door and voter counts a turf polygon would produce, for display before saving. */
export async function previewTurfDoors(
  campaignId: string,
  input: unknown,
): Promise<
  AdminResult & { doors?: number; voters?: number; ungeocoded?: number }
> {
  const user = await getSessionUser();
  if (!user) return fail("Please sign in.");
  if (!(await can(user, campaignId, "lists:manage"))) return fail("Not allowed.");

  const parsed = turfPreviewSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid turf");
  const data = parsed.data;

  try {
    const preview = data.precinct
      ? await previewTurfPrecinct({
          campaignId,
          mode: data.voterSource,
          savedFilterId: data.savedFilterId,
          precinct: data.precinct,
        })
      : await previewTurfBoundary({
          campaignId,
          mode: data.voterSource,
          savedFilterId: data.savedFilterId,
          boundary: data.boundary,
        });
    return {
      ok: true,
      message: `${preview.doors} doors / ${preview.voters} voters`,
      doors: preview.doors,
      voters: preview.voters,
      ungeocoded: preview.ungeocodedDoors,
    };
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Could not count doors");
  }
}

export async function createTurf(
  campaignId: string,
  input: unknown,
): Promise<AdminResult> {
  const user = await getSessionUser();
  if (!user) return fail("Please sign in.");
  if (!(await can(user, campaignId, "lists:manage"))) return fail("Not allowed.");

  const parsed = turfSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid turf");
  const data = parsed.data;

  const assignmentError = await validateTurfAssignment(
    campaignId,
    data.visibility,
    data.assignedUserId,
  );
  if (assignmentError) return fail(assignmentError);

  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) return fail("Campaign not found.");
  const districtBoundary = Array.isArray(campaign.boundary)
    ? (campaign.boundary as [number, number][])
    : null;
  if (
    districtBoundary?.length &&
    data.boundary.some((point) => !pointInPolygon(point, districtBoundary))
  ) {
    return fail("Keep the entire turf inside the campaign district.");
  }

  if (data.generateVoters) {
    try {
      const program = await prisma.canvassProgram.findFirst({
        where: { id: data.programId, campaignId },
        select: { id: true },
      });
      if (!program) return fail("Choose a valid wave for this campaign.");

      const generated = await generateHouseholdList({
        campaignId,
        name: data.name,
        mode: data.voterSource,
        savedFilterId: data.savedFilterId,
        boundary: data.boundary,
        precinct: data.precinct ?? null,
        programId: program.id,
      });
      await prisma.listCampaign.updateMany({
        where: { listId: generated.listId, campaignId, programId: program.id },
        data: {
          visibility: data.visibility,
          assignedUserId:
            data.visibility === "assigned" ? data.assignedUserId : null,
        },
      });
      if (data.visibility !== "draft") {
        await snapshotListIntoProgram(program.id, generated.listId);
      }
      if (data.visibility === "assigned" && data.assignedUserId) {
        await checkOutToAssignee(
          generated.listId,
          program.id,
          data.assignedUserId,
          generated.doorsCount,
        );
      }
      revalidateCampaign(campaign.slug);
      const excluded =
        generated.excludedUnresolved > 0
          ? ` (${generated.excludedUnresolved} unresolved doors excluded)`
          : "";
      return {
        ok: true,
        message: `Created ${data.name}: ${generated.doorsCount} doors, ${generated.voterCount} voters${excluded}`,
        id: generated.listId,
      };
    } catch (err) {
      return fail(err instanceof Error ? err.message : "Could not generate turf list");
    }
  }

  const program = await prisma.canvassProgram.findFirst({
    where: { id: data.programId, campaignId },
    select: { id: true },
  });
  if (!program) return fail("Choose a valid wave for this campaign.");
  const centroid = polygonCentroid(data.boundary);
  const slug = await uniqueSlug(slugify(data.name), async (value) =>
    Boolean(await prisma.list.findUnique({ where: { slug: value } })),
  );
  const list = await prisma.list.create({
    data: {
      slug,
      name: data.name,
      source: "stridevote",
      doorsCount: data.doorsCount,
      boundary: data.boundary,
      centroidLat: centroid?.[0] ?? null,
      centroidLng: centroid?.[1] ?? null,
      campaignLinks: {
        create: [
          {
            campaignId,
            programId: program.id,
            visibility: data.visibility,
            assignedUserId:
              data.visibility === "assigned" ? data.assignedUserId : null,
          },
        ],
      },
    },
  });

  if (data.visibility !== "draft") {
    await snapshotListIntoProgram(program.id, list.id);
  }

  if (data.visibility === "assigned" && data.assignedUserId) {
    await checkOutToAssignee(
      list.id,
      program.id,
      data.assignedUserId,
      list.doorsCount,
    );
  }

  revalidateCampaign(campaign.slug);
  return { ok: true, message: `Created ${data.name}`, id: list.id };
}

/** Create one independently named turf for each selected official precinct. */
export async function createPrecinctTurfs(
  campaignId: string,
  input: unknown,
): Promise<AdminResult> {
  const user = await getSessionUser();
  if (!user) return fail("Please sign in.");
  if (!(await can(user, campaignId, "lists:manage"))) return fail("Not allowed.");

  const parsed = precinctTurfBatchSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid precinct selection");
  }
  const data = parsed.data;
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  const districtBoundary = Array.isArray(campaign?.boundary)
    ? (campaign.boundary as [number, number][])
    : null;
  if (!campaign || !districtBoundary?.length) return fail("Campaign district not found.");

  const available = await loadPrecinctsForDistrict(
    districtBoundary,
    campaign.regionState,
    campaignId,
  );
  const byId = new Map(available.map((precinct) => [precinct.id, precinct]));
  const selected = data.precincts.map((ref) =>
    byId.get(`${ref.countyCode}-${ref.code}`),
  );
  if (selected.some((precinct) => !precinct?.selectable)) {
    return fail("One or more selected precincts are unavailable for this campaign.");
  }

  let created = 0;
  const failures: string[] = [];
  for (const precinct of selected) {
    if (!precinct?.countyCode || !precinct.code) continue;
    const result = await createTurf(campaignId, {
      name: precinct.name,
      doorsCount: 0,
      boundary: precinct.boundary,
      visibility: data.visibility,
      assignedUserId: data.assignedUserId,
      programId: data.programId,
      voterSource: data.voterSource,
      savedFilterId: data.savedFilterId,
      precinct: { countyCode: precinct.countyCode, code: precinct.code },
      generateVoters: true,
    });
    if (result.ok) created += 1;
    else failures.push(`${precinct.name}: ${result.message}`);
  }

  if (!created) return fail(failures[0] ?? "No turfs were created.");
  return {
    ok: true,
    message:
      failures.length === 0
        ? `Created ${created} precinct turfs.`
        : `Created ${created} precinct turfs; ${failures.length} failed. ${failures[0]}`,
  };
}

export async function saveVoterFilter(
  campaignId: string,
  input: unknown,
): Promise<AdminResult> {
  const user = await getSessionUser();
  if (!user) return fail("Please sign in.");
  if (
    !(await can(user, campaignId, "voters:view")) &&
    !(await can(user, campaignId, "lists:manage"))
  ) {
    return fail("Not allowed.");
  }

  const parsed = savedFilterSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid filter");
  const filters = sanitizeVoterFilters(parsed.data.filters ?? {});
  const name = parsed.data.name;

  try {
    const row = await prisma.savedVoterFilter.upsert({
      where: { campaignId_name: { campaignId, name } },
      create: {
        campaignId,
        createdById: user.id,
        name,
        filters,
      },
      update: { filters },
    });
    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
    if (campaign) {
      revalidatePath(`/admin/${campaign.slug}/voters`);
      revalidateCampaign(campaign.slug);
    }
    return { ok: true, message: `Saved filter “${name}”`, id: row.id };
  } catch {
    return fail("Could not save filter (duplicate name?).");
  }
}

export async function renameVoterFilter(
  campaignId: string,
  filterId: string,
  nameInput: unknown,
): Promise<AdminResult> {
  const user = await getSessionUser();
  if (!user) return fail("Please sign in.");
  if (
    !(await can(user, campaignId, "voters:view")) &&
    !(await can(user, campaignId, "lists:manage"))
  ) {
    return fail("Not allowed.");
  }

  const name = z.string().trim().min(1).max(80).safeParse(nameInput);
  if (!name.success) return fail("Name is required");

  const existing = await prisma.savedVoterFilter.findFirst({
    where: { id: filterId, campaignId },
  });
  if (!existing) return fail("Filter not found.");

  try {
    await prisma.savedVoterFilter.update({
      where: { id: filterId },
      data: { name: name.data },
    });
  } catch {
    return fail("That name is already used on this campaign.");
  }

  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (campaign) revalidatePath(`/admin/${campaign.slug}/voters`);
  return { ok: true, message: "Filter renamed" };
}

export async function deleteVoterFilter(
  campaignId: string,
  filterId: string,
): Promise<AdminResult> {
  const user = await getSessionUser();
  if (!user) return fail("Please sign in.");
  if (
    !(await can(user, campaignId, "voters:view")) &&
    !(await can(user, campaignId, "lists:manage"))
  ) {
    return fail("Not allowed.");
  }

  const existing = await prisma.savedVoterFilter.findFirst({
    where: { id: filterId, campaignId },
  });
  if (!existing) return fail("Filter not found.");

  await prisma.savedVoterFilter.delete({ where: { id: filterId } });
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (campaign) revalidatePath(`/admin/${campaign.slug}/voters`);
  return { ok: true, message: `Deleted “${existing.name}”` };
}

export async function previewGeneratedList(
  campaignId: string,
  input: unknown,
): Promise<AdminResult & { preview?: Awaited<ReturnType<typeof previewListGeneration>> }> {
  const user = await getSessionUser();
  if (!user) return fail("Please sign in.");
  if (!(await can(user, campaignId, "lists:manage"))) return fail("Not allowed.");

  const parsed = generateListSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");

  try {
    const preview = await previewListGeneration({
      campaignId,
      mode: parsed.data.mode,
      filters: sanitizeVoterFilters(parsed.data.filters ?? {}) as VoterFilters,
      savedFilterId: parsed.data.savedFilterId,
    });
    return {
      ok: true,
      message: `${preview.households} doors / ${preview.expandedVoters} voters from ${preview.seedVoters} matches.`,
      preview,
    };
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Preview failed");
  }
}

export async function generateListFromVoters(
  campaignId: string,
  input: unknown,
): Promise<AdminResult> {
  const user = await getSessionUser();
  if (!user) return fail("Please sign in.");
  if (!(await can(user, campaignId, "lists:manage"))) return fail("Not allowed.");

  const parsed = generateListSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");

  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) return fail("Campaign not found.");

  try {
    const generated = await generateHouseholdList({
      campaignId,
      name: parsed.data.name,
      mode: parsed.data.mode as ListSourceMode,
      filters: sanitizeVoterFilters(parsed.data.filters ?? {}),
      savedFilterId: parsed.data.savedFilterId,
    });
    revalidateCampaign(campaign.slug);
    return {
      ok: true,
      message: `Draft list ready: ${generated.doorsCount} doors, ${generated.voterCount} voters`,
      id: generated.listId,
      slug: generated.slug,
    };
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Could not generate list");
  }
}

export async function setTurfAccess(
  campaignId: string,
  listId: string,
  visibility: unknown,
  assignedUserId?: string | null,
  programId?: string | null,
): Promise<AdminResult> {
  const user = await getSessionUser();
  if (!user) return fail("Please sign in.");
  if (!(await can(user, campaignId, "lists:manage"))) return fail("Not allowed.");

  const parsedVisibility = turfVisibilitySchema.safeParse(visibility);
  if (!parsedVisibility.success) return fail("Choose a valid sharing option.");
  const assignmentError = await validateTurfAssignment(
    campaignId,
    parsedVisibility.data,
    assignedUserId,
  );
  if (assignmentError) return fail(assignmentError);

  const resolvedProgramId =
    programId ?? (await ensureActiveProgram(campaignId)).id;
  const link = await prisma.listCampaign.findUnique({
    where: {
      listId_campaignId_programId: {
        listId,
        campaignId,
        programId: resolvedProgramId,
      },
    },
    include: {
      campaign: true,
      list: {
        include: {
          checkouts: {
            where: { status: "active", programId: resolvedProgramId },
            select: { userId: true },
          },
        },
      },
    },
  });
  if (!link) return fail("Turf not found in this wave.");
  const activeCheckout = link.list.checkouts[0];
  if (
    activeCheckout &&
    (parsedVisibility.data === "draft" ||
      (parsedVisibility.data === "assigned" &&
        assignedUserId !== activeCheckout.userId))
  ) {
    return fail("Release the active checkout before restricting this turf.");
  }

  await prisma.listCampaign.update({
    where: { id: link.id },
    data: {
      visibility: parsedVisibility.data,
      assignedUserId:
        parsedVisibility.data === "assigned" ? assignedUserId : null,
    },
  });

  if (parsedVisibility.data !== "draft") {
    await snapshotListIntoProgram(resolvedProgramId, listId);
  }

  const assigned = parsedVisibility.data === "assigned" && assignedUserId;
  if (assigned) {
    await checkOutToAssignee(
      listId,
      resolvedProgramId,
      assignedUserId,
      link.list.doorsCount,
    );
  }

  revalidateCampaign(link.campaign.slug);
  return {
    ok: true,
    message: assigned
      ? "Turf assigned and checked out"
      : "Turf access updated",
  };
}

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

  const program = await ensureActiveProgram(campaignId);
  const slug = await uniqueSlug(slugify(d.name), async (s) =>
    Boolean(await prisma.list.findUnique({ where: { slug: s } })),
  );

  await prisma.list.create({
    data: {
      slug,
      name: d.name,
      source: d.source,
      sourceRef: d.sourceRef || null,
      doorsCount: d.doorsCount,
      campaignLinks: {
        create: [{ campaignId, programId: program.id }],
      },
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

  const parsed = listUpdateSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const d = parsed.data;

  await prisma.list.update({
    where: { id: listId },
    data: {
      name: d.name,
      sourceRef: d.sourceRef || null,
    },
  });

  revalidatePath("/admin");
  revalidatePath("/canvass");
  return { ok: true, message: "List updated" };
}

export async function deleteList(listId: string): Promise<AdminResult> {
  const user = await getSessionUser();
  if (!user) return fail("Please sign in.");
  if (!(await canManageList(user.id, listId))) return fail("Not allowed.");

  await prisma.list.delete({ where: { id: listId } });
  revalidatePath("/admin");
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

  // Preserve existing program links where possible; recreate against each
  // campaign's active program.
  const existing = await prisma.listCampaign.findMany({
    where: { listId },
    select: {
      campaignId: true,
      programId: true,
      visibility: true,
      assignedUserId: true,
    },
  });
  const byCampaign = new Map(existing.map((row) => [row.campaignId, row]));

  await prisma.listCampaign.deleteMany({ where: { listId } });

  for (const campaignId of campaignIds) {
    const program = await ensureActiveProgram(campaignId);
    const prev = byCampaign.get(campaignId);
    await prisma.listCampaign.create({
      data: {
        listId,
        campaignId,
        programId: program.id,
        visibility: prev?.visibility ?? "volunteers",
        assignedUserId: prev?.assignedUserId ?? null,
      },
    });
    if ((prev?.visibility ?? "volunteers") !== "draft") {
      await snapshotListIntoProgram(program.id, listId);
    }
  }

  revalidatePath("/admin");
  revalidatePath("/canvass");
  return { ok: true, message: "List links updated" };
}

const programSchema = z.object({
  name: z.string().trim().min(1).max(80),
  status: z.enum(["draft", "active", "closed"]),
  script: z.string().max(4000).nullable().optional(),
  questions: z.array(z.unknown()).max(40).optional(),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
});

export async function createProgram(
  campaignId: string,
  input: unknown,
): Promise<AdminResult> {
  const user = await getSessionUser();
  if (!user) return fail("Please sign in.");
  if (!(await can(user, campaignId, "lists:manage"))) return fail("Not allowed.");

  const parsed = programSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid wave");

  const questions = (parsed.data.questions ?? []).flatMap((q) => {
    const result = programQuestionSchema.safeParse(q);
    return result.success ? [result.data] : [];
  });

  try {
    if (parsed.data.status === "active") {
      await prisma.canvassProgram.updateMany({
        where: { campaignId, status: "active" },
        data: { status: "closed" },
      });
    }
    const row = await prisma.canvassProgram.create({
      data: {
        campaignId,
        name: parsed.data.name,
        status: parsed.data.status,
        script: parsed.data.script ?? null,
        questions,
        startsAt: parsed.data.startsAt ? new Date(parsed.data.startsAt) : null,
        endsAt: parsed.data.endsAt ? new Date(parsed.data.endsAt) : null,
      },
    });
    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
    revalidateCampaign(campaign?.slug);
    return { ok: true, message: `Created wave ${row.name}`, id: row.id };
  } catch {
    return fail("Could not create wave (duplicate name?).");
  }
}

export async function updateProgram(
  programId: string,
  input: unknown,
): Promise<AdminResult> {
  const user = await getSessionUser();
  if (!user) return fail("Please sign in.");

  const existing = await prisma.canvassProgram.findUnique({ where: { id: programId } });
  if (!existing) return fail("Wave not found.");
  if (!(await can(user, existing.campaignId, "lists:manage"))) return fail("Not allowed.");

  const parsed = programSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid wave");

  const questions = (parsed.data.questions ?? []).flatMap((q) => {
    const result = programQuestionSchema.safeParse(q);
    return result.success ? [result.data] : [];
  });

  if (parsed.data.status === "active") {
    await prisma.canvassProgram.updateMany({
      where: {
        campaignId: existing.campaignId,
        status: "active",
        id: { not: programId },
      },
      data: { status: "closed" },
    });
  }

  await prisma.canvassProgram.update({
    where: { id: programId },
    data: {
      name: parsed.data.name,
      status: parsed.data.status,
      script: parsed.data.script ?? null,
      questions,
      startsAt: parsed.data.startsAt ? new Date(parsed.data.startsAt) : null,
      endsAt: parsed.data.endsAt ? new Date(parsed.data.endsAt) : null,
    },
  });

  const campaign = await prisma.campaign.findUnique({
    where: { id: existing.campaignId },
  });
  revalidateCampaign(campaign?.slug);
  return { ok: true, message: "Wave updated" };
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
