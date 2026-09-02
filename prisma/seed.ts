import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "../src/generated/prisma";

const prisma = new PrismaClient();

type LatLng = [number, number];

const BLOB_SHAPES: LatLng[][] = [
  [[0.9, -0.7], [1.1, 0.5], [0.3, 1.1], [-0.7, 1.0], [-1.1, -0.1], [-0.6, -1.0], [0.3, -1.1]],
  [[1.0, -0.9], [0.7, 0.8], [-0.2, 1.1], [-1.0, 0.5], [-1.1, -0.5], [-0.3, -1.1], [0.6, -1.0]],
  [[0.8, -1.0], [1.1, 0.2], [0.5, 1.0], [-0.5, 1.1], [-1.1, 0.1], [-0.8, -0.9], [0.2, -1.1]],
];

function ringToLatLng(ring: number[][]): LatLng[] {
  return ring.map(([lng, lat]) => [lat, lng] as LatLng);
}

function geojsonOuterRing(geometry: { type: string; coordinates: unknown }): LatLng[] | null {
  let rings: number[][][] = [];
  if (geometry.type === "Polygon") rings = geometry.coordinates as number[][][];
  else if (geometry.type === "MultiPolygon") {
    rings = (geometry.coordinates as number[][][][]).map((poly) => poly[0]);
  } else return null;
  const outer = rings.filter((r) => r?.length >= 3).sort((a, b) => b.length - a.length)[0];
  return outer ? ringToLatLng(outer) : null;
}

async function resolveWaLd32(): Promise<{
  label: string;
  centroidLat: number;
  centroidLng: number;
  boundary: LatLng[];
}> {
  const url = new URL(
    "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/1/query",
  );
  url.searchParams.set("where", "STATE='53' AND SLDU='032'");
  url.searchParams.set("outFields", "NAME,STATE,SLDU,INTPTLAT,INTPTLON");
  url.searchParams.set("returnGeometry", "true");
  url.searchParams.set("outSR", "4326");
  url.searchParams.set("maxAllowableOffset", "0.00003");
  url.searchParams.set("geometryPrecision", "6");
  url.searchParams.set("f", "geojson");

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "StrideVote/1.0 (dev seed)" },
      signal: AbortSignal.timeout(20000),
    });
    if (res.ok) {
      const data = (await res.json()) as {
        features?: Array<{
          properties?: { NAME?: string; INTPTLAT?: string; INTPTLON?: string };
          geometry: { type: string; coordinates: unknown };
        }>;
      };
      const feature = data.features?.[0];
      const boundary = feature ? geojsonOuterRing(feature.geometry) : null;
      if (boundary?.length) {
        const lat = Number(feature?.properties?.INTPTLAT);
        const lng = Number(feature?.properties?.INTPTLON);
        return {
          label: feature?.properties?.NAME || "Washington Legislative District 32",
          centroidLat: Number.isFinite(lat) ? lat : boundary.reduce((s, p) => s + p[0], 0) / boundary.length,
          centroidLng: Number.isFinite(lng) ? lng : boundary.reduce((s, p) => s + p[1], 0) / boundary.length,
          boundary,
        };
      }
    }
  } catch {
    console.warn("Census TIGER lookup failed; using bundled WA SLDU geometry.");
  }

  const bundled = JSON.parse(
    readFileSync(join(process.cwd(), "src/data/wa-sldu.json"), "utf8"),
  ) as {
    features: Array<{
      properties: { SLDU?: string; NAME?: string };
      geometry: { type: string; coordinates: unknown };
    }>;
  };
  const feature = bundled.features.find(
    (f) => String(f.properties.SLDU).replace(/^0+/, "") === "32",
  );
  const boundary = feature ? geojsonOuterRing(feature.geometry) : null;
  if (!boundary?.length) {
    throw new Error("Could not resolve WA LD 32 boundary.");
  }
  return {
    label: feature?.properties.NAME || "Washington Legislative District 32",
    centroidLat: boundary.reduce((s, p) => s + p[0], 0) / boundary.length,
    centroidLng: boundary.reduce((s, p) => s + p[1], 0) / boundary.length,
    boundary,
  };
}

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

const DEMO = {
  email: "demo@stridevote.local",
  name: "Hammad",
  initials: "HH",
  area: "Shoreline / Broadview, WA",
  homeLat: 47.7345,
  homeLng: -122.3455,
};

const SUPER_ADMIN_EMAIL = "halih@hotmail.com";

