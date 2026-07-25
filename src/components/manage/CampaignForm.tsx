"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { createCampaign, updateCampaignProfile } from "@/lib/admin-actions";

export interface CampaignFormValues {
  name: string;
  office: string;
  district: string;
  color: string;
  tags: string;
  volunteers: string;
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

function numOrNull(v: string): number | null {
  if (!v.trim()) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toInput(v: CampaignFormValues) {
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
}: {
  mode: "create" | "edit";
  campaignId?: string;
  initial?: Partial<CampaignFormValues>;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [v, setV] = useState<CampaignFormValues>({ ...EMPTY, ...initial });

  function set<K extends keyof CampaignFormValues>(key: K, value: CampaignFormValues[K]) {
    setV((prev) => ({ ...prev, [key]: value }));
  }

  function submit() {
    startTransition(async () => {
      const input = toInput(v);
      const res =
        mode === "create"
          ? await createCampaign(input)
          : await updateCampaignProfile(campaignId!, input);
      toast(res.message);
      if (res.ok) {
        if (mode === "create" && res.slug) router.push(`/manage/${res.slug}`);
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
          <label className="field-label">District</label>
          <input
            className="field"
            value={v.district}
            onChange={(e) => set("district", e.target.value)}
          />
        </div>
      </div>
      <div className="form-two">
        <div className="form-field">
          <label className="field-label">Accent color</label>
          <input
            className="field"
            type="color"
            value={v.color}
            onChange={(e) => set("color", e.target.value)}
          />
        </div>
        <div className="form-field">
          <label className="field-label">Volunteers</label>
          <input
            className="field"
            type="number"
            min={0}
            value={v.volunteers}
            onChange={(e) => set("volunteers", e.target.value)}
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
      <div className="form-two">
        <div className="form-field">
          <label className="field-label">Center latitude</label>
          <input
            className="field"
            value={v.centroidLat}
            placeholder="40.68"
            onChange={(e) => set("centroidLat", e.target.value)}
          />
        </div>
        <div className="form-field">
          <label className="field-label">Center longitude</label>
          <input
            className="field"
            value={v.centroidLng}
            placeholder="-73.97"
            onChange={(e) => set("centroidLng", e.target.value)}
          />
        </div>
      </div>

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
