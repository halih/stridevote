"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { Map } from "@/components/map/Map";
import {
  createCampaign,
  geocodeCampaignRegion,
  updateCampaignProfile,
} from "@/lib/admin-actions";
import { waRegionOptions } from "@/lib/wa-regions";

type RegionType = "state" | "county" | "city" | "legislative" | "congressional";

export interface CampaignFormValues {
  name: string;
  office: string;
  district: string;
  color: string;
  tags: string;
  volunteers: string;
  regionType: RegionType;
  regionName: string;
  regionState: string;
  centroidLat: string;
  centroidLng: string;
  pickupType: "" | "locker" | "address";
  pickupLabel: string;
  pickupDetail: string;
  contactName: string;
  contactRole: string;
  contactPhone: string;
  contactEmail: string;
}

const EMPTY: CampaignFormValues = {
  name: "",
  office: "",
  district: "",
  color: "#185FA5",
  tags: "",
  volunteers: "0",
  regionType: "state",
  regionName: "",
  regionState: "WA",
  centroidLat: "",
  centroidLng: "",
  pickupType: "",
  pickupLabel: "",
  pickupDetail: "",
  contactName: "",
  contactRole: "",
  contactPhone: "",
  contactEmail: "",
};

const REGION_LABELS: { id: RegionType; label: string; nameLabel: string; placeholder: string }[] = [
  { id: "state", label: "State", nameLabel: "State", placeholder: "WA" },
  { id: "county", label: "County", nameLabel: "County", placeholder: "King" },
  { id: "city", label: "City", nameLabel: "City name", placeholder: "Shoreline" },
  { id: "legislative", label: "Legislative district", nameLabel: "District", placeholder: "32" },
  { id: "congressional", label: "Congressional district", nameLabel: "District", placeholder: "7" },
];

