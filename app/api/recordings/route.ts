import { NextResponse } from "next/server";

import {
  isAuthorizedRequest,
  unauthorizedResponse,
} from "@/lib/device-auth";
import {
  createRecordingFromUpload,
  defaultTitle,
  ensureLibrary,
  listRecordings,
  normalizeTags,
} from "@/lib/recordings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 900;

const configuredMaxUploadBytes = Number(process.env.MAX_UPLOAD_BYTES);
const MAX_UPLOAD_BYTES =
  Number.isFinite(configuredMaxUploadBytes) && configuredMaxUploadBytes > 0
    ? configuredMaxUploadBytes
    : 4 * 1024 * 1024 * 1024;
const MAX_UPLOAD_MB = Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024);
const MAX_NOTES_LENGTH = 100_000;

export async function GET(request: Request) {
  if (!isAuthorizedRequest(request)) return unauthorizedResponse();
  await ensureLibrary();
  const url = new URL(request.url);
  const query = url.searchParams.get("q") || "";
  return NextResponse.json({ recordings: listRecordings(query) });
}

export async function POST(request: Request) {
  if (!isAuthorizedRequest(request)) return unauthorizedResponse();
  await ensureLibrary();

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "请求必须是 multipart/form-data。" },
      { status: 400 },
    );
  }

  const file = formData.get("video");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "缺少音视频文件。" },
      { status: 400 },
    );
  }

  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  const isVideo =
    file.type.startsWith("video/") ||
    ["webm", "mp4", "mov", "m4v", "avi", "mkv"].includes(extension);
  const isAudio =
    file.type.startsWith("audio/") ||
    ["mp3", "m4a", "aac", "wav", "flac", "ogg", "opus"].includes(extension);
  if (!isVideo && !isAudio) {
    return NextResponse.json(
      { error: "上传文件必须是视频或音频。" },
      { status: 415 },
    );
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `音视频文件过大，当前限制为 ${MAX_UPLOAD_MB}MB。` },
      { status: 413 },
    );
  }

  const titleValue = formData.get("title");
  const title =
    typeof titleValue === "string" && titleValue.trim()
      ? titleValue.trim().slice(0, 120)
      : defaultTitle();
  const notesValue = formData.get("notes");
  const notes =
    typeof notesValue === "string" ? notesValue.trim().slice(0, MAX_NOTES_LENGTH) : "";
  const durationValue = Number(formData.get("duration") || 0);
  const clientUploadValue = formData.get("client_upload_id");
  const clientUploadId =
    typeof clientUploadValue === "string" ? clientUploadValue.trim() : null;
  const parentValue = formData.get("parent_id") || formData.get("parentId");
  const parentId =
    typeof parentValue === "string" && parentValue.trim()
      ? parentValue.trim()
      : null;

  try {
    const recording = await createRecordingFromUpload({
      clientUploadId,
      file,
      parentId,
      title,
      tags: normalizeTags(formData.get("tags")),
      notes,
      clientDuration: Number.isFinite(durationValue) ? durationValue : 0,
    });

    return NextResponse.json({ recording }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "保存素材失败。",
      },
      { status: 500 },
    );
  }
}