const LISTS = [
  {
    slug: "meridian",
    name: "Meridian Park",
    neighborhood: "Meridian Park, Seattle",
    distanceMi: 0.7,
    doors: 40,
    source: "minivan" as const,
    sourceRef: "MV-32-0140",
    shape: 0,
    latR: 0.0075,
    lngR: 0.011,
    center: { lat: 47.7205, lng: -122.3518 },
    checkout: { by: "demo", progressDone: 18 },
  },
  {
    slug: "broadview-n",
    name: "Broadview North",
    neighborhood: "Broadview, Seattle",
    distanceMi: 0.4,
    doors: 48,
    source: "civibyte" as const,
    sourceRef: "https://civibyte.app/l/broadview-north",
    shape: 1,
    latR: 0.0075,
    lngR: 0.0115,
    center: { lat: 47.7438, lng: -122.3482 },
    checkout: null,
  },
  {
    slug: "broadview-s",
    name: "Broadview South",
    neighborhood: "Broadview, Seattle",
    distanceMi: 0.9,
    doors: 36,
    source: "minivan" as const,
    sourceRef: "MV-32-0141",
    shape: 2,
    latR: 0.006,
    lngR: 0.0095,
    center: { lat: 47.7298, lng: -122.3468 },
    checkout: { by: "priya", progressDone: 12 },
  },
];

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_PROD_SEED !== "1") {
    console.error(
      "Refusing to seed: NODE_ENV=production. This resets all data and adds dev-only\n" +
        "fixtures. Set ALLOW_PROD_SEED=1 only if you truly intend to wipe + seed prod.",
    );
    process.exit(1);
  }

  console.log("Resolving WA 32nd Legislative District boundary…");
  const region = await resolveWaLd32();
  console.log(
    `  ${region.label}: ${region.boundary.length} vertices, centroid ${region.centroidLat.toFixed(4)}, ${region.centroidLng.toFixed(4)}`,
  );

  console.log("Resetting StrideVote seed data…");
  await prisma.listWatch.deleteMany();
  await prisma.listCheckout.deleteMany();
  await prisma.listCampaign.deleteMany();
  await prisma.list.deleteMany();
  await prisma.campaignVoter.deleteMany();
  // Keep imported VRDB rows; they are re-linked to the demo campaign below.
  await prisma.campaignMembership.deleteMany();
  await prisma.campaignContact.deleteMany();
  await prisma.campaign.deleteMany();
  await prisma.otpChallenge.deleteMany();
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.verificationToken.deleteMany();
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

  await prisma.user.create({
    data: {
      email: SUPER_ADMIN_EMAIL,
      name: "Halih",
      initials: "HA",
      emailVerified: new Date(),
      isPlatformAdmin: true,
    },
  });

  const priya = await prisma.user.create({ data: { name: "Priya N.", initials: "PN" } });
  const tom = await prisma.user.create({ data: { name: "Tom R.", initials: "TR" } });
  const owners: Record<string, string> = { demo: demo.id, priya: priya.id, tom: tom.id };

  const campaign = await prisma.campaign.create({
    data: {
      slug: "count-binface",
      name: "Count Binface for LD32",
      office: "State Representative",
      district: "32nd Legislative District",
      tags: ["Housing Affordability", "Immigrant Rights", "Transit"],
      color: "#185FA5",
      volunteers: 8,
      regionType: "legislative",
      regionName: "32",
      regionState: "WA",
      centroidLat: region.centroidLat,
      centroidLng: region.centroidLng,
      boundary: region.boundary as unknown as object,
      pickupType: "locker",
      pickupLabel: "Meridian Park Library Locker",
      pickupDetail: "Locker #2 · Code 2258",
      contacts: {
        create: [
          {
            name: "Maya Lin",
            role: "Field Organizer",
            phone: "206-555-0134",
            email: "volunteer@demo.stridevote.local",
          },
        ],
      },
    },
  });

  await prisma.campaignMembership.create({
    data: {
      userId: demo.id,
      campaignId: campaign.id,
      status: "active",
      roles: ["admin", "canvasser"],
      joinedAt: new Date("2026-03-02"),
    },
  });

  await prisma.campaignMembership.createMany({
    data: [
      {
        userId: priya.id,
        campaignId: campaign.id,
        status: "pending",
        roles: ["canvasser"],
        requestedAt: new Date("2026-07-20"),
      },
      {
        userId: tom.id,
        campaignId: campaign.id,
        status: "pending",
        roles: ["canvasser"],
        requestedAt: new Date("2026-07-22"),
      },
    ],
  });

  for (const list of LISTS) {
    const boundary = blobAround(list.center, list.latR, list.lngR, list.shape);
    const created = await prisma.list.create({
      data: {
        slug: list.slug,
        name: list.name,
        neighborhood: list.neighborhood,
        source: list.source,
        sourceRef: list.sourceRef,
        doorsCount: list.doors,
        distanceMi: list.distanceMi,
        centroidLat: list.center.lat,
        centroidLng: list.center.lng,
        boundary: boundary as unknown as object,
        data: {
          center: list.center,
          ...(list.source === "minivan" ? { listNumber: list.sourceRef } : { url: list.sourceRef }),
        },
        campaignLinks: { create: [{ campaignId: campaign.id }] },
      },
    });

    if (list.checkout) {
      await prisma.listCheckout.create({
        data: {
          listId: created.id,
          userId: owners[list.checkout.by],
          status: "active",
          progressDone: list.checkout.progressDone,
          progressTotal: list.doors,
        },
      });
    }
  }

  const regionNameKey = (campaign.regionName ?? "32").replace(/^0+/, "") || "32";
  const linkedVoters = await prisma.$executeRaw`
    INSERT INTO "CampaignVoter" (id, "campaignId", "voterId", "createdAt")
    SELECT gen_random_uuid()::text, ${campaign.id}, v.id, CURRENT_TIMESTAMP
    FROM "Voter" v
    WHERE regexp_replace(COALESCE(v."legislativeDistrict", ''), '^0+', '') = ${regionNameKey}
    ON CONFLICT ("campaignId", "voterId") DO NOTHING
  `;
  if (Number(linkedVoters) > 0) {
    console.log(`Re-linked ${Number(linkedVoters).toLocaleString()} imported LD32 voters.`);
  }

  console.log(`Seeded 1 campaign: ${campaign.name} (${campaign.district}).`);
  console.log(`Platform super-admin: ${SUPER_ADMIN_EMAIL}`);
  console.log(`Demo canvasser / campaign admin: ${DEMO.email}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
