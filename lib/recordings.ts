import "server-only";

import { exec, execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, readFileSync } from "node:fs";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import ffmpegStaticPath from "ffmpeg-static";

import type {
  FillerWord,
  RecordingDetail,
  RecordingRecord,
  RecordingView,
  TranscriptDocument,
  TranscriptSentence,
  WaveformDocument,
} from "@/lib/types";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

const globalStore = globalThis as typeof globalThis & {
  expressionTrainingDb?: DatabaseSync;
  expressionTrainingDbPath?: string;
};

type LocalSettings = {
  fillerWords?: FillerWord[];
  materialLibraryDir?: string;
};

type DbRecordingRow = {
  id: string;
  parent_id: string | null;
  client_upload_id: string | null;
  media_type: string;
  title: string;
  created_at: string;
  duration: number;
  video_path: string;
  thumbnail_path: string;
  transcript_path: string;
  tags: string;
  notes: string;
  full_text: string;
};

type ToolCheck = {
  available: boolean;
  command: string;
  error?: string;
};

type ThumbnailResult = {
  path: string;
  status: "generated" | "placeholder";
  error?: string;
};

const MAX_ASR_MS = Number(process.env.ASR_TIMEOUT_MS || 15 * 60 * 1000);
const MAX_WAVEFORM_MS = Number(process.env.WAVEFORM_TIMEOUT_MS || 5 * 60 * 1000);
const SETTINGS_PATH = path.join(process.cwd(), ".expression-training-settings.json");
const DEFAULT_FILLER_WORDS: FillerWord[] = [
  { id: "default-jiushi", text: "就是", color: "#ffe08a" },
  { id: "default-haobishuoshi", text: "好比说是", color: "#b7e4ff" },
  { id: "default-ranhou", text: "然后", color: "#c7f9cc" },
  { id: "default-zheyangzheyang", text: "这样这样", color: "#fbcfe8" },
];

let localSettingsCache: LocalSettings | null = null;

function defaultLibraryRoot() {
  const configured = process.env.MATERIAL_LIBRARY_DIR?.trim();
  if (configured) return path.resolve(configured);

  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA?.trim();
    return path.join(
      localAppData || path.join(os.homedir(), "AppData", "Local"),
      "ExpressionReview",
      "library",
    );
  }

  if (process.platform === "darwin") {
    return path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "ExpressionReview",
      "library",
    );
  }

  return path.join(
    process.env.XDG_DATA_HOME?.trim() || path.join(os.homedir(), ".local", "share"),
    "expression-review",
    "library",
  );
}

function readLocalSettings() {
  if (localSettingsCache) return localSettingsCache;

  try {
    const parsed = JSON.parse(readFileSync(SETTINGS_PATH, "utf8")) as unknown;
    const candidate = parsed && typeof parsed === "object" ? parsed : {};
    const settings = candidate as Record<string, unknown>;
    localSettingsCache = {
      fillerWords: Array.isArray(settings.fillerWords)
        ? normalizeFillerWords(settings.fillerWords)
        : DEFAULT_FILLER_WORDS,
      materialLibraryDir:
        typeof settings.materialLibraryDir === "string"
          ? settings.materialLibraryDir
          : undefined,
    };
  } catch {
    localSettingsCache = { fillerWords: DEFAULT_FILLER_WORDS };
  }

  return localSettingsCache;
}

function normalizeFillerColor(input: unknown, fallback = "#ffe08a") {
  if (typeof input === "string" && /^#[0-9a-fA-F]{6}$/.test(input)) {
    return input.toLowerCase();
  }
  return fallback;
}

function normalizeFillerText(input: unknown) {
  if (typeof input !== "string") return "";
  return input.trim().replace(/\s+/g, " ").slice(0, 32);
}

function normalizeFillerWords(input: unknown[]) {
  const seen = new Set<string>();
  return input
    .map((item, index): FillerWord | null => {
      if (!item || typeof item !== "object") return null;
      const candidate = item as Partial<FillerWord>;
      const text = normalizeFillerText(candidate.text);
      const key = text.toLowerCase();
      if (!text || seen.has(key)) return null;
      seen.add(key);
      return {
        id:
          typeof candidate.id === "string" && candidate.id.trim()
            ? candidate.id.trim().slice(0, 80)
            : `filler-${index}`,
        text,
        color: normalizeFillerColor(candidate.color),
      };
    })
    .filter((item): item is FillerWord => Boolean(item))
    .slice(0, 60);
}

async function writeLocalSettings(settings: LocalSettings) {
  const nextSettings: LocalSettings = {
    ...settings,
    fillerWords: settings.fillerWords
      ? normalizeFillerWords(settings.fillerWords)
      : [],
  };
  localSettingsCache = nextSettings;
  await writeFile(SETTINGS_PATH, JSON.stringify(nextSettings, null, 2), "utf8");
}

function normalizeLibraryRoot(input: string) {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("素材库路径不能为空。");
  return path.resolve(trimmed);
}

export function libraryRoot() {
  const settings = readLocalSettings();
  return normalizeLibraryRoot(
    settings.materialLibraryDir?.trim() || defaultLibraryRoot(),
  );
}

