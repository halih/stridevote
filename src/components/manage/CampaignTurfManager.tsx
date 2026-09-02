"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createTurf, setTurfAccess } from "@/lib/admin-actions";
import type {
  AdminListRow,
  MemberRow,
  TurfVisibility,
} from "@/lib/admin-data";
import { TurfMapEditor } from "@/components/map/TurfMapEditor";
import { useToast } from "@/components/Toast";

const ACCESS_LABELS: Record<TurfVisibility, string> = {
  volunteers: "All volunteers",
  assigned: "Assigned volunteer",
  draft: "Private draft",
};

function turfColor(turf: AdminListRow, campaignColor: string): string {
  if (turf.visibility === "draft") return "#8a8f98";
  if (turf.visibility === "assigned") return "#c97a2e";
  return campaignColor;
}

export function CampaignTurfManager({
  campaignId,
  campaignName,
  districtName,
  districtBoundary,
  campaignColor,
  turfs,
  volunteers,
  savedFilters,
}: {
  campaignId: string;
  campaignName: string;
  districtName: string;
  districtBoundary: [number, number][] | null;
  campaignColor: string;
  turfs: AdminListRow[];
  volunteers: MemberRow[];
  savedFilters: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [boundary, setBoundary] = useState<[number, number][] | null>(null);
  const [name, setName] = useState("");
  const [area, setArea] = useState(districtName);
  const [doors, setDoors] = useState("0");
  const [visibility, setVisibility] = useState<TurfVisibility>("draft");
  const [assignedUserId, setAssignedUserId] = useState("");
  const [voterSource, setVoterSource] = useState<"all" | "saved">("all");
  const [savedFilterId, setSavedFilterId] = useState("");
  const [confirmMapbox, setConfirmMapbox] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  if (!districtBoundary?.length) {
    return (
      <div className="card empty-state">
        Set this campaign&apos;s geographic region in Settings before cutting turf.
      </div>
    );
  }

  function submit() {
    if (!boundary) {
      toast("Draw a turf polygon on the map first.");
      return;
    }
    startTransition(async () => {
      const result = await createTurf(campaignId, {
        name,
        neighborhood: area,
        doorsCount: Number(doors) || 0,
        boundary,
        visibility,
        assignedUserId: visibility === "assigned" ? assignedUserId : null,
        voterSource,
        savedFilterId: voterSource === "saved" ? savedFilterId : null,
        confirmMapbox,
        generateVoters: true,
      });
      toast(result.message);
      if (result.ok) {
        setName("");
        setDoors("0");
        setVisibility("draft");
        setAssignedUserId("");
        setVoterSource("all");
        setSavedFilterId("");
        setConfirmMapbox(false);
        setBoundary(null);
        setResetKey((value) => value + 1);
        router.refresh();
      }
    });
  }

  const mapTurfs = turfs
    .filter(
      (turf): turf is AdminListRow & { boundary: [number, number][] } =>
        Boolean(turf.boundary?.length),
    )
    .map((turf) => ({
      id: turf.id,
      name: `${turf.name} · ${ACCESS_LABELS[turf.visibility]}`,
      boundary: turf.boundary,
      color: turfColor(turf, campaignColor),
      fillOpacity: turf.visibility === "draft" ? 0.1 : 0.2,
    }));

  return (
    <div className="turf-workspace">
      <div className="turf-map-column">
        <div className="turf-map-heading">
          <div>
            <span className="eyebrow">{campaignName} district</span>
            <p>Use the polygon tool to outline one walkable turf.</p>
          </div>
          <div className="turf-legend">
            <span><i className="volunteers" /> Shared</span>
            <span><i className="assigned" /> Assigned</span>
            <span><i className="draft" /> Private</span>
          </div>
        </div>
        <TurfMapEditor
          districtBoundary={districtBoundary}
          districtColor={campaignColor}
          turfs={mapTurfs}
          value={boundary}
          onChange={setBoundary}
          resetKey={resetKey}
        />
        <p className="field-hint">
          The dashed outline is the campaign district. Turf must stay inside it.
          Use edit or delete on the map toolbar before saving.
        </p>
      </div>

      <aside className="card turf-create-panel">
        <div>
          <span className="eyebrow">New turf</span>
          <h2>{boundary ? "Finish turf details" : "Draw on the map"}</h2>
          <p>
            {boundary
              ? `${boundary.length} boundary points captured.`
              : "Choose the polygon tool and click around the turf boundary."}
          </p>
        </div>

        <div className="form">
          <div className="form-field">
            <label className="field-label">Turf name</label>
            <input
              className="field"
              value={name}
              placeholder="North precinct 12"
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="form-field">
            <label className="field-label">Area / neighborhood</label>
            <input
              className="field"
              value={area}
              onChange={(event) => setArea(event.target.value)}
            />
          </div>
          <div className="form-field">
            <label className="field-label">Estimated doors</label>
            <input
              className="field"
              type="number"
              min={0}
              value={doors}
              onChange={(event) => setDoors(event.target.value)}
            />
            <p className="field-hint">
              Overwritten by household count when voters are generated from the polygon.
            </p>
          </div>
          <div className="form-field">
            <label className="field-label">Voter source</label>
            <select
              className="field"
              value={voterSource}
              onChange={(event) =>
                setVoterSource(event.target.value as "all" | "saved")
              }
            >
              <option value="all">All campaign voters</option>
              <option value="saved">Saved filter</option>
            </select>
          </div>
          {voterSource === "saved" ? (
            <div className="form-field">
              <label className="field-label">Saved filter</label>
              <select
                className="field"
                value={savedFilterId}
                onChange={(event) => setSavedFilterId(event.target.value)}
              >
                <option value="">Choose a filter…</option>
                {savedFilters.map((filter) => (
                  <option key={filter.id} value={filter.id}>
                    {filter.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <label className="voter-confirm-mapbox">
            <input
              type="checkbox"
              checked={confirmMapbox}
              onChange={(event) => setConfirmMapbox(event.target.checked)}
            />
            Confirm Mapbox refinement for doors missing stored coords
          </label>
          <TurfAccessFields
            visibility={visibility}
            assignedUserId={assignedUserId}
            volunteers={volunteers}
            onVisibilityChange={setVisibility}
            onAssignedUserChange={setAssignedUserId}
          />
          <button
            type="button"
            className="btn btn-primary btn-block"
            disabled={
              pending ||
              !boundary ||
              !name.trim() ||
              !area.trim() ||
              (visibility === "assigned" && !assignedUserId) ||
              (voterSource === "saved" && !savedFilterId)
            }
            onClick={submit}
          >
            {pending ? "Saving…" : visibility === "draft" ? "Save private turf" : "Save and share turf"}
          </button>
        </div>
      </aside>

      <section className="turf-existing">
        <div className="section-head">
          <span className="eyebrow">Cut turfs</span>
          <span className="section-sub">{turfs.length}</span>
        </div>
        {turfs.length ? (
          <div className="turf-access-grid">
            {turfs.map((turf) => (
              <TurfAccessCard
                key={turf.id}
                campaignId={campaignId}
                turf={turf}
                volunteers={volunteers}
              />
            ))}
          </div>
        ) : (
          <div className="card empty-state">No turfs have been cut for this campaign yet.</div>
        )}
      </section>
    </div>
  );
}

function TurfAccessFields({
  visibility,
  assignedUserId,
  volunteers,
  onVisibilityChange,
  onAssignedUserChange,
}: {
  visibility: TurfVisibility;
  assignedUserId: string;
  volunteers: MemberRow[];
  onVisibilityChange: (value: TurfVisibility) => void;
  onAssignedUserChange: (value: string) => void;
}) {
  return (
    <>
      <div className="form-field">
        <label className="field-label">Who can see this turf?</label>
        <div className="turf-access-options">
          {(Object.keys(ACCESS_LABELS) as TurfVisibility[]).map((value) => (
            <button
              type="button"
              key={value}
              className={visibility === value ? "active" : ""}
              onClick={() => onVisibilityChange(value)}
            >
              {ACCESS_LABELS[value]}
            </button>
          ))}
        </div>
      </div>
      {visibility === "assigned" ? (
        <div className="form-field">
          <label className="field-label">Volunteer</label>
          <select
            className="field"
            value={assignedUserId}
            onChange={(event) => onAssignedUserChange(event.target.value)}
          >
            <option value="">Choose a volunteer…</option>
            {volunteers.map((volunteer) => (
              <option key={volunteer.userId} value={volunteer.userId}>
                {volunteer.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}
    </>
  );
}

function TurfAccessCard({
  campaignId,
  turf,
  volunteers,
}: {
  campaignId: string;
  turf: AdminListRow;
  volunteers: MemberRow[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [visibility, setVisibility] = useState(turf.visibility);
  const [assignedUserId, setAssignedUserId] = useState(turf.assignedUserId ?? "");

  function save() {
    startTransition(async () => {
      const result = await setTurfAccess(
        campaignId,
        turf.id,
        visibility,
        visibility === "assigned" ? assignedUserId : null,
      );
      toast(result.message);
      if (result.ok) router.refresh();
    });
  }

  return (
    <article className="card turf-access-card">
      <div className="turf-card-title">
        <div>
          <h3>{turf.name}</h3>
          <p>{turf.neighborhood} · {turf.doorsCount} doors</p>
        </div>
        <span className={`turf-status ${turf.visibility}`}>
          {ACCESS_LABELS[turf.visibility]}
        </span>
      </div>
      <TurfAccessFields
        visibility={visibility}
        assignedUserId={assignedUserId}
        volunteers={volunteers}
        onVisibilityChange={setVisibility}
        onAssignedUserChange={setAssignedUserId}
      />
      <button
        type="button"
        className="btn btn-outline btn-sm"
        disabled={
          pending ||
          (visibility === "assigned" && !assignedUserId) ||
          (visibility === turf.visibility &&
            (visibility !== "assigned" || assignedUserId === turf.assignedUserId))
        }
        onClick={save}
      >
        {pending ? "Updating…" : "Update access"}
      </button>
    </article>
  );
}
