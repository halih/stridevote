export interface ExternalSourceVoter {
  voterId: string;
  vanId?: number | null;
}

export interface ExpandedExternalVoter {
  voterId: string;
  matchedSeed: boolean;
  vanId?: number | null;
}

/**
 * Keep source-list identity on matched voters while adding every other
 * campaign voter who shares one of the imported doors.
 */
export function expandExternalListVoters(
  sourceVoters: ExternalSourceVoter[],
  householdMemberIds: string[],
): ExpandedExternalVoter[] {
  const rows = new Map<string, ExpandedExternalVoter>();
  for (const source of sourceVoters) {
    if (rows.has(source.voterId)) continue;
    rows.set(source.voterId, {
      voterId: source.voterId,
      matchedSeed: true,
      ...(source.vanId == null ? {} : { vanId: source.vanId }),
    });
  }
  for (const voterId of householdMemberIds) {
    if (!rows.has(voterId)) {
      rows.set(voterId, { voterId, matchedSeed: false });
    }
  }
  return [...rows.values()];
}
