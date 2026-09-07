"use client";

import { useState, useTransition } from "react";
import { BottomSheet } from "@/components/BottomSheet";
import { Icon } from "@/components/Icon";
import { markAchievementsSeen } from "@/lib/actions";
import type { UnseenUnlockVM } from "@/lib/achievements/types";

const CONFETTI = [
  { left: "8%", delay: "0ms", color: "#185FA5", rot: "-18deg", w: 7, h: 11 },
  { left: "18%", delay: "40ms", color: "#2e9e5b", rot: "22deg", w: 6, h: 10 },
  { left: "28%", delay: "90ms", color: "#c97a2e", rot: "-8deg", w: 5, h: 9 },
  { left: "38%", delay: "20ms", color: "#378add", rot: "14deg", w: 8, h: 8 },
  { left: "48%", delay: "70ms", color: "#2e9e5b", rot: "-24deg", w: 6, h: 12 },
  { left: "58%", delay: "110ms", color: "#185FA5", rot: "10deg", w: 5, h: 10 },
  { left: "68%", delay: "30ms", color: "#c97a2e", rot: "-14deg", w: 7, h: 9 },
  { left: "78%", delay: "80ms", color: "#5fa8e8", rot: "28deg", w: 6, h: 11 },
  { left: "88%", delay: "50ms", color: "#2e9e5b", rot: "-6deg", w: 5, h: 8 },
] as const;

export function AchievementUnlockSheet({
  unlocks,
}: {
  unlocks: UnseenUnlockVM[];
}) {
  // Snapshot once on mount so "next" is local — avoid remounting the stats RSC.
  const [queue, setQueue] = useState(unlocks);
  const [, startTransition] = useTransition();
  const current = queue[0] ?? null;

  function persistSeen(ids: string[]) {
    if (!ids.length) return;
    startTransition(() => {
      void markAchievementsSeen(ids);
    });
  }

  function dismiss() {
    if (!current) return;
    persistSeen([current.unlockId]);
    setQueue((q) => q.slice(1));
  }

  function dismissAll() {
    const ids = queue.map((u) => u.unlockId);
    persistSeen(ids);
    setQueue([]);
  }

  return (
    <BottomSheet open={Boolean(current)} onClose={dismiss}>
      {current ? (
        <div className="list-complete achievement-unlock" key={current.unlockId}>
          <div className="list-complete-confetti" aria-hidden>
            {CONFETTI.map((bit, i) => (
              <span
                key={i}
                className="list-complete-bit"
                style={{
                  left: bit.left,
                  animationDelay: bit.delay,
                  background: bit.color,
                  width: bit.w,
                  height: bit.h,
                  ["--bit-rot" as string]: bit.rot,
                }}
              />
            ))}
          </div>

          <div className="list-complete-badge achievement-unlock-badge" aria-hidden>
            <Icon name={current.icon} size={28} />
          </div>

          <p className="eyebrow" style={{ marginTop: 14 }}>
            Achievement unlocked
            {queue.length > 1 ? ` · ${queue.length} left` : null}
          </p>
          <h2>{current.title}</h2>
          <p className="sheet-sub">{current.description}</p>
          {current.earnedAt ? (
            <p className="section-sub" style={{ marginTop: -4, marginBottom: 4 }}>
              Earned {current.earnedAt}
            </p>
          ) : null}
          {current.campaignName ? (
            <p className="section-sub" style={{ marginTop: -8, marginBottom: 16 }}>
              {current.campaignName}
            </p>
          ) : (
            <p className="section-sub" style={{ marginTop: -8, marginBottom: 16 }}>
              Across all your campaigns
            </p>
          )}

          <button type="button" className="btn btn-primary btn-block" onClick={dismiss}>
            {queue.length > 1 ? "Nice — next" : "Awesome"}
          </button>
          {queue.length > 1 ? (
            <button
              type="button"
              className="btn btn-outline btn-block"
              style={{ marginTop: 8 }}
              onClick={dismissAll}
            >
              Dismiss all ({queue.length})
            </button>
          ) : null}
        </div>
      ) : null}
    </BottomSheet>
  );
}
