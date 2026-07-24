import { PrismaClient } from "../src/generated/prisma";

const prisma = new PrismaClient();

// ---- Geometry helpers (illustrative outlines, not official GIS) ----
type LatLng = [number, number];

function centroid(points: LatLng[]): { lat: number; lng: number } {
  const n = points.length || 1;
  const sum = points.reduce((a, p) => [a[0] + p[0], a[1] + p[1]] as LatLng, [0, 0] as LatLng);
  return { lat: sum[0] / n, lng: sum[1] / n };
}

const BLOB_SHAPES: LatLng[][] = [
  [[0.9, -0.7], [1.1, 0.5], [0.3, 1.1], [-0.7, 1.0], [-1.1, -0.1], [-0.6, -1.0], [0.3, -1.1]],
  [[1.0, -0.9], [0.7, 0.8], [-0.2, 1.1], [-1.0, 0.5], [-1.1, -0.5], [-0.3, -1.1], [0.6, -1.0]],
  [[0.8, -1.0], [1.1, 0.2], [0.5, 1.0], [-0.5, 1.1], [-1.1, 0.1], [-0.8, -0.9], [0.2, -1.1]],
];

function blobAround(
  center: { lat: number; lng: number },
  latR: number,
  lngR: number,
  shapeIdx: number,
): LatLng[] {
  return BLOB_SHAPES[shapeIdx % BLOB_SHAPES.length].map(
    ([dLat, dLng]) => [center.lat + dLat * latR, center.lng + dLng * lngR] as LatLng,
  );
}

// ---- Source data (ported from the prototype) ----
const DEMO = {
  email: "demo@stridevote.local",
  name: "Hammad",
  initials: "HH",
  area: "Shoreline / Broadview, WA",
  homeLat: 47.7345,
  homeLng: -122.3455,
};

const CAMPAIGNS = [
  {
    slug: "imraan",
    name: "Imraan Siddiqui",
    office: "State Representative",
    district: "LD 32",
    tags: ["Housing Affordability", "Immigrant Rights", "Transit"],
    color: "#185FA5",
    volunteers: 26,
    membership: { status: "active", joinedAt: new Date("2026-03-02") },
    boundary: [
      [47.76, -122.36], [47.76, -122.322], [47.744, -122.316], [47.716, -122.32],
      [47.706, -122.338], [47.71, -122.358], [47.728, -122.366], [47.75, -122.365],
    ] as LatLng[],
    contact: { name: "Maya Lin", role: "Field Organizer", phone: "206-555-0134", email: "volunteer@imraan4statehouse.org" },
    pickup: { type: "locker", label: "Meridian Park Library Locker", detail: "Locker #2 · Code 2258" },
    filler: null,
  },
  {
    slug: "nilu",
    name: "Nilu Jenks",
    office: "Shoreline City Council",
    district: "Pos. 3",
    tags: ["Housing Affordability", "Climate Action", "Transit"],
    color: "#2e9e5b",
    volunteers: 12,
    membership: { status: "active", joinedAt: new Date("2026-04-14") },
    boundary: [
      [47.757, -122.353], [47.757, -122.333], [47.745, -122.328], [47.737, -122.339],
      [47.741, -122.352], [47.748, -122.357],
    ] as LatLng[],
    contact: { name: "Derek Osei", role: "Volunteer Coordinator", phone: "206-555-0187", email: "team@nilujenks.com" },
    pickup: { type: "address", label: "Nilu Jenks Campaign HQ", detail: "1st Ave NE & N 175th St — front desk, 9am–7pm" },
    filler: null,
  },
  {
    slug: "delrosario",
    name: "Ana Del Rosario",
    office: "Shoreline School Board",
    district: "Dir. 2",
    tags: ["Public Education", "Immigrant Rights"],
    color: "#8a8f98",
    volunteers: 9,
    membership: { status: "pending", requestedAt: new Date("2026-07-09") },
    boundary: [
      [47.751, -122.363], [47.753, -122.345], [47.745, -122.341], [47.74, -122.352], [47.744, -122.362],
    ] as LatLng[],
    contact: { name: "Priti Shah", role: "Field Organizer", phone: "206-555-0142", email: "volunteer@anadelrosario.org" },
    pickup: { type: "locker", label: "Shoreline Library Locker", detail: "Locker #7 · Code 7734" },
    filler: { total: 4, available: 2, doorsRemaining: 210 },
  },
  {
    slug: "cindyryu",
    name: "Cindy Ryu",
    office: "State Representative",
    district: "LD 32",
    tags: ["Immigrant Rights", "Oppose Data Centers", "Healthcare Access"],
    color: "#c97a2e",
    volunteers: 22,
    membership: null,
    boundary: [
      [47.76, -122.36], [47.76, -122.322], [47.744, -122.316], [47.716, -122.32],
      [47.706, -122.338], [47.71, -122.358], [47.728, -122.366], [47.75, -122.365],
    ] as LatLng[],
    contact: { name: "Grace Tam", role: "Field Director", phone: "206-555-0199", email: "field@cindyryu.org" },
    pickup: { type: "address", label: "Cindy Ryu Campaign HQ", detail: "N 185th St — ask for Grace" },
    filler: { total: 9, available: 5, doorsRemaining: 640 },
  },
  {
    slug: "ortega",
    name: "Javier Ortega",
    office: "King County Council",
    district: "District 4",
    tags: ["Housing Affordability", "Public Safety"],
    color: "#8a5cf6",
    volunteers: 31,
    membership: null,
    boundary: [
      [47.726, -122.33], [47.727, -122.304], [47.706, -122.298], [47.694, -122.317],
      [47.705, -122.336], [47.718, -122.337],
    ] as LatLng[],
    contact: { name: "Ben Alvarez", role: "Volunteer Coordinator", phone: "206-555-0221", email: "volunteer@ortegaforcouncil.org" },
    pickup: { type: "locker", label: "Burien Community Center Locker", detail: "Locker #3 · Code 3391" },
    filler: { total: 12, available: 7, doorsRemaining: 980 },
  },
  {
    slug: "woods",
    name: "Mark Woods",
    office: "State Senate",
    district: "LD 1",
    tags: ["Climate Action", "Oppose Data Centers"],
    color: "#5b6067",
    volunteers: 44,
    membership: null,
    boundary: [
      [47.763, -122.341], [47.777, -122.309], [47.76, -122.293], [47.739, -122.299],
      [47.734, -122.321], [47.748, -122.336],
    ] as LatLng[],
    contact: { name: "Julia Ferris", role: "Field Organizer", phone: "206-555-0256", email: "info@markwoodsforsenate.org" },
    pickup: { type: "address", label: "Woods for Senate HQ", detail: "Aurora Ave N — loading dock B" },
    filler: { total: 15, available: 10, doorsRemaining: 1450 },
  },
] as const;

