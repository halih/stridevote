import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { buildFieldPacket } from "@/lib/canvass/packet";

/** Batch Mapbox overlay can take a few seconds on larger lists. */
export const maxDuration = 60;

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, message: "Please sign in." }, { status: 401 });
  }

  const url = new URL(request.url);
  const listId = url.searchParams.get("listId");
  const programId = url.searchParams.get("programId");
  if (!listId || !programId) {
    return NextResponse.json(
      { ok: false, message: "listId and programId are required." },
      { status: 400 },
    );
  }

  const result = await buildFieldPacket({
    userId: user.id,
    listId,
    programId,
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, message: result.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, packet: result.packet });
}
