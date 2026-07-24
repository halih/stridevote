// Door-outcome statistics source. Today these numbers are sample/mock data since
// we don't build the door-knocking flow this phase. When an external stats import
// (from Minivan/Civibyte or our own canvassing) lands, replace `getDoorStats`
// with the real query — the Stats UI consumes this shape unchanged.

export interface OutcomeCounts {
  contact: number;
  no_answer: number;
  refused: number;
  lit: number;
  unsafe: number;
  inaccessible: number;
}

export interface DoorStats {
  isSample: boolean;
  doorsKnocked: number;
  votersReached: number;
  litDropped: number;
  hoursActive: number;
  weeklyHistory: number[]; // last 8 weeks
  outcomes: OutcomeCounts;
}

const SAMPLE: DoorStats = {
  isSample: true,
  doorsKnocked: 794,
  votersReached: 463,
  litDropped: 71,
  hoursActive: 64,
  weeklyHistory: [58, 72, 64, 90, 81, 110, 95, 64],
  outcomes: {
    contact: 327,
    no_answer: 292,
    refused: 73,
    lit: 68,
    unsafe: 9,
    inaccessible: 27,
  },
};

export interface LeaderboardEntry {
  name: string;
  doors: number;
}

const LEADERBOARD: LeaderboardEntry[] = [
  { name: "Priya N.", doors: 1240 },
  { name: "Tom R.", doors: 980 },
  { name: "Sam K.", doors: 875 },
  { name: "Grace T.", doors: 640 },
  { name: "Derek O.", doors: 512 },
  { name: "Noor H.", doors: 455 },
  { name: "Felix B.", doors: 390 },
  { name: "Rosa M.", doors: 310 },
  { name: "Ken S.", doors: 275 },
  { name: "Alicia P.", doors: 190 },
];

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function getDoorStats(_userId: string): Promise<DoorStats> {
  // TODO: replace with real query once stats import exists.
  return SAMPLE;
}

export function getSampleLeaderboard(): LeaderboardEntry[] {
  return LEADERBOARD.map((e) => ({ ...e }));
}
