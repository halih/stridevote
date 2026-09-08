/**
 * Match MiniVAN people to StrideVote voters the same way van_import.py does:
 * last name + house number + zip, then unique first name / first initial.
 */

export interface MinivanPersonMatchInput {
  vanId: number;
  firstName: string | null;
  lastName: string | null;
  streetNo: string | null;
  zip5: string | null;
}

export interface StrideVoterMatchCandidate {
  id: string;
  firstName: string;
  lastName: string;
  /** House number from registration address (digits only, as stored for match). */
  streetNo: string;
  postalCode: string;
}

export type MatchStatus = "matched" | "matched_initial" | "ambiguous" | "no_match";

export interface MatchResult {
  vanId: number;
  voterId: string | null;
  status: MatchStatus;
}

function normFirst(s: string | null | undefined): string {
  return (s ?? "").toUpperCase().replace(/[^A-Z]/g, "");
}

function normLast(s: string | null | undefined): string {
  return (s ?? "").toUpperCase().replace(/[^A-Z]/g, "");
}

function normStreetNo(s: string | null | undefined): string {
  return String(s ?? "").trim();
}

function normZip(s: string | null | undefined): string {
  return String(s ?? "").replace(/\D/g, "").slice(0, 5);
}

/** Extract leading house number from a registration address line. */
export function extractStreetNo(addressLine: string): string {
  const m = addressLine.trim().match(/^(\d+[A-Z]?)/i);
  return m ? m[1].toUpperCase() : "";
}

export function matchKey(
  lastName: string | null | undefined,
  streetNo: string | null | undefined,
  zip5: string | null | undefined,
): string {
  return `${normLast(lastName)}|${normStreetNo(streetNo)}|${normZip(zip5)}`;
}

/**
 * Build VanID → voterId for every uniquely matchable MiniVAN person.
 * Ambiguous / no_match are skipped (no voterId).
 */
export function matchMinivanPeople(
  people: MinivanPersonMatchInput[],
  voters: StrideVoterMatchCandidate[],
): { mapping: Map<number, string>; results: MatchResult[]; stats: Record<MatchStatus, number> } {
  const byKey = new Map<string, StrideVoterMatchCandidate[]>();
  for (const v of voters) {
    const key = matchKey(v.lastName, v.streetNo, v.postalCode);
    const list = byKey.get(key) ?? [];
    list.push(v);
    byKey.set(key, list);
  }

  const mapping = new Map<number, string>();
  const results: MatchResult[] = [];
  const stats: Record<MatchStatus, number> = {
    matched: 0,
    matched_initial: 0,
    ambiguous: 0,
    no_match: 0,
  };

  for (const p of people) {
    const key = matchKey(p.lastName, p.streetNo, p.zip5);
    const cands = byKey.get(key) ?? [];
    if (!cands.length) {
      stats.no_match += 1;
      results.push({ vanId: p.vanId, voterId: null, status: "no_match" });
      continue;
    }
    const full = cands.filter((c) => normFirst(c.firstName) === normFirst(p.firstName));
    if (full.length === 1) {
      mapping.set(p.vanId, full[0].id);
      stats.matched += 1;
      results.push({ vanId: p.vanId, voterId: full[0].id, status: "matched" });
      continue;
    }
    const init = cands.filter(
      (c) => normFirst(c.firstName).slice(0, 1) === normFirst(p.firstName).slice(0, 1),
    );
    if (init.length === 1) {
      mapping.set(p.vanId, init[0].id);
      stats.matched_initial += 1;
      results.push({ vanId: p.vanId, voterId: init[0].id, status: "matched_initial" });
      continue;
    }
    stats.ambiguous += 1;
    results.push({ vanId: p.vanId, voterId: null, status: "ambiguous" });
  }

  return { mapping, results, stats };
}
