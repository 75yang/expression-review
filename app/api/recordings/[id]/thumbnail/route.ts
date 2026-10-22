import { NextResponse } from "next/server";

import {
  isAuthorizedRequest,
  unauthorizedResponse,
} from "@/lib/device-auth";
import { ensureLibrary, fileResponse, getRecording } from "@/lib/recordings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  if (!isAuthorizedRequest(request)) return unauthorizedResponse();
  await ensureLibrary();
  const { id } = await context.params;
  const recording = getRecording(id);

  if (!recording) {
    return NextResponse.json({ error: "记录不存在。" }, { status: 404 });
  }

  try {
    return await fileResponse(recording.thumbnail_path, request.headers.get("range"));
  } catch {
    return NextResponse.json({ error: "封面文件不可读取。" }, { status: 404 });
  }
}
