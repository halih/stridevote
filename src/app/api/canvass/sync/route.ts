import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { parseSyncBatch, syncAttemptsForUser } from "@/lib/canvass/sync";

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, message: "Please sign in." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Invalid JSON." }, { status: 400 });
  }

  const parsed = parseSyncBatch(body);
  if (!parsed.ok) {
    return NextResponse.json(
      { ok: false, message: parsed.message },
      { status: 400 },
    );
  }

  const acks = parsed.attempts.length
    ? await syncAttemptsForUser(user.id, parsed.attempts)
    : [];
  return NextResponse.json({
    ok: true,
    acks: [...parsed.rejected, ...acks],
  });
}
