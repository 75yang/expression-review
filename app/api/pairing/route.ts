import { NextResponse } from "next/server";

import {
  currentPairingInfo,
  isLocalRequest,
  revokeDevice,
} from "@/lib/device-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isLocalRequest(request)) {
    return NextResponse.json(
      { error: "配对码只能在电脑本机查看。" },
      { status: 403 },
    );
  }
  return NextResponse.json(currentPairingInfo());
}

export async function DELETE(request: Request) {
  if (!isLocalRequest(request)) {
    return NextResponse.json(
      { error: "只能在电脑本机撤销设备。" },
      { status: 403 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    id?: unknown;
  };
  if (typeof body.id !== "string" || !revokeDevice(body.id)) {
    return NextResponse.json({ error: "设备不存在。" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, ...currentPairingInfo() });
}
