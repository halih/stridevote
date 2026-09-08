"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ListEditView as ListEditData } from "@/lib/admin-data";
import { useToast } from "@/components/Toast";
import { Map } from "@/components/map/Map";
import { MapHelp, type MapHelpItem } from "@/components/map/MapHelp";
import { deleteList, enqueueMinivanPull, enqueueMinivanPush, setListCampaigns, updateList } from "@/lib/admin-actions";
import { doorPinColor, DOOR_PIN_COLORS } from "@/lib/canvass/outcomes";
import { sourceLabel } from "@/lib/format";

// Doors render two per row, so keep the page a whole number of rows.
const DOORS_PER_PAGE = 30;

export function ListEditView({ list }: { list: ListEditData }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  const [name, setName] = useState(list.name);
  const [sourceRef, setSourceRef] = useState(list.sourceRef ?? "");
  const [linked, setLinked] = useState<string[]>(list.linkedCampaignIds);
  const [doorPage, setDoorPage] = useState(0);

  const pageCount = Math.ceil(list.doors.length / DOORS_PER_PAGE);
  // Clamp so a refresh that shrinks the list cannot leave us past the end.
  const pageStart = Math.min(doorPage, Math.max(0, pageCount - 1)) * DOORS_PER_PAGE;
  const pageDoors = list.doors.slice(pageStart, pageStart + DOORS_PER_PAGE);

  const mapped = list.doors.flatMap((door) =>
    door.lat != null && door.lng != null
      ? [
          {
            lat: door.lat,
            lng: door.lng,
            color: doorPinColor(door.outcome),
            title: `${door.address} · ${door.voters.length} voter${
              door.voters.length === 1 ? "" : "s"
            }${door.latestOutcome ? ` · ${door.latestOutcome}` : ""}`,
          },
        ]
      : [],
  );

  const mapHelpItems = useMemo((): MapHelpItem[] => {
    const items: MapHelpItem[] = [
      {
        text: `${mapped.length} of ${list.doorsStored} doors mapped`,
      },
    ];
    if (list.doors.some((d) => d.outcome === "contact")) {
      items.push({ color: DOOR_PIN_COLORS.talked, text: "Talked" });
    }
    if (list.doors.some((d) => d.outcome === "lit")) {
      items.push({ color: DOOR_PIN_COLORS.lit, text: "Lit drop" });
    }
    if (
      list.doors.some(
        (d) => d.outcome && d.outcome !== "contact" && d.outcome !== "lit",
      )
    ) {
      items.push({ color: DOOR_PIN_COLORS.other, text: "Other result" });
    }
    if (list.doors.some((d) => !d.outcome)) {
      items.push({ color: DOOR_PIN_COLORS.remaining, text: "Not visited" });
    }
    return items;
  }, [list.doors, list.doorsStored, mapped.length]);

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
        sourceRef: sourceRef.trim(),
      }),
    );
  }

  function saveLinks() {
    run(() => setListCampaigns(list.id, linked));
  }

  function remove() {
    const warning = list.activeCheckouts
      ? `This list has ${list.activeCheckouts} active checkout${list.activeCheckouts === 1 ? "" : "s"}. Archiving it will release ${list.activeCheckouts === 1 ? "that checkout" : "those checkouts"}. Door results and volunteer stats are kept. Continue?`
      : "Archive this list? Door results and volunteer stats are kept.";
    if (!window.confirm(warning)) return;
    run(
      () => deleteList(list.id),
      () =>
        router.push(
          list.returnCampaign
            ? `/admin/${list.returnCampaign.slug}?section=lists`
            : "/admin",
        ),
    );
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
            <div className="form-two">
              <div className="form-field">
                <span className="field-label">Source</span>
                <p className="field-readonly">{sourceLabel(list.source)}</p>
              </div>
              <div className="form-field">
                <span className="field-label">Doors</span>
                <p className="field-readonly">{list.doorsCount}</p>
              </div>
            </div>
            <div className="form-field">
              <label className="field-label">
                {list.source === "minivan"
                  ? "List number"
                  : list.source === "civibyte"
                    ? "List URL"
                    : "Reference"}
              </label>
              <input
                className="field"
                value={sourceRef}
                onChange={(e) => setSourceRef(e.target.value)}
              />
            </div>
            <div className="form-actions">
              <button
                className="btn btn-primary btn-block"
                disabled={pending || !name.trim()}
                onClick={save}
              >
                Save changes
              </button>
            </div>
            {list.minivanEnabled && list.source === "minivan" ? (
              <div className="form-actions" style={{ marginTop: 8, gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-outline"
                  disabled={pending}
                  title="Imports door ResultIDs only"
                  onClick={() => run(() => enqueueMinivanPull(list.id))}
                >
                  Pull from MiniVAN
                </button>
                <button
                  type="button"
                  className="btn btn-outline"
                  disabled={pending}
                  onClick={() => run(() => enqueueMinivanPush(list.id))}
                >
                  Push to MiniVAN
                </button>
              </div>
            ) : null}
            {list.minivanEnabled && list.source === "minivan" ? (
              <p className="sheet-sub">
                Pull imports door dispositions only (Canvassed, Not Home, …). Survey
                answers stay on volunteer phones. Push sends StrideVote results to VAN
                via the local emulator worker.
              </p>
            ) : null}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <span className="eyebrow">Doors and voters</span>
          <span className="section-count">
            {list.doorsStored} doors · {list.voterCount} voters
            {list.programName ? ` · ${list.programName}` : ""}
          </span>
        </div>
        {mapped.length || list.boundary?.length ? (
          <div className="sheet-map admin-list-map">
            <Map
              aspectRatio={2.2}
              polygons={
                list.boundary?.length
                  ? [{ points: list.boundary, color: "#2563eb", fillOpacity: 0.08 }]
                  : []
              }
              markers={mapped}
            />
            <MapHelp items={mapHelpItems} />
          </div>
        ) : null}
        {pageDoors.length ? (
          <div className="list-door-grid">
            {pageDoors.map((door, index) => (
              <article key={door.id} className="card list-door-card">
                <div className="list-door-heading">
                  <span className="list-door-number">{pageStart + index + 1}</span>
                  <div>
                    <h3>{door.address}</h3>
                    <p>
                      {door.voters.length} voter{door.voters.length === 1 ? "" : "s"}
                      {door.latestOutcome ? ` · ${door.latestOutcome}` : ""}
                    </p>
                  </div>
                </div>
                {door.voters.length ? (
                  <ul className="list-door-voters">
                    {door.voters.map((voter) => (
                      <li key={voter.id}>
                        <span>{voter.name}</span>
                        <small>
                          {[
                            voter.age != null ? `Age ${voter.age}` : null,
                            voter.sex,
                            voter.progressiveScore,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </small>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="field-hint">No linked voters.</p>
                )}
              </article>
            ))}
          </div>
        ) : null}
        {pageCount > 1 ? (
          <div className="door-pager">
            <button
              type="button"
              className="btn btn-outline btn-sm"
              disabled={doorPage === 0}
              onClick={() => setDoorPage((page) => page - 1)}
            >
              Previous
            </button>
            <span className="door-pager-label">
              Doors {pageStart + 1}–{pageStart + pageDoors.length} of{" "}
              {list.doorsStored} in walk order
            </span>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              disabled={doorPage >= pageCount - 1}
              onClick={() => setDoorPage((page) => page + 1)}
            >
              Next
            </button>
          </div>
        ) : null}
        {list.doors.length < list.doorsStored ? (
          <p className="field-hint">
            Only the first {list.doors.length} doors are loaded on this page.
          </p>
        ) : null}
        {list.doorsStored ? null : (
          <div className="empty-state">
            This list does not have stored StrideVote doors or voters.
          </div>
        )}
      </section>

      {list.campaignOptions.length > 1 ? (
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
      ) : null}

      <section className="section">
        <button className="btn btn-outline btn-block" disabled={pending} onClick={remove} style={{ color: "var(--critical)" }}>
          Archive list
        </button>
      </section>
    </>
  );
}
