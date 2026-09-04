import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { syncBatchSchema, syncAttemptsForUser } from "@/lib/canvass/sync";

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

  const parsed = syncBatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        message: parsed.error.issues[0]?.message ?? "Invalid sync payload",
      },
      { status: 400 },
    );
  }

  const acks = await syncAttemptsForUser(user.id, parsed.data.attempts);
  return NextResponse.json({ ok: true, acks });
}
