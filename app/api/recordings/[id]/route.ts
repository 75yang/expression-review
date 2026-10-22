import { NextResponse } from "next/server";

import {
  isAuthorizedRequest,
  unauthorizedResponse,
} from "@/lib/device-auth";
import {
  deleteRecording,
  ensureLibrary,
  getRecordingDetail,
  normalizeTags,
  updateRecording,
} from "@/lib/recordings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_NOTES_LENGTH = 100_000;

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  if (!isAuthorizedRequest(request)) return unauthorizedResponse();
  await ensureLibrary();
  const { id } = await context.params;
  const recording = await getRecordingDetail(id);

  if (!recording) {
    return NextResponse.json({ error: "记录不存在。" }, { status: 404 });
  }

  return NextResponse.json({ recording });
}

export async function PATCH(request: Request, context: RouteContext) {
  if (!isAuthorizedRequest(request)) return unauthorizedResponse();
  await ensureLibrary();
  const { id } = await context.params;
  const existing = await getRecordingDetail(id);

  if (!existing) {
    return NextResponse.json({ error: "记录不存在。" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体必须是 JSON。" }, { status: 400 });
  }

  const candidate = body && typeof body === "object" ? body : {};
  const record = candidate as Record<string, unknown>;
  const title =
    typeof record.title === "string" && record.title.trim()
      ? record.title.trim().slice(0, 120)
      : existing.title;
  const notes =
    typeof record.notes === "string"
      ? record.notes.trim().slice(0, MAX_NOTES_LENGTH)
      : existing.notes;
  const tags =
    "tags" in record
      ? Array.isArray(record.tags)
        ? normalizeTags(record.tags.join(","))
        : normalizeTags(typeof record.tags === "string" ? record.tags : null)
      : existing.tags;

  const updated = updateRecording(id, {
    title,
    tags,
    notes,
  });

  return NextResponse.json({ recording: updated });
}

export async function DELETE(request: Request, context: RouteContext) {
  if (!isAuthorizedRequest(request)) return unauthorizedResponse();
  await ensureLibrary();
  const { id } = await context.params;
  const deleted = await deleteRecording(id);

  if (!deleted) {
    return NextResponse.json({ error: "记录不存在。" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