function libraryPathsForRoot(root: string) {
  return {
    root,
    db: path.join(root, "recordings.sqlite"),
    videos: path.join(root, "videos"),
    thumbnails: path.join(root, "thumbnails"),
    transcripts: path.join(root, "transcripts"),
    waveforms: path.join(root, "waveforms"),
  };
}

export function libraryPaths() {
  return libraryPathsForRoot(libraryRoot());
}

export function getStorageSettings() {
  return {
    material_library_dir: libraryRoot(),
    default_material_library_dir: defaultLibraryRoot(),
    settings_path: SETTINGS_PATH,
  };
}

async function verifyLibraryRoot(root: string) {
  const paths = libraryPathsForRoot(root);
  await Promise.all([
    mkdir(paths.videos, { recursive: true }),
    mkdir(paths.thumbnails, { recursive: true }),
    mkdir(paths.transcripts, { recursive: true }),
    mkdir(paths.waveforms, { recursive: true }),
  ]);

  const db = new DatabaseSync(paths.db);
  try {
    ensureSchema(db);
  } finally {
    db.close();
  }
}

export async function updateMaterialLibraryRoot(input: string) {
  const root = normalizeLibraryRoot(input);
  await verifyLibraryRoot(root);

  const nextSettings = {
    ...readLocalSettings(),
    materialLibraryDir: root,
  };
  await writeLocalSettings(nextSettings);
  await ensureLibrary();

  return getStorageSettings();
}

export function listFillerWords() {
  return readLocalSettings().fillerWords || [];
}

export async function createFillerWord({
  color,
  text,
}: {
  color: string;
  text: string;
}) {
  const cleanText = normalizeFillerText(text);
  if (!cleanText) throw new Error("词条内容不能为空。");

  const settings = readLocalSettings();
  const words = settings.fillerWords || [];
  const exists = words.some(
    (word) => word.text.toLowerCase() === cleanText.toLowerCase(),
  );
  if (exists) throw new Error("这个词条已经存在。");

  await writeLocalSettings({
    ...settings,
    fillerWords: [
      ...words,
      {
        id: randomUUID(),
        text: cleanText,
        color: normalizeFillerColor(color),
      },
    ],
  });

  return listFillerWords();
}

export async function updateFillerWord({
  color,
  id,
  text,
}: {
  color: string;
  id: string;
  text: string;
}) {
  const cleanId = typeof id === "string" ? id.trim() : "";
  const cleanText = normalizeFillerText(text);
  if (!cleanId) throw new Error("缺少词条 id。");
  if (!cleanText) throw new Error("词条内容不能为空。");

  const settings = readLocalSettings();
  const words = settings.fillerWords || [];
  const target = words.find((word) => word.id === cleanId);
  if (!target) throw new Error("词条不存在。");

  const duplicated = words.some(
    (word) =>
      word.id !== cleanId && word.text.toLowerCase() === cleanText.toLowerCase(),
  );
  if (duplicated) throw new Error("这个词条已经存在。");

  await writeLocalSettings({
    ...settings,
    fillerWords: words.map((word) =>
      word.id === cleanId
        ? {
            ...word,
            text: cleanText,
            color: normalizeFillerColor(color, word.color),
          }
        : word,
    ),
  });

  return listFillerWords();
}

export async function deleteFillerWord(id: string) {
  const cleanId = typeof id === "string" ? id.trim() : "";
  if (!cleanId) throw new Error("缺少词条 id。");

  const settings = readLocalSettings();
  const words = settings.fillerWords || [];
  await writeLocalSettings({
    ...settings,
    fillerWords: words.filter((word) => word.id !== cleanId),
  });

  return listFillerWords();
}

export async function ensureLibrary() {
  const paths = libraryPaths();
  await Promise.all([
    mkdir(paths.videos, { recursive: true }),
    mkdir(paths.thumbnails, { recursive: true }),
    mkdir(paths.transcripts, { recursive: true }),
    mkdir(paths.waveforms, { recursive: true }),
  ]);
  getDb();
  return paths;
}

function getDb() {
  const paths = libraryPaths();

  if (
    globalStore.expressionTrainingDb &&
    globalStore.expressionTrainingDbPath === paths.db
  ) {
    ensureSchema(globalStore.expressionTrainingDb);
    return globalStore.expressionTrainingDb;
  }

  if (globalStore.expressionTrainingDb) {
    try {
      globalStore.expressionTrainingDb.close();
    } catch {
      // Ignore close errors and replace the connection for the selected library.
    }
    globalStore.expressionTrainingDb = undefined;
    globalStore.expressionTrainingDbPath = undefined;
  }

  const db = new DatabaseSync(paths.db);
  ensureSchema(db);
  globalStore.expressionTrainingDb = db;
  globalStore.expressionTrainingDbPath = paths.db;
  return db;
}