function numOrNull(v: string): number | null {
  if (!v.trim()) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toInput(v: CampaignFormValues, boundary: [number, number][] | null) {
  return {
    name: v.name.trim(),
    office: v.office.trim(),
    district: v.district.trim(),
    color: v.color || "#185FA5",
    tags: v.tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
    volunteers: Number(v.volunteers) || 0,
    regionType: v.regionType,
    regionName:
      v.regionType === "state"
        ? v.regionState.trim() || "WA"
        : v.regionName.trim() || null,
    regionState: v.regionState.trim() || null,
    boundary,
    centroidLat: numOrNull(v.centroidLat),
    centroidLng: numOrNull(v.centroidLng),
    pickupType: v.pickupType || null,
    pickupLabel: v.pickupLabel.trim() || null,
    pickupDetail: v.pickupDetail.trim() || null,
    contactName: v.contactName.trim() || undefined,
    contactRole: v.contactRole.trim() || undefined,
    contactPhone: v.contactPhone.trim() || undefined,
    contactEmail: v.contactEmail.trim() || undefined,
  };
}

export function CampaignForm({
  mode,
  campaignId,
  initial,
  initialBoundary = null,
}: {
  mode: "create" | "edit";
  campaignId?: string;
  initial?: Partial<CampaignFormValues>;
  initialBoundary?: [number, number][] | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [resolving, setResolving] = useState(false);
  const [v, setV] = useState<CampaignFormValues>({ ...EMPTY, ...initial });
  const [boundary, setBoundary] = useState<[number, number][] | null>(initialBoundary);
  const [regionNote, setRegionNote] = useState<string | null>(null);

  function set<K extends keyof CampaignFormValues>(key: K, value: CampaignFormValues[K]) {
    setV((prev) => ({ ...prev, [key]: value }));
  }

  const activeRegion = REGION_LABELS.find((r) => r.id === v.regionType);
  const hasCenter = numOrNull(v.centroidLat) != null && numOrNull(v.centroidLng) != null;
  const isWa = (v.regionState || "WA").trim().toUpperCase() === "WA";
  const regionOptions =
    isWa && v.regionType ? waRegionOptions(v.regionType) : null;

  // Normalize stored names so edit mode matches dropdown values ("King County" → "King", "LD 32" → "32").
  const regionSelectValue = (() => {
    const raw = v.regionName.trim();
    if (!raw || !v.regionType) return raw;
    if (v.regionType === "county") return raw.replace(/\s+County$/i, "");
    if (v.regionType === "legislative" || v.regionType === "congressional") {
      const m = raw.match(/(\d{1,3})/);
      return m ? String(Number(m[1])) : raw;
    }
    return raw;
  })();

  function resolveRegion() {
    const name = v.regionType === "state" ? v.regionState || "WA" : v.regionName;
    if (v.regionType !== "state" && !name.trim()) {
      toast("Select a region first.");
      return;
    }
    setResolving(true);
    void (async () => {
      try {
        const res = await geocodeCampaignRegion({
          regionType: v.regionType,
          regionName: name.trim() || v.regionState || "WA",
          regionState: v.regionState || "WA",
        });
        if (res.ok && res.centroidLat != null && res.centroidLng != null) {
          setBoundary(res.boundary ?? null);
          setV((prev) => ({
            ...prev,
            centroidLat: String(res.centroidLat),
            centroidLng: String(res.centroidLng),
            regionName: prev.regionType === "state" ? prev.regionState || "WA" : prev.regionName,
          }));
          setRegionNote(res.label ?? null);
        }
        toast(res.message);
      } finally {
        setResolving(false);
      }
    })();
  }

  function submit() {
    startTransition(async () => {
      const input = toInput(v, boundary);
      const res =
        mode === "create"
          ? await createCampaign(input)
          : await updateCampaignProfile(campaignId!, input);
      toast(res.message);
      if (res.ok) {
        if (mode === "create" && res.slug) router.push(`/admin/${res.slug}`);
        else router.refresh();
      }
    });
  }

  return (
    <div className="form">
      <div className="form-field">
        <label className="field-label">Campaign name</label>
        <input className="field" value={v.name} onChange={(e) => set("name", e.target.value)} />
      </div>
      <div className="form-two">
        <div className="form-field">
          <label className="field-label">Office</label>
          <input className="field" value={v.office} onChange={(e) => set("office", e.target.value)} />
        </div>
        <div className="form-field">
          <label className="field-label">District label</label>
          <input
            className="field"
            value={v.district}
            placeholder="LD 32"
            onChange={(e) => set("district", e.target.value)}
          />
        </div>
      </div>
      <div className="form-field">
        <label className="field-label">Tags</label>
        <input
          className="field"
          value={v.tags}
          placeholder="housing, climate, transit"
          onChange={(e) => set("tags", e.target.value)}
        />
        <p className="field-hint">Comma-separated values used for discovery matching.</p>
      </div>

      <hr className="form-divider" />
      <div className="eyebrow">Geographic region</div>
      <p className="field-hint" style={{ marginTop: 4, marginBottom: 10 }}>
        Pick where this campaign operates. We resolve it to a real map boundary (Washington for now).
      </p>
      <div className="form-two">
        <div className="form-field">
          <label className="field-label">Region type</label>
          <select
            className="field"
            value={v.regionType}
            onChange={(e) => {
              set("regionType", e.target.value as RegionType);
              set("regionName", "");
              setBoundary(null);
              setRegionNote(null);
            }}
          >
            {REGION_LABELS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <div className="form-field">
          <label className="field-label">US state</label>
          <input
            className="field"
            value={v.regionState}
            onChange={(e) => set("regionState", e.target.value)}
          />
        </div>
      </div>
      {activeRegion && activeRegion.id !== "state" ? (
        <div className="form-field">
          <label className="field-label">{activeRegion.nameLabel}</label>
          {regionOptions ? (
            <select
              className="field"
              value={regionSelectValue}
              onChange={(e) => {
                set("regionName", e.target.value);
                setBoundary(null);
                setRegionNote(null);
              }}
            >
              <option value="">Select…</option>
              {regionOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              className="field"
              value={v.regionName}
              placeholder={activeRegion.placeholder}
              onChange={(e) => set("regionName", e.target.value)}
            />
          )}
        </div>
      ) : null}
      <button
        type="button"
        className="btn btn-outline btn-block btn-sm"
        disabled={resolving}
        onClick={resolveRegion}
      >
        {resolving
          ? "Resolving…"
          : v.regionType === "state"
            ? "Show state on map"
            : "Resolve region on map"}
      </button>

      {boundary && boundary.length >= 3 ? (
        <div style={{ marginTop: 12 }}>
          <Map
            polygons={[{ points: boundary, color: v.color, fillOpacity: 0.16 }]}
            caption={regionNote ?? "Resolved region boundary"}
          />
        </div>
      ) : hasCenter ? (
        <div style={{ marginTop: 12 }}>
          <Map
            home={{ lat: Number(v.centroidLat), lng: Number(v.centroidLng) }}
            caption={regionNote ?? "Region center (no boundary outline available)"}
          />
        </div>
      ) : null}

      <details style={{ marginTop: 10 }}>
        <summary className="field-hint" style={{ cursor: "pointer" }}>
          Advanced: set center coordinates manually
        </summary>
        <div className="form-two" style={{ marginTop: 10 }}>
          <div className="form-field">
            <label className="field-label">Center latitude</label>
            <input
              className="field"
              value={v.centroidLat}
              placeholder="47.72"
              onChange={(e) => set("centroidLat", e.target.value)}
            />
          </div>
          <div className="form-field">
            <label className="field-label">Center longitude</label>
            <input
              className="field"
              value={v.centroidLng}
              placeholder="-122.34"
              onChange={(e) => set("centroidLng", e.target.value)}
            />
          </div>
        </div>
      </details>

      <hr className="form-divider" />
      <div className="form-field">
        <label className="field-label">List pickup</label>
        <select
          className="field"
          value={v.pickupType}
          onChange={(e) => set("pickupType", e.target.value as CampaignFormValues["pickupType"])}
        >
          <option value="">None</option>
          <option value="locker">Locker</option>
          <option value="address">Address</option>
        </select>
      </div>
      {v.pickupType ? (
        <div className="form-two">
          <div className="form-field">
            <label className="field-label">Pickup label</label>
            <input
              className="field"
              value={v.pickupLabel}
              onChange={(e) => set("pickupLabel", e.target.value)}
            />
          </div>
          <div className="form-field">
            <label className="field-label">Pickup detail</label>
            <input
              className="field"
              value={v.pickupDetail}
              onChange={(e) => set("pickupDetail", e.target.value)}
            />
          </div>
        </div>
      ) : null}

      <hr className="form-divider" />
      <div className="form-two">
        <div className="form-field">
          <label className="field-label">Contact name</label>
          <input
            className="field"
            value={v.contactName}
            onChange={(e) => set("contactName", e.target.value)}
          />
        </div>
        <div className="form-field">
          <label className="field-label">Contact role</label>
          <input
            className="field"
            value={v.contactRole}
            onChange={(e) => set("contactRole", e.target.value)}
          />
        </div>
      </div>
      <div className="form-two">
        <div className="form-field">
          <label className="field-label">Contact phone</label>
          <input
            className="field"
            value={v.contactPhone}
            onChange={(e) => set("contactPhone", e.target.value)}
          />
        </div>
        <div className="form-field">
          <label className="field-label">Contact email</label>
          <input
            className="field"
            value={v.contactEmail}
            onChange={(e) => set("contactEmail", e.target.value)}
          />
        </div>
      </div>
      <p className="field-hint">Both name and role are required to save a contact.</p>

      <div className="form-actions">
        <button className="btn btn-primary btn-block" disabled={pending} onClick={submit}>
          {mode === "create" ? "Create campaign" : "Save changes"}
        </button>
      </div>
    </div>
  );
}
