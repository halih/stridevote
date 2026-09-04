"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createPrecinctTurfs,
  createTurf,
  loadCampaignPrecincts,
  previewTurfDoors,
  setTurfAccess,
} from "@/lib/admin-actions";
import type {
  AdminListRow,
  MemberRow,
  TurfVisibility,
} from "@/lib/admin-data";
import type { PrecinctOverlay } from "@/lib/precinct-geometry";
import { TurfMapEditor, type TurfDrawMode } from "@/components/map/TurfMapEditor";
import { useToast } from "@/components/Toast";

const SAVED_PREFIX = "saved:";

type DoorCount =
  | { key: string; doors: number; voters: number; ungeocoded: number }
  | { key: string; error: string };

/** Identity of a boundary, so a stale count is never shown for a new polygon. */
function boundaryKey(boundary: [number, number][] | null): string {
  if (!boundary?.length) return "";
  const [firstLat, firstLng] = boundary[0];
  const [lastLat, lastLng] = boundary[boundary.length - 1];
  return `${boundary.length}:${firstLat},${firstLng}:${lastLat},${lastLng}`;
}

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
  districtBoundary,
  campaignColor,
  turfs,
  volunteers,
  savedFilters,
}: {
  campaignId: string;
  campaignName: string;
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
  const [autoNamed, setAutoNamed] = useState(false);
  const [visibility, setVisibility] = useState<TurfVisibility>("draft");
  const [assignedUserId, setAssignedUserId] = useState("");
  const [source, setSource] = useState("all");
  const [confirmMapbox, setConfirmMapbox] = useState(false);
  const [doorCount, setDoorCount] = useState<DoorCount | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [mode, setMode] = useState<TurfDrawMode>("precinct");
  const [multiSelect, setMultiSelect] = useState(false);
  const [precincts, setPrecincts] = useState<PrecinctOverlay[]>([]);
  const [precinctStatus, setPrecinctStatus] = useState<"loading" | "ready" | "error">("loading");
  const [selectedPrecinctIds, setSelectedPrecinctIds] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    loadCampaignPrecincts(campaignId).then((result) => {
      if (cancelled) return;
      if (result.ok && "precincts" in result) {
        setPrecincts(result.precincts);
        setPrecinctStatus("ready");
        return;
      }
      setPrecincts([]);
      setPrecinctStatus("error");
      toast(result.message);
    });
    return () => {
      cancelled = true;
    };
  }, [campaignId, toast]);

  const savedFilterId = source.startsWith(SAVED_PREFIX)
    ? source.slice(SAVED_PREFIX.length)
    : "";
  const voterSource: "all" | "saved" = savedFilterId ? "saved" : "all";

  const pendingKey = `${boundaryKey(boundary)}|${source}`;

  const selectedPrecincts = selectedPrecinctIds
    .map((id) => precincts.find((precinct) => precinct.id === id))
    .filter((precinct): precinct is PrecinctOverlay => Boolean(precinct));
  const selectedPrecinct =
    selectedPrecincts.length === 1 ? selectedPrecincts[0] : null;
  const isBatch = selectedPrecincts.length > 1;
  const selectablePrecincts = precincts.filter((precinct) => precinct.selectable);

  // An official precinct carries the voter-file code, so its doors come from
  // registration data rather than from geocoded points.
  const precinctRef =
    selectedPrecinct?.countyCode && selectedPrecinct.code
      ? { countyCode: selectedPrecinct.countyCode, code: selectedPrecinct.code }
      : null;

  function estimateDoors() {
    if (!boundary) return;
    const key = pendingKey;
    setEstimating(true);
    previewTurfDoors(campaignId, {
      boundary,
      voterSource,
      savedFilterId: voterSource === "saved" ? savedFilterId : null,
      precinct: precinctRef,
    }).then((result) => {
      setEstimating(false);
      setDoorCount(
        result.ok
          ? {
              key,
              doors: result.doors ?? 0,
              voters: result.voters ?? 0,
              ungeocoded: result.ungeocoded ?? 0,
            }
          : { key, error: result.message },
      );
    });
  }

  function applyBoundary(
    next: [number, number][] | null,
    origin: "precinct" | "draw",
    precinct?: PrecinctOverlay,
  ) {
    setBoundary(next);
    if (origin === "precinct" && precinct) {
      setSelectedPrecinctIds([precinct.id]);
      if (!name.trim() || autoNamed) {
        setName(precinct.name);
        setAutoNamed(true);
      }
      setResetKey((value) => value + 1);
      return;
    }
    setSelectedPrecinctIds([]);
  }

  function selectPrecinct(precinct: PrecinctOverlay) {
    if (!precinct.selectable) {
      toast("That precinct extends outside the district. Draw a custom turf along the border.");
      return;
    }
    if (!multiSelect) {
      applyBoundary(precinct.boundary, "precinct", precinct);
      return;
    }

    const nextIds = selectedPrecinctIds.includes(precinct.id)
      ? selectedPrecinctIds.filter((id) => id !== precinct.id)
      : [...selectedPrecinctIds, precinct.id];
    const remaining = nextIds
      .map((id) => precincts.find((item) => item.id === id))
      .filter((item): item is PrecinctOverlay => Boolean(item));
    setSelectedPrecinctIds(nextIds);
    setBoundary(remaining.length === 1 ? remaining[0].boundary : null);
    setDoorCount(null);
    if (remaining.length === 1 && (!name.trim() || autoNamed)) {
      setName(remaining[0].name);
      setAutoNamed(true);
    }
  }

  if (!districtBoundary?.length) {
    return (
      <div className="card empty-state">
        Set this campaign&apos;s geographic region in Settings before cutting turf.
      </div>
    );
  }

  function submit() {
    if (!selectedPrecincts.length && !boundary) {
      toast("Select a precinct or draw a turf polygon first.");
      return;
    }
    startTransition(async () => {
      const result = isBatch
        ? await createPrecinctTurfs(campaignId, {
            precincts: selectedPrecincts.map((precinct) => ({
              countyCode: precinct.countyCode,
              code: precinct.code,
            })),
            visibility,
            assignedUserId: visibility === "assigned" ? assignedUserId : null,
            voterSource,
            savedFilterId: voterSource === "saved" ? savedFilterId : null,
          })
        : await createTurf(campaignId, {
            name,
            doorsCount: counted && "doors" in counted ? counted.doors : 0,
            boundary,
            visibility,
            assignedUserId: visibility === "assigned" ? assignedUserId : null,
            voterSource,
            savedFilterId: voterSource === "saved" ? savedFilterId : null,
            precinct: precinctRef,
            confirmMapbox,
            generateVoters: true,
          });
      toast(result.message);
      if (result.ok) {
        setName("");
        setVisibility("draft");
        setAssignedUserId("");
        setSource("all");
        setConfirmMapbox(false);
        setBoundary(null);
        setSelectedPrecinctIds([]);
        setMultiSelect(false);
        setAutoNamed(false);
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

  const counted = doorCount?.key === pendingKey ? doorCount : null;

  return (
    <>
      <div className="turf-workspace">
        <div className="turf-map-column">
          <div className="turf-map-heading">
            <div>
              <span className="eyebrow">{campaignName} district</span>
              <p>
                {mode === "precinct"
                  ? "Click a precinct to cut a turf, or switch to Draw for a custom outline."
                  : "Use the polygon tool to outline one walkable turf."}
              </p>
            </div>
            <div className="turf-legend">
              <span><i className="precinct" /> Precincts</span>
              <span><i className="volunteers" /> Shared</span>
              <span><i className="assigned" /> Assigned</span>
              <span><i className="draft" /> Private</span>
            </div>
          </div>
          <div className="turf-mode-toggle" role="tablist" aria-label="Turf creation mode">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "precinct"}
              className={mode === "precinct" ? "active" : ""}
              onClick={() => {
                setMode("precinct");
                setBoundary(null);
                setDoorCount(null);
              }}
            >
              Select precinct
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "draw"}
              className={mode === "draw" ? "active" : ""}
              onClick={() => {
                setMode("draw");
                setSelectedPrecinctIds([]);
                setMultiSelect(false);
                setBoundary(null);
                setDoorCount(null);
                setResetKey((value) => value + 1);
              }}
            >
              Draw
            </button>
          </div>
          <TurfMapEditor
            districtBoundary={districtBoundary}
            districtColor={campaignColor}
            turfs={mapTurfs}
            precincts={precincts}
            mode={mode}
            selectedPrecinctIds={selectedPrecinctIds}
            value={boundary}
            onChange={(next) => applyBoundary(next, "draw")}
            onSelectPrecinct={selectPrecinct}
            resetKey={resetKey}
          />
          <p className="field-hint">
            {precinctStatus === "loading"
              ? "Loading precincts for this district…"
              : precinctStatus === "error"
                ? "Precincts could not be loaded. You can still draw a turf."
                : `${selectablePrecincts.length} precincts available to select. The dashed outline is the campaign district.`}
          </p>
        </div>

        <aside className="card turf-create-panel">
          <div>
            <span className="eyebrow">New turf</span>
            <h2>
              {isBatch
                ? `Create ${selectedPrecincts.length} turfs`
                : boundary
                ? "Finish turf details"
                : mode === "precinct"
                  ? "Select a precinct"
                  : "Draw on the map"}
            </h2>
            <p>
              {isBatch
                ? `Each selected precinct will become its own turf, named after the precinct.`
                : selectedPrecinct
                ? `Using precinct ${selectedPrecinct.name}.`
                : boundary
                  ? `${boundary.length} boundary points captured.`
                  : mode === "precinct"
                    ? "Click a precinct on the map or choose one from the list."
                    : "Choose the polygon tool and click around the turf boundary."}
            </p>
          </div>

          <div className="form">
            {mode === "precinct" ? (
              <>
              <label className="voter-confirm-mapbox">
                <input
                  type="checkbox"
                  checked={multiSelect}
                  onChange={(event) => {
                    const enabled = event.target.checked;
                    setMultiSelect(enabled);
                    if (!enabled && selectedPrecinctIds.length > 1) {
                      const first = selectedPrecincts[0];
                      setSelectedPrecinctIds(first ? [first.id] : []);
                      setBoundary(first?.boundary ?? null);
                      if (first && (!name.trim() || autoNamed)) {
                        setName(first.name);
                        setAutoNamed(true);
                      }
                    }
                  }}
                />
                Select multiple precincts
              </label>
              <div className="form-field">
                <label className="field-label">
                  {multiSelect ? "Add precinct" : "Precinct"}
                </label>
                <select
                  className="field"
                  value={multiSelect ? "" : selectedPrecinctIds[0] ?? ""}
                  disabled={precinctStatus !== "ready"}
                  onChange={(event) => {
                    const precinct = precincts.find((item) => item.id === event.target.value);
                    if (precinct) selectPrecinct(precinct);
                  }}
                >
                  <option value="">
                    {precinctStatus === "loading"
                      ? "Loading precincts…"
                      : multiSelect
                        ? "Choose a precinct to add…"
                        : "Choose a precinct…"}
                  </option>
                  {selectablePrecincts.map((precinct) => (
                    <option key={precinct.id} value={precinct.id}>
                      {precinct.name}
                    </option>
                  ))}
                </select>
              </div>
              {multiSelect && selectedPrecincts.length ? (
                <div className="turf-precinct-selection">
                  {selectedPrecincts.map((precinct) => (
                    <button
                      type="button"
                      key={precinct.id}
                      onClick={() => selectPrecinct(precinct)}
                      aria-label={`Remove ${precinct.name}`}
                    >
                      {precinct.name} ×
                    </button>
                  ))}
                </div>
              ) : null}
              </>
            ) : null}
            {!isBatch ? <div className="form-field">
              <label className="field-label">Turf name</label>
              <input
                className="field"
                value={name}
                placeholder="North precinct 12"
                onChange={(event) => {
                  setName(event.target.value);
                  setAutoNamed(false);
                }}
              />
            </div> : null}
            <div className="form-field">
              <label className="field-label">Voter source</label>
              <select
                className="field"
                value={source}
                onChange={(event) => setSource(event.target.value)}
              >
                <option value="all">All campaign voters</option>
                {savedFilters.length ? (
                  <optgroup label="Saved filters">
                    {savedFilters.map((filter) => (
                      <option key={filter.id} value={`${SAVED_PREFIX}${filter.id}`}>
                        {filter.name}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </select>
            </div>
            {!isBatch ? <div className="turf-door-count">
              <div>
                <span className="field-label">Estimated doors</span>
                {counted && "doors" in counted ? (
                  <>
                    <b>{counted.doors.toLocaleString()}</b>
                    <p>
                      {counted.voters.toLocaleString()} voters
                      {counted.ungeocoded
                        ? ` · ${counted.ungeocoded.toLocaleString()} campaign doors not geocoded yet`
                        : ""}
                    </p>
                  </>
                ) : (
                  <>
                    <b>—</b>
                    <p>
                      {counted
                        ? counted.error
                        : boundary
                          ? "Estimate the doors in this selection."
                          : "Select a precinct or draw a region first."}
                    </p>
                  </>
                )}
              </div>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                disabled={!boundary || estimating}
                onClick={estimateDoors}
              >
                {estimating ? "Estimating…" : counted ? "Re-estimate" : "Estimate"}
              </button>
            </div> : (
              <p className="field-hint">
                Door estimates are skipped for batch creation. Each precinct is saved as a separate turf.
              </p>
            )}
            {mode === "draw" ? (
              <label className="voter-confirm-mapbox">
                <input
                  type="checkbox"
                  checked={confirmMapbox}
                  onChange={(event) => setConfirmMapbox(event.target.checked)}
                />
                Confirm Mapbox refinement for doors missing stored coords
              </label>
            ) : null}
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
                (!boundary && !isBatch) ||
                (!isBatch && !name.trim()) ||
                (visibility === "assigned" && !assignedUserId)
              }
              onClick={submit}
            >
              {pending
                ? "Saving…"
                : isBatch
                  ? `Create ${selectedPrecincts.length} turfs`
                  : visibility === "draft"
                    ? "Save private turf"
                    : "Save and share turf"}
            </button>
          </div>
        </aside>
      </div>

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
    </>
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
          <p>{turf.doorsCount} doors</p>
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