function ensureSchema(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS recordings (
      id TEXT PRIMARY KEY,
      parent_id TEXT DEFAULT NULL,
      client_upload_id TEXT DEFAULT NULL,
      media_type TEXT NOT NULL DEFAULT 'video',
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      duration REAL NOT NULL DEFAULT 0,
      video_path TEXT NOT NULL,
      thumbnail_path TEXT NOT NULL,
      transcript_path TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      notes TEXT NOT NULL DEFAULT '',
      full_text TEXT NOT NULL DEFAULT ''
    );
  `);
  ensureColumn(db, "recordings", "parent_id", "TEXT DEFAULT NULL");
  ensureColumn(db, "recordings", "client_upload_id", "TEXT DEFAULT NULL");
  ensureColumn(
    db,
    "recordings",
    "media_type",
    "TEXT NOT NULL DEFAULT 'video'",
  );

  db.exec(`

    CREATE INDEX IF NOT EXISTS idx_recordings_created_at
      ON recordings(created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_recordings_parent_id
      ON recordings(parent_id);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_recordings_client_upload_id
      ON recordings(client_upload_id)
      WHERE client_upload_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS recording_tags (
      name TEXT PRIMARY KEY,
      created_at TEXT NOT NULL
    );
  `);
}

function ensureColumn(
  db: DatabaseSync,
  table: string,
  column: string,
  definition: string,
) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as {
    name: string;
  }[];
  if (columns.some((item) => item.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function safeJsonTags(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function rowToRecord(row: DbRecordingRow): RecordingRecord {
  return {
    ...row,
    duration: Number(row.duration) || 0,
    parent_id:
      typeof row.parent_id === "string" && row.parent_id.trim()
        ? row.parent_id
        : null,
    client_upload_id:
      typeof row.client_upload_id === "string" && row.client_upload_id.trim()
        ? row.client_upload_id
        : null,
    media_type: row.media_type === "audio" ? "audio" : "video",
    tags: safeJsonTags(row.tags),
  };
}

function withUrls(record: RecordingRecord): RecordingView {
  return {
    ...record,
    video_url: `/api/recordings/${record.id}/video`,
    thumbnail_url: `/api/recordings/${record.id}/thumbnail`,
  };
}

export function normalizeTags(input: FormDataEntryValue | string | null) {
  if (typeof input !== "string") return [];
  const seen = new Set<string>();
  return input
    .split(/[,，#\n]/)
    .map((tag) => tag.trim().replace(/\s+/g, " ").slice(0, 32))
    .filter(Boolean)
    .filter((tag) => {
      const key = tag.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 12);
}

function normalizeTagName(input: string) {
  return normalizeTags(input)[0] || "";
}

function recordTagCatalog(tags: string[]) {
  if (!tags.length) return;
  const db = getDb();
  const now = new Date().toISOString();
  const statement = db.prepare(
    "INSERT OR IGNORE INTO recording_tags (name, created_at) VALUES (?, ?)",
  );

  for (const tag of tags) {
    statement.run(tag, now);
  }
}

export function listTags() {
  const db = getDb();
  const explicitRows = db
    .prepare("SELECT name FROM recording_tags ORDER BY name COLLATE NOCASE ASC")
    .all() as { name: string }[];
  const recordingRows = db
    .prepare("SELECT tags FROM recordings")
    .all() as { tags: string }[];
  const merged = new Map<string, string>();

  for (const row of explicitRows) {
    const tag = normalizeTagName(row.name);
    if (tag) merged.set(tag.toLowerCase(), tag);
  }

  for (const row of recordingRows) {
    for (const tag of safeJsonTags(row.tags)) {
      const normalized = normalizeTagName(tag);
      if (normalized) merged.set(normalized.toLowerCase(), normalized);
    }
  }

  return [...merged.values()].sort((a, b) => a.localeCompare(b, "zh-CN"));
}

export function createTag(input: string) {
  const tag = normalizeTagName(input);
  if (!tag) return "";
  recordTagCatalog([tag]);
  return tag;
}

export function renameTag(fromInput: string, toInput: string) {
  const from = normalizeTagName(fromInput);
  const to = normalizeTagName(toInput);
  if (!from || !to) return listTags();

  const db = getDb();
  const rows = db.prepare("SELECT id, tags FROM recordings").all() as {
    id: string;
    tags: string;
  }[];
  const fromKey = from.toLowerCase();

  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM recording_tags WHERE lower(name) = lower(?)").run(from);
    db.prepare(
      "INSERT OR IGNORE INTO recording_tags (name, created_at) VALUES (?, ?)",
    ).run(to, new Date().toISOString());

    for (const row of rows) {
      const nextTags = normalizeTags(
        safeJsonTags(row.tags)
          .map((tag) => (tag.toLowerCase() === fromKey ? to : tag))
          .join(","),
      );
      db.prepare("UPDATE recordings SET tags = ? WHERE id = ?").run(
        JSON.stringify(nextTags),
        row.id,
      );
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return listTags();
}

export function deleteTag(input: string) {
  const tag = normalizeTagName(input);
  if (!tag) return listTags();

  const db = getDb();
  const rows = db.prepare("SELECT id, tags FROM recordings").all() as {
    id: string;
    tags: string;
  }[];
  const key = tag.toLowerCase();

  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM recording_tags WHERE lower(name) = lower(?)").run(tag);

    for (const row of rows) {
      const nextTags = safeJsonTags(row.tags).filter(
        (recordTag) => recordTag.toLowerCase() !== key,
      );
      db.prepare("UPDATE recordings SET tags = ? WHERE id = ?").run(
        JSON.stringify(nextTags),
        row.id,
      );
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return listTags();
}

export function defaultTitle() {
  const formatter = new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  return `表达练习 ${formatter.format(new Date())}`;
}

export function insertRecording(record: RecordingRecord) {
  const db = getDb();
  recordTagCatalog(record.tags);
  db.prepare(`
    INSERT INTO recordings (
      id,
      parent_id,
      client_upload_id,
      media_type,
      title,
      created_at,
      duration,
      video_path,
      thumbnail_path,
      transcript_path,
      tags,
      notes,
      full_text
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.id,
    record.parent_id,
    record.client_upload_id,
    record.media_type,
    record.title,
    record.created_at,
    record.duration,
    record.video_path,
    record.thumbnail_path,
    record.transcript_path,
    JSON.stringify(record.tags),
    record.notes,
    record.full_text,
  );
  return withUrls(record);
}

export function listRecordings(query = "") {
  const db = getDb();
  const trimmed = query.trim();
  const rows = trimmed
    ? (db
        .prepare(
          `
          SELECT * FROM recordings
          WHERE title LIKE ?
             OR tags LIKE ?
             OR full_text LIKE ?
          ORDER BY created_at DESC
        `,
        )
        .all(`%${trimmed}%`, `%${trimmed}%`, `%${trimmed}%`) as DbRecordingRow[])
    : (db
        .prepare("SELECT * FROM recordings ORDER BY created_at DESC")
        .all() as DbRecordingRow[]);

  return rows.map(rowToRecord).map(withUrls);
}

function fillerDecisionDb() {
  const db = getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS filler_decisions (
    recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
    revision TEXT NOT NULL, occurrence_key TEXT NOT NULL, decision TEXT NOT NULL,
    PRIMARY KEY(recording_id, revision, occurrence_key)
  )`);
  return db;
}

export function transcriptRevision(text: string) {
  return createHash("sha256").update(text).digest("hex");
}

export function getFillerDecisions(id: string, revision: string): Record<string, string> {
  const rows = fillerDecisionDb().prepare("SELECT occurrence_key, decision FROM filler_decisions WHERE recording_id = ? AND revision = ?").all(id, revision) as { occurrence_key: string; decision: string }[];
  return Object.fromEntries(rows.map((row) => [row.occurrence_key, row.decision]));
}

export function saveFillerDecision(id: string, revision: string, key: string, decision: string) {
  fillerDecisionDb().prepare("INSERT INTO filler_decisions (recording_id, revision, occurrence_key, decision) VALUES (?, ?, ?, ?) ON CONFLICT(recording_id, revision, occurrence_key) DO UPDATE SET decision = excluded.decision").run(id, revision, key, decision);
}

export function getRecording(id: string) {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM recordings WHERE id = ?")
    .get(id) as DbRecordingRow | undefined;
  return row ? withUrls(rowToRecord(row)) : null;
}

function getRecordingByClientUploadId(clientUploadId: string) {
  const row = getDb()
    .prepare("SELECT * FROM recordings WHERE client_upload_id = ?")
    .get(clientUploadId) as DbRecordingRow | undefined;
  return row ? withUrls(rowToRecord(row)) : null;
}

export function updateRecording(
  id: string,
  updates: Pick<RecordingRecord, "title" | "tags" | "notes">,
) {
  const db = getDb();
  recordTagCatalog(updates.tags);
  db.prepare(
    `
    UPDATE recordings
    SET title = ?, tags = ?, notes = ?
    WHERE id = ?
  `,
  ).run(updates.title, JSON.stringify(updates.tags), updates.notes, id);
  return getRecording(id);
}

async function removeFileIfPresent(filePath: string) {
  try {
    await unlink(filePath);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      if ((error as { code?: string }).code === "ENOENT") return;
    }
    throw error;
  }
}

export async function deleteRecording(id: string) {
  const record = getRecording(id);
  if (!record) return false;

  const db = getDb();
  db.prepare("UPDATE recordings SET parent_id = NULL WHERE parent_id = ?").run(id);
  db.prepare("DELETE FROM recordings WHERE id = ?").run(id);

  await Promise.allSettled([
    removeFileIfPresent(record.video_path),
    removeFileIfPresent(record.thumbnail_path),
    removeFileIfPresent(record.transcript_path),
    removeFileIfPresent(path.join(libraryPaths().waveforms, `${id}.json`)),
  ]);

  return true;
}

export async function updateRecordingTranscript(id: string) {
  const record = getRecording(id);
  if (!record) return null;

  const transcript = await createTranscript(
    record.id,
    record.video_path,
    record.transcript_path,
  );
  getDb()
    .prepare("UPDATE recordings SET full_text = ? WHERE id = ?")
    .run(transcript.full_text, id);

  return getRecordingDetail(id);
}

export async function getRecordingDetail(id: string): Promise<RecordingDetail | null> {
  const record = getRecording(id);
  if (!record) return null;
  const transcript = await readTranscript(record.transcript_path, record.id);
  return { ...record, transcript };
}

function transcriptFallback(id: string, error?: string): TranscriptDocument {
  return {
    id,
    language: "unknown",
    created_at: new Date().toISOString(),
    sentences: [],
    full_text: "",
    status: error ? "error" : "empty",
    ...(error ? { error } : {}),
  };
}

export async function readTranscript(filePath: string, id: string) {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<TranscriptDocument>;
    const sentences = normalizeSentences(parsed.sentences || []);
    return {
      id,
      language: parsed.language === "zh" ? "zh" : "unknown",
      created_at:
        typeof parsed.created_at === "string"
          ? parsed.created_at
          : new Date().toISOString(),
      sentences,
      full_text:
        typeof parsed.full_text === "string"
          ? parsed.full_text
          : sentences.map((sentence) => sentence.text).join(""),
      status:
        parsed.status === "ready" ||
        parsed.status === "empty" ||
        parsed.status === "error"
          ? parsed.status
          : sentences.length
            ? "ready"
            : "empty",
      ...(typeof parsed.error === "string" ? { error: parsed.error } : {}),
    } satisfies TranscriptDocument;
  } catch (error) {
    return transcriptFallback(
      id,
      error instanceof Error ? error.message : "Transcript JSON could not be read.",
    );
  }
}

function waveformFallback(id: string, error?: string): WaveformDocument {
  return {
    id,
    created_at: new Date().toISOString(),
    duration: 0,
    sample_rate: 0,
    peaks_per_second: 0,
    peaks: [],
    status: error ? "error" : "empty",
    ...(error ? { error } : {}),
  };
}

export async function readWaveform(filePath: string, id: string) {
  try {
    const raw = await readFile(filePath, "utf8");
    return normalizeWaveform(id, JSON.parse(raw) as Partial<WaveformDocument>);
  } catch (error) {
    return waveformFallback(
      id,
      error instanceof Error ? error.message : "Waveform JSON could not be read.",
    );
  }
}

function normalizeWaveform(
  id: string,
  input: Partial<WaveformDocument>,
): WaveformDocument {
  const peaks = Array.isArray(input.peaks)
    ? input.peaks
        .map((peak) => Number(peak))
        .filter((peak) => Number.isFinite(peak))
        .map((peak) => Math.min(Math.max(peak, 0), 1))
    : [];
  const duration = Number(input.duration);
  const sampleRate = Number(input.sample_rate);
  const peaksPerSecond = Number(input.peaks_per_second);

  return {
    id,
    created_at:
      typeof input.created_at === "string"
        ? input.created_at
        : new Date().toISOString(),
    duration: Number.isFinite(duration) ? Math.max(0, duration) : 0,
    sample_rate: Number.isFinite(sampleRate) ? Math.max(0, sampleRate) : 0,
    peaks_per_second: Number.isFinite(peaksPerSecond)
      ? Math.max(0, peaksPerSecond)
      : 0,
    peaks,
    status:
      input.status === "error"
        ? "error"
        : peaks.length
          ? "ready"
          : "empty",
    ...(typeof input.error === "string" ? { error: input.error } : {}),
  };
}

function normalizeSentences(value: unknown): TranscriptSentence[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): TranscriptSentence | null => {
      if (!item || typeof item !== "object") return null;
      const candidate = item as Partial<TranscriptSentence>;
      const start = Number(candidate.start);
      const end = Number(candidate.end);
      const text = String(candidate.text || "").trim();
      if (!Number.isFinite(start) || !Number.isFinite(end) || !text) return null;
      return {
        start: Math.max(0, start),
        end: Math.max(Math.max(0, start), end),
        text,
      };
    })
    .filter((item): item is TranscriptSentence => Boolean(item));
}

function normalizeTranscript(
  id: string,
  input: Partial<TranscriptDocument>,
): TranscriptDocument {
  const sentences = normalizeSentences(input.sentences || []);
  const fullText =
    typeof input.full_text === "string" && input.full_text.trim()
      ? input.full_text.trim()
      : sentences.map((sentence) => sentence.text).join("");

  return {
    id,
    language: input.language === "zh" ? "zh" : "unknown",
    created_at:
      typeof input.created_at === "string"
        ? input.created_at
        : new Date().toISOString(),
    sentences,
    full_text: fullText,
    status:
      input.status === "error"
        ? "error"
        : sentences.length
          ? "ready"
          : "empty",
    ...(typeof input.error === "string" ? { error: input.error } : {}),
  };
}

function ffmpegCommand() {
  return process.env.FFMPEG_PATH || ffmpegStaticPath || "ffmpeg";
}

function ffprobeCommand() {
  return process.env.FFPROBE_PATH || "ffprobe";
}

type MediaInspection = {
  duration: number;
  videoCodec: string | null;
};

function commandErrorOutput(error: unknown) {
  if (!(error instanceof Error)) return "";
  const commandError = error as Error & {
    stderr?: string | Buffer;
    stdout?: string | Buffer;
  };
  return [
    commandError.stderr?.toString(),
    commandError.stdout?.toString(),
    commandError.message,
  ]
    .filter(Boolean)
    .join("\n");
}

function durationFromFfmpegOutput(output: string) {
  const match = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i.exec(output);
  if (!match) return 0;
  const duration =
    Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  return Number.isFinite(duration) ? duration : 0;
}

async function inspectMedia(filePath: string): Promise<MediaInspection> {
  let output = "";

  try {
    await execFileAsync(ffmpegCommand(), ["-hide_banner", "-i", filePath], {
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch (error) {
    output = commandErrorOutput(error);
  }

  const videoMatch = /Video:\s*([^,\s]+)/i.exec(output);
  return {
    duration: durationFromFfmpegOutput(output),
    videoCodec: videoMatch?.[1]?.toLowerCase() || null,
  };
}

async function removeIfPresent(filePath: string) {
  try {
    await unlink(filePath);
  } catch {
    // Cleanup is best-effort for a temporary or superseded media file.
  }
}

async function ensureBrowserCompatibleVideo(videoPath: string, id: string) {
  const extension = path.extname(videoPath).toLowerCase();
  if (![".mov", ".m4v", ".mp4"].includes(extension)) return videoPath;

  const inspection = await inspectMedia(videoPath);
  const needsH264Transcode = ["hevc", "h265"].includes(
    inspection.videoCodec || "",
  );
  const needsMp4Container = extension === ".mov" || extension === ".m4v";
  if (!needsH264Transcode && !needsMp4Container) return videoPath;

  const target =
    extension === ".mp4"
      ? path.join(path.dirname(videoPath), `${id}-browser.mp4`)
      : path.join(path.dirname(videoPath), `${id}.mp4`);
  const temporary = path.join(
    path.dirname(videoPath),
    `${id}-${randomUUID()}.converting.mp4`,
  );
  const codecArgs = needsH264Transcode
    ? [
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "22",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "160k",
      ]
    : ["-c", "copy"];

  try {
    await execFileAsync(
      ffmpegCommand(),
      [
        "-y",
        "-i",
        videoPath,
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        ...codecArgs,
        "-movflags",
        "+faststart",
        temporary,
      ],
      {
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
      },
    );
    const outputStats = await stat(temporary);
    if (outputStats.size <= 0) throw new Error("兼容视频文件为空。");

    await rename(temporary, target);
    await removeIfPresent(videoPath);
    return target;
  } catch (error) {
    await removeIfPresent(temporary);
    console.error("Failed to prepare browser-compatible video:", error);
    return videoPath;
  }
}

export async function checkTool(command: string, args = ["-version"]): Promise<ToolCheck> {
  try {
    await execFileAsync(command, args, { timeout: 5000 });
    return { available: true, command };
  } catch (error) {
    return {
      available: false,
      command,
      error: error instanceof Error ? error.message : "Tool check failed.",
    };
  }
}

export async function getProcessingStatus() {
  const [ffmpeg, ffprobe, defaultAsr] = await Promise.all([
    checkTool(ffmpegCommand()),
    checkTool(ffprobeCommand()),
    checkTool(process.env.PYTHON || "python", ["-c", "import faster_whisper"]),
  ]);
  return {
    library: libraryPaths(),
    ffmpeg,
    ffprobe,
    asr: {
      configured: Boolean(process.env.ASR_COMMAND) || defaultAsr.available,
      command: process.env.ASR_COMMAND || defaultAsrDescription(),
      dependency: defaultAsr,
      model: process.env.ASR_MODEL || "small",
      device: process.env.ASR_DEVICE || "cpu",
      compute_type: process.env.ASR_COMPUTE_TYPE || "int8",
      timeout_ms: MAX_ASR_MS,
    },
  };
}

function mediaTypeFromUpload(file: File): "video" | "audio" {
  const extension = path.extname(file.name).toLowerCase();
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  if (
    [".mp3", ".m4a", ".aac", ".wav", ".flac", ".ogg", ".opus"].includes(
      extension,
    )
  ) {
    return "audio";
  }
  return "video";
}

function extensionFromMime(mimeType: string, mediaType: "video" | "audio") {
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
  if (mediaType === "audio" && mimeType.includes("mp4")) return "m4a";
  if (mimeType.includes("aac")) return "aac";
  if (mimeType.includes("flac")) return "flac";
  if (mimeType.includes("opus")) return "opus";
  if (mimeType.includes("ogg")) return mediaType === "audio" ? "ogg" : "ogv";
  if (mimeType.includes("mp4")) return "mp4";
  if (mimeType.includes("quicktime")) return "mov";
  return "webm";
}

function mediaFileName(id: string, file: File, mediaType: "video" | "audio") {
  const originalExtension = path.extname(file.name).toLowerCase().slice(1);
  const supportedExtensions =
    mediaType === "video"
      ? new Set(["webm", "mp4", "mov", "m4v", "avi", "mkv", "ogv"])
      : new Set(["mp3", "m4a", "aac", "wav", "flac", "ogg", "opus"]);
  const extension = supportedExtensions.has(originalExtension)
    ? originalExtension
    : extensionFromMime(file.type, mediaType);
  return `${id}.${extension}`;
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function writePlaceholderThumbnail(
  filePath: string,
  title: string,
  message: string,
  mediaType: "video" | "audio" = "video",
) {
  const visual =
    mediaType === "audio"
      ? `<g fill="#16875d">
  <rect x="382" y="278" width="12" height="40" rx="6"/>
  <rect x="408" y="250" width="12" height="96" rx="6"/>
  <rect x="434" y="266" width="12" height="64" rx="6"/>
  <rect x="460" y="226" width="12" height="144" rx="6"/>
  <rect x="486" y="258" width="12" height="80" rx="6"/>
  <rect x="512" y="242" width="12" height="112" rx="6"/>
  <rect x="538" y="274" width="12" height="48" rx="6"/>
  <rect x="564" y="262" width="12" height="72" rx="6"/>
</g>`
      : `<circle cx="480" cy="288" r="74" fill="#ffffff" stroke="#d8dde6" stroke-width="2"/>
  <path d="M455 246 L455 330 L530 288 Z" fill="#2f6fed"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540">
  <rect width="960" height="540" fill="#f4f5f7"/>
  <rect x="0" y="0" width="960" height="88" fill="#20242b"/>
  <text x="42" y="57" font-family="Arial, sans-serif" font-size="28" font-weight="700" fill="#ffffff">${escapeXml(title)}</text>
  ${visual}
  <text x="480" y="420" text-anchor="middle" font-family="Arial, sans-serif" font-size="22" fill="#687180">${escapeXml(message)}</text>
</svg>`;
  await writeFile(filePath, svg, "utf8");
}

async function generateAudioThumbnail(
  id: string,
  title: string,
): Promise<ThumbnailResult> {
  const target = path.join(libraryPaths().thumbnails, `${id}.svg`);
  await writePlaceholderThumbnail(target, title, "音频素材", "audio");
  return { path: target, status: "placeholder" };
}

export async function generateThumbnail(
  videoPath: string,
  id: string,
  title: string,
): Promise<ThumbnailResult> {
  const paths = libraryPaths();
  const target = path.join(paths.thumbnails, `${id}.jpg`);
  const placeholder = path.join(paths.thumbnails, `${id}.svg`);
  const command = ffmpegCommand();

  try {
    await execFileAsync(command, [
      "-y",
      "-ss",
      "00:00:01",
      "-i",
      videoPath,
      "-frames:v",
      "1",
      "-vf",
      "scale=960:-1",
      target,
    ]);
    return { path: target, status: "generated" };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "ffmpeg could not generate the thumbnail.";
    await writePlaceholderThumbnail(
      placeholder,
      title,
      "未生成视频封面：请配置 FFMPEG_PATH 或安装 ffmpeg",
    );
    return { path: placeholder, status: "placeholder", error: message };
  }
}

export async function getDuration(videoPath: string, clientDuration: number) {
  if (Number.isFinite(clientDuration) && clientDuration > 0) {
    return clientDuration;
  }

  try {
    const { stdout } = await execFileAsync(ffprobeCommand(), [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      videoPath,
    ]);
    const duration = Number(stdout.trim());
    return Number.isFinite(duration) ? duration : 0;
  } catch {
    return (await inspectMedia(videoPath)).duration;
  }
}

function quoteForShell(value: string) {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function defaultAsrDescription() {
  return `${process.env.PYTHON || "python"} scripts/asr_faster_whisper.py`;
}

async function runConfiguredAsr(inputPath: string, outputPath: string) {
  const configured = process.env.ASR_COMMAND;
  if (!configured) return false;

  const command = configured
    .replace(/\{input\}/g, quoteForShell(inputPath))
    .replace(/\{output\}/g, quoteForShell(outputPath));
  await execAsync(command, {
    cwd: process.cwd(),
    timeout: MAX_ASR_MS,
    windowsHide: true,
  });
  return true;
}

async function runDefaultAsr(inputPath: string, outputPath: string) {
  const python = process.env.PYTHON || "python";
  const cudaPath = process.env.ASR_CUDA_PATH?.trim();
  await execFileAsync(
    python,
    [
      path.join(process.cwd(), "scripts", "asr_faster_whisper.py"),
      "--input",
      inputPath,
      "--output",
      outputPath,
      "--model",
      process.env.ASR_MODEL || "small",
      "--device",
      process.env.ASR_DEVICE || "cpu",
      "--compute-type",
      process.env.ASR_COMPUTE_TYPE || "int8",
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HF_HUB_DISABLE_XET: process.env.HF_HUB_DISABLE_XET || "1",
        PATH: cudaPath
          ? `${cudaPath}${path.delimiter}${process.env.PATH || ""}`
          : process.env.PATH,
      },
      timeout: MAX_ASR_MS,
      windowsHide: true,
    },
  );
}

async function runDefaultWaveform(inputPath: string, outputPath: string) {
  const python = process.env.PYTHON || "python";
  await execFileAsync(
    python,
    [
      path.join(process.cwd(), "scripts", "waveform_pyav.py"),
      "--input",
      inputPath,
      "--output",
      outputPath,
      "--peaks-per-second",
      process.env.WAVEFORM_PEAKS_PER_SECOND || "80",
    ],
    {
      cwd: process.cwd(),
      timeout: MAX_WAVEFORM_MS,
      windowsHide: true,
    },
  );
}

export async function createTranscript(
  id: string,
  videoPath: string,
  transcriptPath: string,
) {
  let transcript: TranscriptDocument;

  try {
    const usedConfigured = await runConfiguredAsr(videoPath, transcriptPath);
    if (!usedConfigured) {
      await runDefaultAsr(videoPath, transcriptPath);
    }
    transcript = normalizeTranscript(
      id,
      JSON.parse(await readFile(transcriptPath, "utf8")) as Partial<TranscriptDocument>,
    );
  } catch (error) {
    transcript = transcriptFallback(
      id,
      error instanceof Error
        ? error.message
        : "ASR model command failed to produce a transcript.",
    );
  }

  await writeFile(transcriptPath, JSON.stringify(transcript, null, 2), "utf8");
  return transcript;
}

export async function createWaveform(
  id: string,
  videoPath: string,
  waveformPath: string,
) {
  let waveform: WaveformDocument;

  try {
    await runDefaultWaveform(videoPath, waveformPath);
    waveform = normalizeWaveform(
      id,
      JSON.parse(await readFile(waveformPath, "utf8")) as Partial<WaveformDocument>,
    );
  } catch (error) {
    waveform = waveformFallback(
      id,
      error instanceof Error
        ? error.message
        : "Waveform command failed to read audio.",
    );
  }

  await writeFile(waveformPath, JSON.stringify(waveform, null, 2), "utf8");
  return waveform;
}

export async function getRecordingWaveform(id: string) {
  const record = getRecording(id);
  if (!record) return null;

  const waveformPath = path.join(libraryPaths().waveforms, `${id}.json`);

  try {
    await stat(waveformPath);
    return await readWaveform(waveformPath, id);
  } catch {
    return createWaveform(id, record.video_path, waveformPath);
  }
}

export async function createRecordingFromUpload({
  clientUploadId,
  file,
  parentId,
  title,
  tags,
  notes,
  clientDuration,
}: {
  clientUploadId?: string | null;
  file: File;
  parentId?: string | null;
  title: string;
  tags: string[];
  notes: string;
  clientDuration: number;
}) {
  const paths = await ensureLibrary();
  const normalizedClientUploadId =
    typeof clientUploadId === "string" && /^[A-Za-z0-9_-]{8,100}$/.test(clientUploadId)
      ? clientUploadId
      : null;
  const existingUpload = normalizedClientUploadId
    ? getRecordingByClientUploadId(normalizedClientUploadId)
    : null;
  if (existingUpload) return existingUpload;

  const id = randomUUID();
  const normalizedParentId =
    typeof parentId === "string" && parentId.trim() ? parentId.trim() : null;
  const parent = normalizedParentId ? getRecording(normalizedParentId) : null;
  const createdAt = new Date().toISOString();
  const mediaType = mediaTypeFromUpload(file);
  let videoPath = path.join(paths.videos, mediaFileName(id, file, mediaType));
  const transcriptPath = path.join(paths.transcripts, `${id}.json`);
  const buffer = Buffer.from(await file.arrayBuffer());

  await writeFile(videoPath, buffer);
  if (mediaType === "video") {
    videoPath = await ensureBrowserCompatibleVideo(videoPath, id);
  }

  const duration = await getDuration(videoPath, clientDuration);
  const thumbnail =
    mediaType === "audio"
      ? await generateAudioThumbnail(id, title)
      : await generateThumbnail(videoPath, id, title);
  const transcript = await createTranscript(id, videoPath, transcriptPath);

  return insertRecording({
    id,
    parent_id: parent?.id || null,
    client_upload_id: normalizedClientUploadId,
    media_type: mediaType,
    title,
    created_at: createdAt,
    duration,
    video_path: videoPath,
    thumbnail_path: thumbnail.path,
    transcript_path: transcriptPath,
    tags,
    notes,
    full_text: transcript.full_text,
  });
}

export async function fileResponse(
  filePath: string,
  rangeHeader: string | null,
  mediaType: "video" | "audio" = "video",
) {
  const stats = await stat(filePath);
  const headers = new Headers();
  const ext = path.extname(filePath).toLowerCase();
  headers.set("Content-Type", contentType(ext, mediaType));
  headers.set("Accept-Ranges", "bytes");

  if (rangeHeader) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
    if (match) {
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Number(match[2]) : stats.size - 1;
      const safeStart = Math.min(Math.max(0, start), stats.size - 1);
      const safeEnd = Math.min(Math.max(safeStart, end), stats.size - 1);
      headers.set("Content-Range", `bytes ${safeStart}-${safeEnd}/${stats.size}`);
      headers.set("Content-Length", String(safeEnd - safeStart + 1));
      return new Response(safeFileStream(filePath, { start: safeStart, end: safeEnd }), {
        status: 206,
        headers,
      });
    }
  }

  headers.set("Content-Length", String(stats.size));
  return new Response(safeFileStream(filePath), { headers });
}

function safeFileStream(
  filePath: string,
  options?: { start?: number; end?: number },
) {
  let fileStream: ReturnType<typeof createReadStream> | null = null;
  let closed = false;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      fileStream = createReadStream(filePath, options);

      fileStream.on("data", (chunk) => {
        if (closed) return;

        try {
          controller.enqueue(new Uint8Array(chunk as Buffer));
        } catch {
          closed = true;
          fileStream?.destroy();
        }
      });

      fileStream.on("end", () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // The browser may abort media range requests during scrubbing.
        }
      });

      fileStream.on("error", (streamError) => {
        if (closed) return;
        closed = true;
        try {
          controller.error(streamError);
        } catch {
          // The response was already canceled.
        }
      });
    },
    cancel() {
      closed = true;
      fileStream?.destroy();
    },
  });
}

function contentType(ext: string, mediaType: "video" | "audio") {
  switch (ext) {
    case ".webm":
      return mediaType === "audio" ? "audio/webm" : "video/webm";
    case ".mp4":
      return mediaType === "audio" ? "audio/mp4" : "video/mp4";
    case ".mov":
      return "video/quicktime";
    case ".m4a":
      return "audio/mp4";
    case ".mp3":
      return "audio/mpeg";
    case ".wav":
      return "audio/wav";
    case ".aac":
      return "audio/aac";
    case ".flac":
      return "audio/flac";
    case ".ogg":
      return "audio/ogg";
    case ".opus":
      return "audio/opus";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}
