import { NextResponse } from "next/server";

import {
  isAuthorizedRequest,
  unauthorizedResponse,
} from "@/lib/device-auth";
import {
  createFillerWord,
  deleteFillerWord,
  listFillerWords,
  updateFillerWord,
} from "@/lib/recordings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isAuthorizedRequest(request)) return unauthorizedResponse();
  return NextResponse.json({
    filler_words: listFillerWords(),
  });
}

export async function POST(request: Request) {
  if (!isAuthorizedRequest(request)) return unauthorizedResponse();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体必须是 JSON。" }, { status: 400 });
  }

  const candidate = body && typeof body === "object" ? body : {};
  const record = candidate as Record<string, unknown>;

  try {
    const fillerWords = await createFillerWord({
      color: typeof record.color === "string" ? record.color : "",
      text: typeof record.text === "string" ? record.text : "",
    });
    return NextResponse.json({ filler_words: fillerWords }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "词条保存失败。" },
      { status: 400 },
    );
  }
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

  try {
    const fillerWords = await updateFillerWord({
      color: typeof record.color === "string" ? record.color : "",
      id: typeof record.id === "string" ? record.id : "",
      text: typeof record.text === "string" ? record.text : "",
    });
    return NextResponse.json({ filler_words: fillerWords });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "词条保存失败。" },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request) {
  if (!isAuthorizedRequest(request)) return unauthorizedResponse();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体必须是 JSON。" }, { status: 400 });
  }

  const candidate = body && typeof body === "object" ? body : {};
  const record = candidate as Record<string, unknown>;

  try {
    const fillerWords = await deleteFillerWord(
      typeof record.id === "string" ? record.id : "",
    );
    return NextResponse.json({ filler_words: fillerWords });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "词条删除失败。" },
      { status: 400 },
    );
  }
}
