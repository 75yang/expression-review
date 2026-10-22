import { NextResponse } from "next/server";

import {
  isAuthorizedRequest,
  unauthorizedResponse,
} from "@/lib/device-auth";
import {
  ensureLibrary,
  getProcessingStatus,
  getStorageSettings,
  listRecordings,
  listTags,
  updateMaterialLibraryRoot,
} from "@/lib/recordings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isAuthorizedRequest(request)) return unauthorizedResponse();
  await ensureLibrary();
  const status = await getProcessingStatus();

  return NextResponse.json({
    ok: true,
    settings: getStorageSettings(),
    status,
  });
}

export async function PATCH(request: Request) {
  if (!isAuthorizedRequest(request)) return unauthorizedResponse();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体必须是 JSON。" }, { status: 400 });
  }

  const candidate = body && typeof body === "object" ? body : {};
  const record = candidate as Record<string, unknown>;

  if (typeof record.materialLibraryDir !== "string") {
    return NextResponse.json({ error: "缺少素材库路径。" }, { status: 400 });
  }

  try {
    const settings = await updateMaterialLibraryRoot(record.materialLibraryDir);
    const status = await getProcessingStatus();

    return NextResponse.json({
      ok: true,
      recordings: listRecordings(),
      settings,
      status,
      tags: listTags(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "素材库路径保存失败。",
      },
      { status: 500 },
    );
  }
}
