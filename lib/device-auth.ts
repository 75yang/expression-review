import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const DEVICE_COOKIE_NAME = "expression_training_device";
const REMOTE_ADDRESS_HEADER = "x-expression-remote-address";

type PairedDevice = {
  id: string;
  label: string;
  token_hash: string;
  created_at: string;
};

type DeviceAuthState = {
  secret: string;
  devices: PairedDevice[];
};

const AUTH_PATH = path.join(process.cwd(), ".expression-training-auth.json");
const PAIRING_WINDOW_MS = 5 * 60 * 1000;
const MAX_DEVICES = 20;
const pairingAttempts = new Map<string, { count: number; resetAt: number }>();

function createState(): DeviceAuthState {
  return {
    secret: randomBytes(32).toString("hex"),
    devices: [],
  };
}

function readState(): DeviceAuthState {
  if (!existsSync(AUTH_PATH)) {
    const state = createState();
    writeState(state);
    return state;
  }

  try {
    const parsed = JSON.parse(readFileSync(AUTH_PATH, "utf8")) as Partial<DeviceAuthState>;
    if (
      typeof parsed.secret === "string" &&
      parsed.secret.length >= 32 &&
      Array.isArray(parsed.devices)
    ) {
      return {
        secret: parsed.secret,
        devices: parsed.devices.filter(
          (device): device is PairedDevice =>
            Boolean(
              device &&
                typeof device.id === "string" &&
                typeof device.label === "string" &&
                typeof device.token_hash === "string" &&
                typeof device.created_at === "string",
            ),
        ),
      };
    }
  } catch {
    // Replace an unreadable local auth file with a new pairing identity.
  }

  const state = createState();
  writeState(state);
  return state;
}

function writeState(state: DeviceAuthState) {
  writeFileSync(AUTH_PATH, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function pairingCodeForWindow(secret: string, window: number) {
  const digest = createHmac("sha256", secret).update(String(window)).digest();
  return String(digest.readUInt32BE(0) % 1_000_000).padStart(6, "0");
}

function sameText(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function requestToken(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  if (authorization.toLowerCase().startsWith("bearer ")) {
    return authorization.slice(7).trim();
  }

  const cookieHeader = request.headers.get("cookie") || "";
  for (const part of cookieHeader.split(";")) {
    const [name, ...valueParts] = part.trim().split("=");
    if (name === DEVICE_COOKIE_NAME) {
      return decodeURIComponent(valueParts.join("="));
    }
  }
  return "";
}

function isLoopbackAddress(value: string) {
  const normalized = value.trim().replace(/^\[|\]$/g, "");
  return (
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "localhost" ||
    normalized.startsWith("::ffff:127.")
  );
}

export function isLocalRequest(request: Request) {
  return isLoopbackAddress(request.headers.get(REMOTE_ADDRESS_HEADER) || "");
}

export function isValidDeviceToken(token: string) {
  if (!token) return false;
  const tokenHash = hashToken(token);
  return readState().devices.some((device) =>
    sameText(device.token_hash, tokenHash),
  );
}

export function isAuthorizedRequest(request: Request) {
  return isLocalRequest(request) || isValidDeviceToken(requestToken(request));
}

export function unauthorizedResponse() {
  return Response.json(
    { error: "此设备尚未与电脑配对。" },
    { status: 401 },
  );
}

export function currentPairingInfo() {
  const state = readState();
  const window = Math.floor(Date.now() / PAIRING_WINDOW_MS);
  return {
    code: pairingCodeForWindow(state.secret, window),
    expires_at: new Date((window + 1) * PAIRING_WINDOW_MS).toISOString(),
    devices: state.devices.map(({ id, label, created_at }) => ({
      id,
      label,
      created_at,
    })),
  };
}

export function claimPairing(code: string, label: string) {
  const state = readState();
  const window = Math.floor(Date.now() / PAIRING_WINDOW_MS);
  const normalizedCode = code.replace(/\D/g, "").slice(0, 6);
  const matches = [window, window - 1].some((candidate) =>
    sameText(
      pairingCodeForWindow(state.secret, candidate),
      normalizedCode,
    ),
  );
  if (!matches) return null;

  const token = randomBytes(32).toString("base64url");
  const device: PairedDevice = {
    id: randomBytes(12).toString("hex"),
    label: label.trim().slice(0, 60) || "我的手机",
    token_hash: hashToken(token),
    created_at: new Date().toISOString(),
  };
  state.devices = [...state.devices.slice(-(MAX_DEVICES - 1)), device];
  writeState(state);
  return { device: { id: device.id, label: device.label }, token };
}

export function revokeDevice(id: string) {
  const state = readState();
  const nextDevices = state.devices.filter((device) => device.id !== id);
  const changed = nextDevices.length !== state.devices.length;
  if (changed) {
    state.devices = nextDevices;
    writeState(state);
  }
  return changed;
}

export function consumePairingAttempt(request: Request) {
  const key =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    new URL(request.url).hostname;
  const now = Date.now();
  const existing = pairingAttempts.get(key);
  if (!existing || existing.resetAt <= now) {
    pairingAttempts.set(key, { count: 1, resetAt: now + PAIRING_WINDOW_MS });
    return true;
  }
  if (existing.count >= 10) return false;
  existing.count += 1;
  return true;
}
