import { test } from "node:test";
import assert from "node:assert/strict";
import { civibyteTokenFromLink, pullCivibyteSession } from "./client";

test("extracts tokens from Civibyte guest links", () => {
  assert.equal(civibyteTokenFromLink("https://civibyte.com/c/jctp69sP"), "jctp69sP");
  assert.equal(
    civibyteTokenFromLink("https://www.civibyte.com/canvassing-session/abc123"),
    "abc123",
  );
  assert.throws(() => civibyteTokenFromLink("https://example.com/c/token"));
  assert.throws(() => civibyteTokenFromLink("http://civibyte.com/c/token"));
});

test("authenticates and pulls a Civibyte session", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const session = {
    canvassingSessionId: "session-1",
    sessionName: "Test walk",
    candidateDisplayName: "Test Candidate",
    status: "ACTIVE",
    plannedStartAt: null,
    sessionLocation: null,
    sessionDoors: [
      {
        id: "door-1",
        addressPk: "address-1",
        buildingAddress: "100 Main St",
        completeAddress: "100 Main St, Seattle, WA 98101",
        latitude: 47.6,
        longitude: -122.3,
        voterPks: ["voter-1"],
        status: "AVAILABLE",
        doorResult: null,
        attemptedAt: null,
        priorVisitResult: null,
        priorVisitAttemptedAt: null,
      },
    ],
    buildings: [],
    votersById: {
      "voter-1": {
        voterPk: "voter-1",
        stateVoterId: "WA-1",
        firstName: "Ada",
        middleName: null,
        lastName: "Lovelace",
        age: 40,
        gender: "U",
      },
    },
    script: null,
    survey: null,
  };

  const responses = [
    { exists: true, name: "Known Volunteer" },
    {
      isValid: true,
      guestToken: "secret-token",
      canvassingSessionId: "session-1",
    },
    session,
  ];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init });
    return Response.json(responses.shift());
  }) as typeof fetch;

  const result = await pullCivibyteSession({
    link: "https://civibyte.com/c/link-token",
    phoneNumber: "(425) 345-4399",
    fetchImpl,
  });

  assert.equal(result.sessionDoors.length, 1);
  assert.equal(result.votersById["voter-1"]?.stateVoterId, "WA-1");
  assert.deepEqual(JSON.parse(String(requests[1]?.init?.body)), {
    token: "link-token",
    name: "Known Volunteer",
    phoneNumber: "4253454399",
  });
  assert.equal(
    new Headers(requests[2]?.init?.headers).get("Authorization"),
    "Bearer secret-token",
  );
});

test("requires a name when the phone is new to Civibyte", async () => {
  const fetchImpl = (async () =>
    Response.json({ exists: false, name: null })) as typeof fetch;

  await assert.rejects(
    pullCivibyteSession({
      link: "https://civibyte.com/c/link-token",
      phoneNumber: "4253454399",
      fetchImpl,
    }),
    /volunteer name is required/i,
  );
});
