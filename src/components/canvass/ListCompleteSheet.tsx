"use client";

import { BottomSheet } from "@/components/BottomSheet";
import { Icon } from "@/components/Icon";

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
  { left: "14%", delay: "130ms", color: "#85b7eb", rot: "16deg", w: 4, h: 4 },
  { left: "42%", delay: "150ms", color: "#c97a2e", rot: "0deg", w: 4, h: 4 },
  { left: "72%", delay: "160ms", color: "#185FA5", rot: "40deg", w: 4, h: 4 },
] as const;

export function ListCompleteSheet({
  open,
  listName,
  doorsDone,
  pending,
  onRelease,
  onKeepWalking,
}: {
  open: boolean;
  listName: string;
  doorsDone: number;
  pending: boolean;
  onRelease: () => void;
  onKeepWalking: () => void;
}) {
  return (
    <BottomSheet open={open} onClose={onKeepWalking}>
      <div className="list-complete">
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

        <div className="list-complete-badge" aria-hidden>
          <Icon name="check" size={28} />
        </div>

        <div className="progress-row" style={{ marginTop: 4 }}>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: "100%" }} />
          </div>
          <span className="progress-label">{doorsDone}/{doorsDone} doors</span>
        </div>

        <h2>List complete</h2>
        <p className="sheet-sub">
          {listName} · {doorsDone} door{doorsDone === 1 ? "" : "s"} canvassed
        </p>
        <p className="section-sub" style={{ marginTop: -8, marginBottom: 16 }}>
          Nice work — release this list so it moves to Completed.
        </p>

        <button
          type="button"
          className="btn btn-primary btn-block"
          disabled={pending}
          onClick={onRelease}
        >
          Release list
        </button>
        <button
          type="button"
          className="btn btn-outline btn-block"
          style={{ marginTop: 8 }}
          disabled={pending}
          onClick={onKeepWalking}
        >
          Keep walking
        </button>
      </div>
    </BottomSheet>
  );
}
