import { NextResponse } from "next/server";

import {
  DEVICE_COOKIE_NAME,
  isValidDeviceToken,
} from "@/lib/device-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sessionResponse(request: Request, token: string, requestedNext: unknown) {
  if (!isValidDeviceToken(token)) {
    return NextResponse.json({ error: "设备凭证无效。" }, { status: 401 });
  }

  const nextPath =
    typeof requestedNext === "string" && /^\/app(?:\/|$)/.test(requestedNext)
      ? requestedNext
      : "/app";
  const response = new NextResponse(null, {
    status: 303,
    headers: { Location: nextPath },
  });
  response.cookies.set({
    name: DEVICE_COOKIE_NAME,
    value: token,
    httpOnly: true,
    maxAge: 365 * 24 * 60 * 60,
    path: "/",
    sameSite: "strict",
    secure: new URL(request.url).protocol === "https:",
  });
  return response;
}

export async function GET(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : "";
  return sessionResponse(
    request,
    token,
    new URL(request.url).searchParams.get("next"),
  );
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    next?: unknown;
    token?: unknown;
  };
  return sessionResponse(
    request,
    typeof body.token === "string" ? body.token : "",
    body.next,
  );
}
