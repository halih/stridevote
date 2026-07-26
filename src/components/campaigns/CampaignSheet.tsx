"use client";

import { useState } from "react";
import type { CampaignVM } from "@/lib/data";
import { BottomSheet } from "@/components/BottomSheet";
import { Icon } from "@/components/Icon";
import { Map } from "@/components/map/Map";
import { useToast } from "@/components/Toast";
import { fmt } from "@/lib/format";

export function CampaignSheet({
  entry,
  onClose,
  onJoin,
  joinPending,
}: {
  entry: { campaign: CampaignVM; focusContact: boolean } | null;
  onClose: () => void;
  onJoin: (c: CampaignVM) => void;
  joinPending: boolean;
}) {
  const toast = useToast();
  const [msg, setMsg] = useState("");
  const c = entry?.campaign ?? null;

  return (
    <BottomSheet open={!!entry} onClose={onClose}>
      {c ? (
        <>
          <h2>{c.name}</h2>
          <p className="sheet-sub">
            {c.office} · {c.district}
          </p>

          {c.boundary && c.boundary.length ? (
            <Map
              polygons={[{ points: c.boundary, color: c.color, fillOpacity: 0.16 }]}
              home={
                c.centroidLat != null && c.homeInside != null
                  ? undefined
                  : undefined
              }
              caption={
                c.homeInside == null
                  ? "Campaign region"
                  : c.homeInside
                    ? "You're inside this campaign's region"
                    : "You're outside this campaign's region"
              }
            />
          ) : null}

          <div className="tags" style={{ marginTop: 12 }}>
            {c.tags.map((t) => (
              <span key={t} className="tag">
                {t}
              </span>
            ))}
          </div>

          <div className="eyebrow" style={{ marginTop: 16 }}>
            Campaign snapshot
          </div>
          <div className="camp-sheet-stats">
            <div className="mini-stat">
              <span className="stat-label">Lists open</span>
              <div className="stat-value">
                {c.listsAvailable} / {c.listsTotal}
              </div>
            </div>
            <div className="mini-stat">
              <span className="stat-label">Doors remaining</span>
              <div className="stat-value">{fmt(c.doorsRemaining)}</div>
            </div>
            <div className="mini-stat">
              <span className="stat-label">Active volunteers</span>
              <div className="stat-value">{c.volunteers}</div>
            </div>
            <div className="mini-stat">
              <span className="stat-label">Doors you&apos;ve knocked</span>
              <div className="stat-value">{fmt(c.doorsKnocked)}</div>
            </div>
          </div>

          {c.contact ? (
            <>
              <div className="eyebrow" style={{ marginTop: 16 }}>
                Contact the campaign
              </div>
              <div className="contact-card">
                <p className="contact-name">{c.contact.name}</p>
                <p className="contact-role">{c.contact.role}</p>
                {c.contact.phone ? (
                  <a className="contact-link" href={`tel:${c.contact.phone.replace(/[^\d+]/g, "")}`}>
                    <Icon name="phone" size={16} /> {c.contact.phone}
                  </a>
                ) : null}
                {c.contact.email ? (
                  <a className="contact-link" href={`mailto:${c.contact.email}`}>
                    <Icon name="mail" size={16} /> {c.contact.email}
                  </a>
                ) : null}
                <textarea
                  className="msg-box"
                  placeholder="Ask a question or say hello…"
                  value={msg}
                  onChange={(e) => setMsg(e.target.value)}
                />
                <button
                  className="btn btn-primary btn-block btn-sm"
                  style={{ marginTop: 10 }}
                  onClick={() => {
                    if (!msg.trim()) return;
                    toast(`Message sent to ${c.contact?.name}`);
                    setMsg("");
                    onClose();
                  }}
                >
                  Send message
                </button>
              </div>
            </>
          ) : null}

          {c.status === "discover" ? (
            <button
              className="btn btn-primary btn-block"
              style={{ marginTop: 16 }}
              disabled={joinPending}
              onClick={() => onJoin(c)}
            >
              Request to join
            </button>
          ) : null}
        </>
      ) : null}
    </BottomSheet>
  );
}
