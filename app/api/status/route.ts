import { NextResponse } from "next/server";

import {
  isAuthorizedRequest,
  unauthorizedResponse,
} from "@/lib/device-auth";
import { ensureLibrary, getProcessingStatus } from "@/lib/recordings";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!isAuthorizedRequest(request)) return unauthorizedResponse();
  await ensureLibrary();
  const status = await getProcessingStatus();

  return NextResponse.json({
    ok: true,
    ...status,
  });
}
