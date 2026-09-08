import type { MinivanAdapter } from "./types";

/**
 * Imraan Primary Script (list 280640 / script 762505).
 * ResultIDs from MINIVAN_DB_SCHEMA.md §5.
 */
export const imraanAdapter: MinivanAdapter = {
  key: "imraan",
  label: "Imraan Primary Script",
  pullResultIdToDoor: {
    14: "contact", // Canvassed
    1: "no_answer", // Not Home
    2: "refused",
    3: "inaccessible",
    5: "moved",
    21: "lit", // Lit Dropped
    4: null, // Deceased — no StrideVote door outcome
  },
  pullStatusLabelToDoor: {
    CANVASSED: "contact",
    NOTHOME: "no_answer",
    REFUSED: "refused",
    INACCESSIBLE: "inaccessible",
    MOVED: "moved",
    LITDROPPED: "lit",
    LITDROP: "lit",
    DECEASED: null,
  },
  pushDoorToStatusLabel: {
    contact: "Canvassed",
    no_answer: "Not Home",
    refused: "Refused",
    inaccessible: "Inaccessible",
    moved: "Moved",
    lit: "Lit Dropped",
    unsafe: "Inaccessible",
  },
  supportSortOrder: true,
  householdStatuses: ["lit-dropped"],
};
