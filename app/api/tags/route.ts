import { NextResponse } from "next/server";

import {
  isAuthorizedRequest,
  unauthorizedResponse,
} from "@/lib/device-auth";
import {
  createTag,
  deleteTag,
  ensureLibrary,
  listRecordings,
  listTags,
  renameTag,
} from "@/lib/recordings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function readJson(request: Request) {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function GET(request: Request) {
  if (!isAuthorizedRequest(request)) return unauthorizedResponse();
  await ensureLibrary();
  return NextResponse.json({ tags: listTags() });
}

export async function POST(request: Request) {
  if (!isAuthorizedRequest(request)) return unauthorizedResponse();
  await ensureLibrary();
  const body = await readJson(request);
  const tag = typeof body.name === "string" ? createTag(body.name) : "";

  if (!tag) {
    return NextResponse.json({ error: "标签名称不能为空。" }, { status: 400 });
  }

  return NextResponse.json({ tag, tags: listTags() }, { status: 201 });
}

export async function PATCH(request: Request) {
  if (!isAuthorizedRequest(request)) return unauthorizedResponse();
  await ensureLibrary();
  const body = await readJson(request);
  const from = typeof body.from === "string" ? body.from : "";
  const to = typeof body.to === "string" ? body.to : "";

  if (!from || !to) {
    return NextResponse.json({ error: "标签名称不能为空。" }, { status: 400 });
  }

  return NextResponse.json({
    tags: renameTag(from, to),
    recordings: listRecordings(),
  });
}

export async function DELETE(request: Request) {
  if (!isAuthorizedRequest(request)) return unauthorizedResponse();
  await ensureLibrary();
  const url = new URL(request.url);
  const body = await readJson(request);
  const name =
    typeof body.name === "string"
      ? body.name
      : url.searchParams.get("name") || "";

  if (!name) {
    return NextResponse.json({ error: "标签名称不能为空。" }, { status: 400 });
  }

  return NextResponse.json({
    tags: deleteTag(name),
    recordings: listRecordings(),
  });
}
