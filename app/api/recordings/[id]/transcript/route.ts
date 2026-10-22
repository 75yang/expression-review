import { NextResponse } from "next/server";

import {
  isAuthorizedRequest,
  unauthorizedResponse,
} from "@/lib/device-auth";
import { ensureLibrary, updateRecordingTranscript } from "@/lib/recordings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 900;

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  if (!isAuthorizedRequest(request)) return unauthorizedResponse();
  await ensureLibrary();
  const { id } = await context.params;

  const recording = await updateRecordingTranscript(id);
  if (!recording) {
    return NextResponse.json({ error: "记录不存在。" }, { status: 404 });
  }

  return NextResponse.json({ recording });
}
