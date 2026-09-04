"use client";

import { useMemo, useState } from "react";
import type { ProgramResultsView } from "@/lib/canvass/admin-results";
import { DOOR_OUTCOME_LABELS, type DoorOutcome } from "@/lib/canvass/outcomes";

export function ProgramResultsPanel({ view }: { view: ProgramResultsView }) {
  const [query, setQuery] = useState("");
  const [showSuperseded, setShowSuperseded] = useState(false);

  const history = useMemo(() => {
    const q = query.trim().toLowerCase();
    return view.doorHistory.filter((row) => {
      if (!showSuperseded && row.superseded) return false;
      if (!q) return true;
      return (
        row.address.toLowerCase().includes(q) ||
        row.listName.toLowerCase().includes(q) ||
        row.canvasser.toLowerCase().includes(q) ||
        row.outcomeLabel.toLowerCase().includes(q)
      );
    });
  }, [view.doorHistory, query, showSuperseded]);

  return (
    <div className="stack">
      <section className="section">
        <div className="section-head">
          <span className="eyebrow">{view.program.name} results</span>
          <span className="pill pill-neutral">{view.program.status}</span>
        </div>
        <div className="results-grid">
          <div className="results-stat">
            <b>{view.doorsClosed}</b>
            <span>Doors done</span>
          </div>
          <div className="results-stat">
            <b>{Math.max(0, view.doorsTotal - view.doorsClosed)}</b>
            <span>Remaining</span>
          </div>
          <div className="results-stat">
            <b>{view.doorsWithAttempt}</b>
            <span>Doors with a result</span>
          </div>
          <div className="results-stat">
            <b>{view.volunteerTotals.length}</b>
            <span>Canvassers</span>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <span className="eyebrow">Outcomes</span>
        </div>
        <div className="card">
          {Object.keys(view.outcomeCounts).length ? (
            Object.entries(view.outcomeCounts).map(([key, count]) => (
              <div key={key} className="member-row">
                <span>
                  {DOOR_OUTCOME_LABELS[key as DoorOutcome] ?? key}
                </span>
                <b>{count}</b>
              </div>
            ))
          ) : (
            <div className="empty-state">No results yet.</div>
          )}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <span className="eyebrow">Lists</span>
        </div>
        <div className="card">
          {view.lists.length ? (
            view.lists.map((list) => (
              <div key={list.listId} className="member-row">
                <div>
                  <p className="member-name">{list.name}</p>
                  <p className="member-contact">
                    {list.closed}/{list.doors} done
                    {list.checkedOutBy ? ` · with ${list.checkedOutBy}` : ""}
                  </p>
                </div>
              </div>
            ))
          ) : (
            <div className="empty-state">No lists in this program.</div>
          )}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <span className="eyebrow">Volunteers</span>
        </div>
        <div className="card">
          {view.volunteerTotals.length ? (
            view.volunteerTotals.map((v) => (
              <div key={v.userId} className="member-row">
                <span>{v.name}</span>
                <b>{v.attempts}</b>
              </div>
            ))
          ) : (
            <div className="empty-state">No volunteer activity yet.</div>
          )}
        </div>
      </section>

      {view.staleAttempts.length ? (
        <section className="section">
          <div className="section-head">
            <span className="eyebrow">Stale checkout review</span>
          </div>
          <div className="card">
            {view.staleAttempts.map((row) => (
              <div key={row.id} className="member-row">
                <div>
                  <p className="member-name">{row.address}</p>
                  <p className="member-contact">
                    {row.listName} · {row.canvasser} · {row.outcomeLabel}
                  </p>
                </div>
                <span className="stale-flag">Stale</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="section">
        <div className="section-head">
          <span className="eyebrow">Door history</span>
        </div>
        <div className="form-field">
          <input
            className="field"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search address, list, canvasser…"
          />
        </div>
        <label className="row" style={{ gap: 8, margin: "8px 0 10px", fontSize: 12 }}>
          <input
            type="checkbox"
            checked={showSuperseded}
            onChange={(e) => setShowSuperseded(e.target.checked)}
          />
          Show replaced results
        </label>
        <div className="card">
          {history.length ? (
            history.map((row) => (
              <div key={row.id} className="member-row">
                <div>
                  <p className="member-name">{row.address}</p>
                  <p className="member-contact">
                    {row.listName} · {row.outcomeLabel}
                    {row.support != null ? ` · support ${row.support}` : ""} ·{" "}
                    {row.canvasser} ·{" "}
                    {new Date(row.capturedAt).toLocaleString()}
                    {row.superseded ? " · replaced" : ""}
                    {row.staleCheckout ? " · stale checkout" : ""}
                  </p>
                  {row.notes ? (
                    <p className="member-contact" style={{ marginTop: 4 }}>
                      Note: {row.notes}
                    </p>
                  ) : null}
                </div>
              </div>
            ))
          ) : (
            <div className="empty-state">No matching attempts.</div>
          )}
        </div>
      </section>
    </div>
  );
}
