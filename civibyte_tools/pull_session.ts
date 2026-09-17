import { pullCivibyteSession } from "../src/lib/civibyte/client";

const link = process.argv.find((arg) =>
  /^https:\/\/(?:www\.)?civibyte\.com\//i.test(arg),
);
const printJson = process.argv.includes("--json");
const phoneNumber = process.env.CIVIBYTE_GUEST_PHONE;
const name = process.env.CIVIBYTE_GUEST_NAME;

async function main() {
  if (!link || !phoneNumber) {
    console.error(
      "Usage: CIVIBYTE_GUEST_PHONE=########## npm run civibyte:pull -- <Civibyte URL> [--json]",
    );
    process.exitCode = 1;
    return;
  }

  const session = await pullCivibyteSession({ link, phoneNumber, name });
  if (printJson) {
    console.log(JSON.stringify(session, null, 2));
  } else {
    const priorAttempts = session.sessionDoors.filter(
      (door) => door.priorVisitResult || door.doorResult,
    ).length;
    const availableDoors = session.sessionDoors.filter(
      (door) => door.status === "AVAILABLE",
    ).length;
    console.log(
      JSON.stringify(
        {
          sessionId: session.canvassingSessionId,
          sessionName: session.sessionName,
          candidate: session.candidateDisplayName,
          status: session.status,
          doors: session.sessionDoors.length,
          availableDoors,
          voters: Object.keys(session.votersById).length,
          priorAttempts,
          hasScript: session.script != null,
          hasSurvey: session.survey != null,
        },
        null,
        2,
      ),
    );
  }
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Civibyte pull failed.",
  );
  process.exitCode = 1;
});
