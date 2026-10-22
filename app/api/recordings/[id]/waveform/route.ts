import { NextResponse } from "next/server";

import {
  isAuthorizedRequest,
  unauthorizedResponse,
} from "@/lib/device-auth";
import { ensureLibrary, getRecordingWaveform } from "@/lib/recordings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  if (!isAuthorizedRequest(request)) return unauthorizedResponse();
  await ensureLibrary();
  const { id } = await context.params;
  const waveform = await getRecordingWaveform(id);

  if (!waveform) {
    return NextResponse.json({ error: "记录不存在。" }, { status: 404 });
  }

  return NextResponse.json({ waveform });
}
