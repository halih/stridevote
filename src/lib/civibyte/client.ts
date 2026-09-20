import { z } from "zod";

const CIVIBYTE_API_URL = "https://api.civibyte.com";
const CIVIBYTE_WEB_HOSTS = new Set(["civibyte.com", "www.civibyte.com"]);

const phoneCheckSchema = z.object({
  exists: z.boolean(),
  name: z.string().nullish(),
});

const authSchema = z.object({
  isValid: z.boolean(),
  guestToken: z.string().min(1).optional(),
  canvassingSessionId: z.string().min(1).optional(),
});

const canvassAnswerSchema = z
  .object({
    questionId: z.number(),
    answerOptionIds: z.array(z.number()).optional(),
    textValue: z.string().nullish(),
    numericValue: z.number().nullish(),
  })
  .passthrough();

const surveyOptionSchema = z
  .object({
    id: z.number(),
    label: z.string(),
    displayOrder: z.number(),
  })
  .passthrough();

const surveyQuestionSchema = z
  .object({
    questionId: z.number(),
    text: z.string(),
    internalLabel: z.string().nullish(),
    responseType: z.string(),
    displayOrder: z.number(),
    required: z.boolean().optional(),
    options: z.array(surveyOptionSchema).default([]),
  })
  .passthrough();

const surveySchema = z
  .object({
    id: z.number(),
    name: z.string(),
    questions: z.array(surveyQuestionSchema).default([]),
  })
  .passthrough();

export const civibyteDoorCanvassSchema = z
  .object({
    doorResult: z.string(),
    notes: z.string().nullish(),
    someoneElseContacted: z.boolean().optional(),
    voters: z
      .array(
        z
          .object({
            voterPk: z.string(),
            answers: z.array(canvassAnswerSchema).default([]),
          })
          .passthrough(),
      )
      .default([]),
  })
  .passthrough();

const voterSchema = z
  .object({
    voterPk: z.string(),
    stateVoterId: z.string().nullish(),
    firstName: z.string().nullish(),
    middleName: z.string().nullish(),
    lastName: z.string().nullish(),
    age: z.number().nullish(),
    gender: z.string().nullish(),
    tags: z.unknown().optional(),
  })
  .passthrough();

const sessionDoorSchema = z
  .object({
    id: z.string(),
    addressPk: z.string(),
    buildingAddress: z.string().nullish(),
    completeAddress: z.string().nullish(),
    latitude: z.number(),
    longitude: z.number(),
    voterPks: z.array(z.string()).default([]),
    status: z.string(),
    doorResult: z.string().nullish(),
    attemptedAt: z.string().nullish(),
    priorVisitResult: z.string().nullish(),
    priorVisitAttemptedAt: z.string().nullish(),
  })
  .passthrough();

export const civibyteSessionSchema = z
  .object({
    canvassingSessionId: z.string(),
    sessionName: z.string(),
    candidateDisplayName: z.string().nullish(),
    status: z.string(),
    plannedStartAt: z.string().nullish(),
    sessionLocation: z.unknown().nullish(),
    sessionDoors: z.array(sessionDoorSchema),
    buildings: z.array(z.unknown()),
    votersById: z.record(z.string(), voterSchema),
    script: z.unknown().nullish(),
    survey: surveySchema.nullish(),
  })
  .passthrough();

export type CivibyteSession = z.infer<typeof civibyteSessionSchema>;
export type CivibyteDoorCanvass = z.infer<typeof civibyteDoorCanvassSchema>;
export type CivibyteSurvey = z.infer<typeof surveySchema>;

export interface CivibyteCanvassAnswer {
  questionId: number;
  answerOptionIds: number[];
  textValue: string | null;
  numericValue: number | null;
}

export interface CivibyteCanvassLog {
  clientSubmissionId: string;
  canvassingSessionId: string;
  sessionDoorId: string;
  addressPk: string;
  doorResult: string;
  doorNotes?: string;
  someoneElseContacted: boolean;
  voters: Array<{
    voterPk: string;
    answers: CivibyteCanvassAnswer[];
  }>;
}

const batchAckSchema = z.array(
  z.object({ clientSubmissionId: z.string() }).passthrough(),
);

export interface CivibyteGuestAuth {
  guestToken: string;
  canvassingSessionId: string;
}

export interface PullCivibyteSessionInput {
  link: string;
  phoneNumber: string;
  name?: string;
  fetchImpl?: typeof fetch;
}

