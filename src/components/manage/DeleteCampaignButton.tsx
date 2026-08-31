"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteCampaign } from "@/lib/admin-actions";
import { useToast } from "@/components/Toast";

export function DeleteCampaignButton({
  campaignId,
  campaignName,
}: {
  campaignId: string;
  campaignName: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [pending, startTransition] = useTransition();

  function remove() {
    startTransition(async () => {
      const result = await deleteCampaign(campaignId);
      toast(result.message);
      if (result.ok) router.push("/admin");
    });
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-outline"
        style={{ color: "var(--critical)" }}
        onClick={() => setOpen(true)}
      >
        Delete campaign
      </button>
      {open ? (
        <div className="confirm-dialog-backdrop" role="presentation">
          <div className="card confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-campaign-title">
            <h2 id="delete-campaign-title">Delete {campaignName}?</h2>
            <p>
              This permanently removes campaign memberships, settings, voter
              links, and campaign-only turfs. Shared lists remain available to
              their other campaigns.
            </p>
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
                  setOpen(false);
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
                onClick={remove}
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