const LIST_CENTERS: Record<string, { lat: number; lng: number }> = {
  meridian: { lat: 47.7205, lng: -122.3518 },
  "broadview-n": { lat: 47.7438, lng: -122.3482 },
  "broadview-s": { lat: 47.7298, lng: -122.3468 },
  "shoreline-ridge": { lat: 47.7528, lng: -122.3332 },
  "innis-arden": { lat: 47.7478, lng: -122.3592 },
};

const LISTS = [
  {
    slug: "meridian", name: "Meridian Park", neighborhood: "Meridian Park, Seattle",
    campaigns: ["imraan"], distanceMi: 0.7, doors: 40, source: "minivan", sourceRef: "MV-32-0140",
    shape: 0, latR: 0.0075, lngR: 0.011,
    checkout: { by: "demo", progressDone: 18 },
  },
  {
    slug: "broadview-n", name: "Broadview North", neighborhood: "Broadview, Seattle",
    campaigns: ["imraan", "nilu"], distanceMi: 0.4, doors: 48, source: "civibyte",
    sourceRef: "https://civibyte.app/l/broadview-north", shape: 1, latR: 0.0075, lngR: 0.0115,
    checkout: null,
  },
  {
    slug: "broadview-s", name: "Broadview South", neighborhood: "Broadview, Seattle",
    campaigns: ["imraan"], distanceMi: 0.9, doors: 36, source: "minivan", sourceRef: "MV-32-0141",
    shape: 2, latR: 0.006, lngR: 0.0095,
    checkout: { by: "priya", progressDone: 12 },
  },
  {
    slug: "shoreline-ridge", name: "Shoreline Ridge", neighborhood: "Shoreline",
    campaigns: ["nilu"], distanceMi: 2.3, doors: 52, source: "civibyte",
    sourceRef: "https://civibyte.app/l/shoreline-ridge", shape: 0, latR: 0.008, lngR: 0.012,
    checkout: null,
  },
  {
    slug: "innis-arden", name: "Innis Arden", neighborhood: "Shoreline",
    campaigns: ["nilu"], distanceMi: 3.0, doors: 30, source: "minivan", sourceRef: "MV-32-0139",
    shape: 1, latR: 0.0065, lngR: 0.01,
    checkout: { by: "tom", progressDone: 8 },
  },
] as const;

