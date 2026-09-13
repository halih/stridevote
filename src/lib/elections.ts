export type ElectionType =
  | "general"
  | "primary"
  | "presidential_primary"
  | "special";

const PRESIDENTIAL_PRIMARIES = new Set([
  "1996-04-23",
  "2008-02-19",
  "2016-05-24",
  "2020-03-10",
  "2024-03-12",
]);

export function electionTypeForDate(value: Date | string): ElectionType {
  const iso =
    typeof value === "string"
      ? value.slice(0, 10)
      : value.toISOString().slice(0, 10);
  if (PRESIDENTIAL_PRIMARIES.has(iso)) return "presidential_primary";

  const [year, month] = iso.split("-").map(Number);
  if (month === 11) return "general";
  if ((year >= 2007 && month === 8) || (year < 2007 && month === 9)) {
    return "primary";
  }
  return "special";
}

export function electionTypeLabel(type: ElectionType | string): string {
  switch (type) {
    case "general":
      return "General";
    case "primary":
      return "Primary";
    case "presidential_primary":
      return "Presidential primary";
    default:
      return "Special";
  }
}

export function votedInRelatedPrimary(
  waveType: string,
  waveDate: Date | string | null,
  primaryDates: readonly (Date | string)[],
): boolean {
  if (waveType !== "general" || !waveDate) return false;
  const waveYear =
    typeof waveDate === "string"
      ? Number(waveDate.slice(0, 4))
      : waveDate.getUTCFullYear();
  if (!Number.isInteger(waveYear)) return false;

  return primaryDates.some((date) => {
    const year =
      typeof date === "string" ? Number(date.slice(0, 4)) : date.getUTCFullYear();
    return year === waveYear;
  });
}