export function civibyteTokenFromLink(link: string): string {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    throw new Error("Civibyte link must be a valid URL.");
  }
  if (
    url.protocol !== "https:" ||
    !CIVIBYTE_WEB_HOSTS.has(url.hostname.toLowerCase())
  ) {
    throw new Error("Civibyte link must use https://civibyte.com.");
  }
  const match = url.pathname.match(/^\/(?:c|canvassing-session)\/([^/]+)\/?$/);
  if (!match?.[1])
    throw new Error("Civibyte link does not contain a session token.");
  return decodeURIComponent(match[1]);
}

function normalizePhone(phoneNumber: string): string {
  const digits = phoneNumber.replace(/\D/g, "");
  const normalized =
    digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (normalized.length !== 10)
    throw new Error("Civibyte requires a 10-digit US phone number.");
  return normalized;
}

/** Civibyte error bodies carry the actionable reason; a bare status is not debuggable. */
async function failureDetail(response: Response): Promise<string> {
  const body = await response.text().catch(() => "");
  if (!body) return "";
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      const message = record.message ?? record.error;
      if (typeof message === "string" && message.trim()) return message.trim();
    }
  } catch {
    // Not JSON; fall through to the raw text.
  }
  return body.trim().slice(0, 300);
}

async function requestJson(
  fetchImpl: typeof fetch,
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  const response = await fetchImpl(`${CIVIBYTE_API_URL}${path}`, {
    ...init,
    cache: "no-store",
  });
  if (!response.ok) {
    const detail = await failureDetail(response);
    throw new Error(
      `Civibyte request failed (${response.status})${detail ? `: ${detail}` : ""}.`,
    );
  }
  return response.json();
}

/** Exchange a guest link and volunteer identity for a short-lived guest token. */
export async function authenticateCivibyteGuest({
  link,
  phoneNumber,
  name,
  fetchImpl = fetch,
}: PullCivibyteSessionInput): Promise<CivibyteGuestAuth> {
  const token = civibyteTokenFromLink(link);
  const phone = normalizePhone(phoneNumber);
  const headers = { "Content-Type": "application/json" };

  const phoneCheck = phoneCheckSchema.parse(
    await requestJson(fetchImpl, "/api/magic-links/check-phone", {
      method: "POST",
      headers,
      body: JSON.stringify({ phoneNumber: phone }),
    }),
  );
  const volunteerName = phoneCheck.name?.trim() || name?.trim();
  if (!volunteerName) {
    throw new Error(
      "A volunteer name is required for a phone number new to Civibyte.",
    );
  }

  const auth = authSchema.parse(
    await requestJson(fetchImpl, "/api/magic-links/validate", {
      method: "POST",
      headers,
      body: JSON.stringify({ token, name: volunteerName, phoneNumber: phone }),
    }),
  );
  if (!auth.isValid || !auth.guestToken || !auth.canvassingSessionId) {
    throw new Error("Civibyte link is invalid or expired.");
  }
  return {
    guestToken: auth.guestToken,
    canvassingSessionId: auth.canvassingSessionId,
  };
}

export async function getCivibyteSession(
  auth: CivibyteGuestAuth,
  fetchImpl: typeof fetch = fetch,
): Promise<CivibyteSession> {
  const session = await requestJson(
    fetchImpl,
    `/api/guest/canvassing/sessions/${encodeURIComponent(auth.canvassingSessionId)}`,
    { headers: { Authorization: `Bearer ${auth.guestToken}` } },
  );
  return civibyteSessionSchema.parse(session);
}

export async function getCivibyteDoorCanvass(
  auth: CivibyteGuestAuth,
  doorId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CivibyteDoorCanvass> {
  const result = await requestJson(
    fetchImpl,
    `/api/guest/canvassing/sessions/${encodeURIComponent(auth.canvassingSessionId)}/doors/${encodeURIComponent(doorId)}/canvass`,
    { headers: { Authorization: `Bearer ${auth.guestToken}` } },
  );
  return civibyteDoorCanvassSchema.parse(result);
}

/** Idempotently submit locally recorded knocks through the guest offline-sync API. */
export async function logCivibyteCanvassBatch(
  auth: CivibyteGuestAuth,
  logs: CivibyteCanvassLog[],
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  const result = await requestJson(
    fetchImpl,
    "/api/guest/canvassing/log-canvass/batch",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.guestToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(logs),
    },
  );
  return batchAckSchema.parse(result).map((ack) => ack.clientSubmissionId);
}

/** Exchange a guest link and volunteer identity for a read-only session snapshot. */
export async function pullCivibyteSession(
  input: PullCivibyteSessionInput,
): Promise<CivibyteSession> {
  const auth = await authenticateCivibyteGuest(input);
  return getCivibyteSession(auth, input.fetchImpl);
}
