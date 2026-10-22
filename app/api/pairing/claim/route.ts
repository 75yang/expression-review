import { NextResponse } from "next/server";

import { claimPairing, consumePairingAttempt } from "@/lib/device-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!consumePairingAttempt(request)) {
    return NextResponse.json(
      { error: "配对尝试过多，请五分钟后重试。" },
      { status: 429 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    code?: unknown;
    label?: unknown;
  };
  const result = claimPairing(
    typeof body.code === "string" ? body.code : "",
    typeof body.label === "string" ? body.label : "",
  );
  if (!result) {
    return NextResponse.json(
      { error: "配对码不正确或已经过期。" },
      { status: 401 },
    );
  }
  return NextResponse.json(result, { status: 201 });
}