async function main() {
  console.log("Resetting StrideVote seed data…");
  await prisma.listWatch.deleteMany();
  await prisma.listCheckout.deleteMany();
  await prisma.listCampaign.deleteMany();
  await prisma.list.deleteMany();
  await prisma.campaignMembership.deleteMany();
  await prisma.campaignContact.deleteMany();
  await prisma.campaign.deleteMany();
  await prisma.otpChallenge.deleteMany();
  await prisma.user.deleteMany();

  const demo = await prisma.user.create({
    data: {
      email: DEMO.email,
      name: DEMO.name,
      initials: DEMO.initials,
      area: DEMO.area,
      homeLat: DEMO.homeLat,
      homeLng: DEMO.homeLng,
      emailVerified: new Date(),
    },
  });

  const priya = await prisma.user.create({ data: { name: "Priya N.", initials: "PN" } });
  const tom = await prisma.user.create({ data: { name: "Tom R.", initials: "TR" } });
  const stubForFiller = await prisma.user.create({ data: { name: "Sam K.", initials: "SK" } });
  const owners: Record<string, string> = { demo: demo.id, priya: priya.id, tom: tom.id };

  const campaignIdBySlug: Record<string, string> = {};

  for (const c of CAMPAIGNS) {
    const cen = centroid(c.boundary);
    const created = await prisma.campaign.create({
      data: {
        slug: c.slug,
        name: c.name,
        office: c.office,
        district: c.district,
        tags: [...c.tags],
        color: c.color,
        volunteers: c.volunteers,
        centroidLat: cen.lat,
        centroidLng: cen.lng,
        boundary: c.boundary as unknown as object,
        pickupType: c.pickup.type,
        pickupLabel: c.pickup.label,
        pickupDetail: c.pickup.detail,
        contacts: { create: [c.contact] },
      },
    });
    campaignIdBySlug[c.slug] = created.id;

    if (c.membership) {
      await prisma.campaignMembership.create({
        data: {
          userId: demo.id,
          campaignId: created.id,
          status: c.membership.status,
          joinedAt: "joinedAt" in c.membership ? c.membership.joinedAt : null,
          requestedAt: "requestedAt" in c.membership ? c.membership.requestedAt : null,
        },
      });
    }
  }

  // Real, mapped lists for the demo user's active campaigns.
  for (const l of LISTS) {
    const center = LIST_CENTERS[l.slug];
    const boundary = blobAround(center, l.latR, l.lngR, l.shape);
    const created = await prisma.list.create({
      data: {
        slug: l.slug,
        name: l.name,
        neighborhood: l.neighborhood,
        source: l.source,
        sourceRef: l.sourceRef,
        doorsCount: l.doors,
        distanceMi: l.distanceMi,
        centroidLat: center.lat,
        centroidLng: center.lng,
        boundary: boundary as unknown as object,
        data: { center, ...(l.source === "minivan" ? { listNumber: l.sourceRef } : { url: l.sourceRef }) },
        campaignLinks: {
          create: l.campaigns.map((slug) => ({ campaignId: campaignIdBySlug[slug] })),
        },
      },
    });

    if (l.checkout) {
      await prisma.listCheckout.create({
        data: {
          listId: created.id,
          userId: owners[l.checkout.by],
          status: "active",
          progressDone: l.checkout.progressDone,
          progressTotal: l.doors,
        },
      });
    }
  }

  // Filler lists so discover/pending campaigns show plausible list + door counts.
  for (const c of CAMPAIGNS) {
    if (!c.filler) continue;
    const { total, available, doorsRemaining } = c.filler;
    const perAvailable = Math.max(1, Math.round(doorsRemaining / available));
    for (let i = 0; i < total; i++) {
      const isAvailable = i < available;
      const doors = isAvailable ? perAvailable : 40;
      const list = await prisma.list.create({
        data: {
          slug: `${c.slug}-turf-${i + 1}`,
          name: `${c.name.split(" ")[0]} Turf ${i + 1}`,
          neighborhood: c.district,
          source: i % 2 === 0 ? "minivan" : "civibyte",
          sourceRef: i % 2 === 0 ? `MV-${c.slug}-${i}` : `https://civibyte.app/l/${c.slug}-${i}`,
          doorsCount: doors,
          campaignLinks: { create: [{ campaignId: campaignIdBySlug[c.slug] }] },
        },
      });
      if (!isAvailable) {
        // Mark as fully worked so it doesn't inflate "doors remaining".
        await prisma.listCheckout.create({
          data: {
            listId: list.id,
            userId: stubForFiller.id,
            status: "active",
            progressDone: doors,
            progressTotal: doors,
          },
        });
      }
    }
  }

  console.log(`Seeded ${CAMPAIGNS.length} campaigns and demo user ${DEMO.email}.`);
  console.log("Sign in (dev) with that email — the magic link prints on the login screen.");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
