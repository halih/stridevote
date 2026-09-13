import { Icon } from "@/components/Icon";

/** Compact form for the walk card, where the row also carries name + score meta. */
export function VotedInPrimaryPill({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className="pill pill-active pill-sm"
      title={compact ? "Voted in primary" : undefined}
    >
      <Icon name="vote" size={11} strokeWidth={2.6} />
      {compact ? "Primary" : "Voted primary"}
    </span>
  );
}
