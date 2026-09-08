"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { archiveCampaign, deleteCampaign } from "@/lib/admin-actions";
import { useToast } from "@/components/Toast";

export function DeleteCampaignButton({
  campaignId,
  campaignName,
  activeCheckouts = 0,
}: {
  campaignId: string;
  campaignName: string;
  activeCheckouts?: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState<"archive" | "delete" | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [pending, startTransition] = useTransition();

  function archive() {
    startTransition(async () => {
      const result = await archiveCampaign(campaignId);
      toast(result.message);
      if (result.ok) router.push("/admin");
    });
  }

  function removePermanently() {
    startTransition(async () => {
      const result = await deleteCampaign(campaignId);
      toast(result.message);
      if (result.ok) router.push("/admin");
    });
  }

  return (
    <>
      <div className="row" style={{ gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
        <button
          type="button"
          className="btn btn-outline"
          onClick={() => setOpen("archive")}
        >
          Archive campaign
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          style={{ color: "var(--critical)" }}
          onClick={() => setOpen("delete")}
        >
          Delete permanently
        </button>
      </div>
      {open === "archive" ? (
        <div className="confirm-dialog-backdrop" role="presentation">
          <div
            className="card confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="archive-campaign-title"
          >
            <h2 id="archive-campaign-title">Archive {campaignName}?</h2>
            <p>
              This removes the campaign from active screens while preserving
              its waves, lists, canvass results, volunteer stats, and voter
              write-back data.
            </p>
            {activeCheckouts > 0 ? (
              <p>
                {activeCheckouts} active checkout
                {activeCheckouts === 1 ? " will" : "s will"} be released.
              </p>
            ) : null}
            <div className="form-actions">
              <button
                type="button"
                className="btn btn-outline"
                disabled={pending}
                onClick={() => setOpen(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={pending}
                onClick={archive}
              >
                {pending ? "Archiving…" : "Archive campaign"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {open === "delete" ? (
        <div className="confirm-dialog-backdrop" role="presentation">
          <div className="card confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-campaign-title">
            <h2 id="delete-campaign-title">Permanently delete {campaignName}?</h2>
            <p>
              Archiving is recommended. Permanent deletion removes campaign
              memberships, waves, canvass history, volunteer campaign stats,
              settings, voter links, and campaign-only turfs. Master household
              and voter write-back data is retained.
            </p>
            {activeCheckouts > 0 ? (
              <p>
                This campaign has {activeCheckouts} active checkout
                {activeCheckouts === 1 ? "" : "s"}. Deleting it will cancel
                checkouts on campaign-only lists.
              </p>
            ) : null}
            <label className="field-label">
              Type <b>{campaignName}</b> to confirm
            </label>
            <input
              className="field"
              autoFocus
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
            <div className="form-actions">
              <button
                type="button"
                className="btn btn-outline"
                disabled={pending}
                onClick={() => {
                  setOpen(null);
                  setConfirmation("");
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                style={{ background: "var(--critical)" }}
                disabled={pending || confirmation !== campaignName}
                onClick={removePermanently}
              >
                {pending ? "Deleting…" : "Delete permanently"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
