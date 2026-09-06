"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { syncCampaignVoters } from "@/lib/admin-actions";
import { useToast } from "@/components/Toast";

/** Links the campaign's district voters to a campaign that has none yet. */
export function SyncVotersButton({
  campaignId,
  available,
}: {
  campaignId: string;
  available: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  function sync() {
    startTransition(async () => {
      const result = await syncCampaignVoters(campaignId);
      toast(result.message);
      if (result.ok) router.refresh();
    });
  }

  return (
    <button
      type="button"
      className="btn btn-primary btn-sm"
      disabled={pending}
      onClick={sync}
    >
      {pending
        ? "Linking voters…"
        : `Link ${available.toLocaleString()} voters to this campaign`}
    </button>
  );
}
