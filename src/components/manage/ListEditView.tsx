"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ListEditView as ListEditData } from "@/lib/admin-data";
import { useToast } from "@/components/Toast";
import { deleteList, setListCampaigns, updateList } from "@/lib/admin-actions";

function numOrNull(v: string): number | null {
  if (!v.trim()) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function ListEditView({ list }: { list: ListEditData }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  const [name, setName] = useState(list.name);
  const [neighborhood, setNeighborhood] = useState(list.neighborhood);
  const [source, setSource] = useState<"minivan" | "civibyte" | "manual">(
    list.source as "minivan" | "civibyte" | "manual",
  );
  const [sourceRef, setSourceRef] = useState(list.sourceRef ?? "");
  const [doors, setDoors] = useState(String(list.doorsCount));
  const [distance, setDistance] = useState(list.distanceMi != null ? String(list.distanceMi) : "");
  const [lat, setLat] = useState(list.centroidLat != null ? String(list.centroidLat) : "");
  const [lng, setLng] = useState(list.centroidLng != null ? String(list.centroidLng) : "");
  const [linked, setLinked] = useState<string[]>(list.linkedCampaignIds);

  function toggleCampaign(id: string) {
    setLinked((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
  }

  function run(action: () => Promise<{ ok: boolean; message: string }>, after?: () => void) {
    startTransition(async () => {
      const res = await action();
      toast(res.message);
      if (res.ok) {
        after?.();
        router.refresh();
      }
    });
  }

  function save() {
    run(() =>
      updateList(list.id, {
        name: name.trim(),
        neighborhood: neighborhood.trim(),
        source,
        sourceRef: sourceRef.trim(),
        doorsCount: Number(doors) || 0,
        distanceMi: numOrNull(distance),
        centroidLat: numOrNull(lat),
        centroidLng: numOrNull(lng),
      }),
    );
  }

  function saveLinks() {
    run(() => setListCampaigns(list.id, linked));
  }

  function remove() {
    if (!window.confirm("Delete this list? This cannot be undone.")) return;
    run(() => deleteList(list.id), () => router.push("/admin"));
  }

  return (
    <>
      <section className="section">
        <div className="section-head">
          <span className="eyebrow">List details</span>
        </div>
        <div className="card">
          <div className="form">
            <div className="form-field">
              <label className="field-label">List name</label>
              <input className="field" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="form-field">
              <label className="field-label">Neighborhood</label>
              <input
                className="field"
                value={neighborhood}
                onChange={(e) => setNeighborhood(e.target.value)}
              />
            </div>
            <div className="form-two">
              <div className="form-field">
                <label className="field-label">Source</label>
                <select
                  className="field"
                  value={source}
                  onChange={(e) => setSource(e.target.value as typeof source)}
                >
                  <option value="manual">Manual</option>
                  <option value="minivan">Minivan</option>
                  <option value="civibyte">Civibyte</option>
                </select>
              </div>
              <div className="form-field">
                <label className="field-label">Doors</label>
                <input
                  className="field"
                  type="number"
                  min={0}
                  value={doors}
                  onChange={(e) => setDoors(e.target.value)}
                />
              </div>
            </div>
            <div className="form-field">
              <label className="field-label">
                {source === "minivan"
                  ? "List number"
                  : source === "civibyte"
                    ? "List URL"
                    : "Reference"}
              </label>
              <input
                className="field"
                value={sourceRef}
                onChange={(e) => setSourceRef(e.target.value)}
              />
            </div>
            <div className="form-two">
              <div className="form-field">
                <label className="field-label">Distance (mi)</label>
                <input className="field" value={distance} onChange={(e) => setDistance(e.target.value)} />
              </div>
              <div className="form-field">
                <label className="field-label">Center lat / lng</label>
                <div className="form-two">
                  <input className="field" value={lat} placeholder="lat" onChange={(e) => setLat(e.target.value)} />
                  <input className="field" value={lng} placeholder="lng" onChange={(e) => setLng(e.target.value)} />
                </div>
              </div>
            </div>
            <div className="form-actions">
              <button
                className="btn btn-primary btn-block"
                disabled={pending || !name.trim() || !neighborhood.trim()}
                onClick={save}
              >
                Save changes
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <span className="eyebrow">Campaigns</span>
        </div>
        <div className="card">
          <p className="field-hint" style={{ marginTop: 0, marginBottom: 10 }}>
            Link this list to the campaigns whose canvassers can check it out.
          </p>
          <div className="role-toggle">
            {list.campaignOptions.map((c) => (
              <button
                type="button"
                key={c.id}
                className={`role-option${linked.includes(c.id) ? " on" : ""}`}
                onClick={() => toggleCampaign(c.id)}
              >
                <b>{c.name}</b>
              </button>
            ))}
          </div>
          <div className="form-actions">
            <button
              className="btn btn-primary btn-block"
              disabled={pending || !linked.length}
              onClick={saveLinks}
            >
              Save campaign links
            </button>
          </div>
        </div>
      </section>

      <section className="section">
        <button className="btn btn-outline btn-block" disabled={pending} onClick={remove} style={{ color: "var(--critical)" }}>
          Delete list
        </button>
      </section>
    </>
  );
}
