"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CampaignBoard, CampaignVM } from "@/lib/data";
import { Icon } from "@/components/Icon";
import { useToast } from "@/components/Toast";
import { requestJoinCampaign } from "@/lib/actions";
import { CampaignSheet } from "./CampaignSheet";
import { fmt } from "@/lib/format";

const RADII = [1, 5, 10, 25];

export function CampaignsView({
  board,
  hasLocation,
}: {
  board: CampaignBoard;
  hasLocation: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [radius, setRadius] = useState(5);
  const [sheet, setSheet] = useState<{ campaign: CampaignVM; focusContact: boolean } | null>(null);

  const discover = board.discover.filter(
    (c) => c.distanceMi == null || c.distanceMi <= radius,
  );

  function join(c: CampaignVM) {
    startTransition(async () => {
      const res = await requestJoinCampaign(c.id);
      toast(res.message);
      if (res.ok) {
        setSheet(null);
        router.refresh();
      }
    });
  }

  return (
    <>
      {!hasLocation ? (
        <Link href="/profile" className="card" style={{ display: "block", marginBottom: 16, padding: "14px 16px", textDecoration: "none" }}>
          <p className="camp-name" style={{ marginBottom: 4 }}>
            <Icon name="home" size={15} /> Set your location
          </p>
          <p className="section-sub" style={{ margin: 0 }}>
            Add your location to your profile to see campaigns and turf nearest to you.
          </p>
        </Link>
      ) : null}

      <section className="section">
        <div className="section-head">
          <span className="eyebrow">My campaigns</span>
          <span className="section-sub">{board.mine.length} joined</span>
        </div>
        <div className="stack">
          {board.mine.length ? (
            board.mine.map((c) => (
              <div key={c.id} className="card camp-card" style={{ ["--stripe" as string]: c.color }}>
                <div className="camp-top">
                  <div>
                    <p className="camp-name">{c.name}</p>
                    <p className="camp-office">
                      {c.office} · {c.district}
                    </p>
                  </div>
                  <span className={`pill ${c.status === "active" ? "pill-active" : "pill-pending"}`}>
                    {c.status === "active" ? "Active" : "Pending approval"}
                  </span>
                </div>
                <div className="tags">
                  {c.tags.map((t) => (
                    <span key={t} className="tag">
                      {t}
                    </span>
                  ))}
                </div>
                <div className="camp-meta">
                  <span className="meta-stat">
                    {c.status === "active" ? (
                      <>
                        <b>{c.doorsKnocked}</b> doors knocked
                      </>
                    ) : (
                      <>Requested {c.requestedAt}</>
                    )}
                  </span>
                  {c.status === "active" && c.joinedAt ? (
                    <span className="meta-stat">
                      Since <b>{c.joinedAt}</b>
                    </span>
                  ) : null}
                  <span className="meta-stat">
                    <b>{c.listsAvailable}</b> of {c.listsTotal} lists open
                  </span>
                </div>
                <div className="card-footer-row">
                  <button
                    className="btn btn-outline btn-sm"
                    onClick={() => setSheet({ campaign: c, focusContact: false })}
                  >
                    <Icon name="map" size={14} /> Boundary
                  </button>
                  <button
                    className="btn btn-outline btn-sm"
                    onClick={() => setSheet({ campaign: c, focusContact: true })}
                  >
                    <Icon name="contact" size={14} /> Contact
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="empty-state">
              You haven&apos;t joined any campaigns yet. Discover nearby ones below.
            </div>
          )}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <span className="eyebrow">Discover nearby</span>
        </div>
        <div className="card" style={{ marginBottom: 12, padding: "14px 16px" }}>
          <div className="radius-row">
            <span className="section-sub">Search radius</span>
            <div className="segmented" style={{ maxWidth: 220 }}>
              {RADII.map((r) => (
                <button key={r} className={radius === r ? "active" : ""} onClick={() => setRadius(r)}>
                  {r} mi
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="stack">
          {discover.length ? (
            discover.map((c) => (
              <div key={c.id} className="card camp-card" style={{ ["--stripe" as string]: c.color }}>
                <div className="camp-top">
                  <div>
                    <p className="camp-name">{c.name}</p>
                    <p className="camp-office">
                      {c.office} · {c.district}
                    </p>
                  </div>
                  <span className="pill pill-neutral">
                    {c.distanceMi != null ? `${c.distanceMi} mi away` : "Nearby"}
                  </span>
                </div>
                <div className="tags">
                  {c.tags.map((t) => {
                    const match = c.matchTags.includes(t);
                    return (
                      <span key={t} className={`tag${match ? " match" : ""}`}>
                        {match ? <Icon name="check" size={12} /> : null}
                        {t}
                      </span>
                    );
                  })}
                </div>
                {c.matchTags.length ? (
                  <p
                    className="section-sub"
                    style={{ margin: "9px 0 0", color: "var(--accent-ink)", fontWeight: 600 }}
                  >
                    Shares {c.matchTags.length} value{c.matchTags.length > 1 ? "s" : ""} with your
                    campaigns
                  </p>
                ) : null}
                <div className="camp-meta" style={{ borderTop: "none", paddingTop: 12, marginTop: 12 }}>
                  <span className="meta-stat">
                    <b>{c.listsAvailable}</b> of {c.listsTotal} lists open
                  </span>
                  <span className="meta-stat">
                    <b>{fmt(c.doorsRemaining)}</b> doors remaining
                  </span>
                </div>
                <div className="card-footer-row">
                  <button
                    className="btn btn-outline btn-sm"
                    onClick={() => setSheet({ campaign: c, focusContact: false })}
                  >
                    View details
                  </button>
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={pending}
                    onClick={() => join(c)}
                  >
                    Request to join
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="empty-state">
              No campaigns found within {radius} mi. Try widening your search radius.
            </div>
          )}
        </div>
      </section>

      <CampaignSheet
        entry={sheet}
        onClose={() => setSheet(null)}
        onJoin={join}
        joinPending={pending}
      />
    </>
  );
}
