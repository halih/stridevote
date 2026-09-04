"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ListEditView as ListEditData } from "@/lib/admin-data";
import { useToast } from "@/components/Toast";
import { Map } from "@/components/map/Map";
import { deleteList, setListCampaigns, updateList } from "@/lib/admin-actions";
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
            color: "#2563eb",
            title: `${door.address} · ${door.voters.length} voter${
              door.voters.length === 1 ? "" : "s"
            }`,
          },
        ]
      : [],
  );

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
      ? `This list has ${list.activeCheckouts} active checkout${list.activeCheckouts === 1 ? "" : "s"}. Deleting it will cancel ${list.activeCheckouts === 1 ? "that checkout" : "those checkouts"} for canvassers. Continue?`
      : "Delete this list? This cannot be undone.";
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
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <span className="eyebrow">Doors and voters</span>
          <span className="section-count">
            {list.doorsStored} doors · {list.voterCount} voters
          </span>
        </div>
        {mapped.length || list.boundary?.length ? (
          <Map
            aspectRatio={2.2}
            polygons={
              list.boundary?.length
                ? [{ points: list.boundary, color: "#2563eb", fillOpacity: 0.08 }]
                : []
            }
            markers={mapped}
            caption={`${mapped.length} of ${list.doorsStored} doors mapped`}
          />
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
          Delete list
        </button>
      </section>
    </>
  );
}
