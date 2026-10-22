"use client";

import Link from "next/link";
import { useWorkspaceView } from "@/components/AppShell";
import {
  type ChangeEvent,
  type CSSProperties,
  type FormEvent,
  type MouseEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import type { FillerWord, RecordingView } from "@/lib/types";

type ProcessingStatus = {
  library: {
    root: string;
    videos: string;
    thumbnails: string;
    transcripts: string;
  };
  ffmpeg: {
    available: boolean;
    command: string;
    error?: string;
  };
  asr: {
    configured: boolean;
    command: string;
    model?: string;
    timeout_ms: number;
  };
};

const mimeCandidates = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  "video/mp4",
];

const ALL_TAGS = "__all__";
const UNTAGGED = "__untagged__";
const RECORD_LIST_POSITION_KEY = "expression-training:record-list-position";
const LIBRARY_FILTER_KEY = "expression-training:library-filter";
const FILLER_COLORS = [
  "#ffe08a",
  "#b7e4ff",
  "#c7f9cc",
  "#fbcfe8",
  "#ddd6fe",
  "#fed7aa",
  "#fecaca",
  "#bfdbfe",
];

type FillerWordDraft = {
  color: string;
  text: string;
};

type RecordingTreeNode = {
  children: RecordingTreeNode[];
  depth: number;
  record: RecordingView;
  rootIndex: number | null;
};

type RecordingUploadDraft = {
  filename: string;
  notes: string;
  parent: RecordingView | null;
  tags: string;
  title: string;
};

type FailedRecordingBackup = {
  blob: Blob;
  draft: RecordingUploadDraft;
  duration: number;
  error: string;
  size: number;
  url: string;
};

type PairingInfo = {
  code: string;
  expires_at: string;
  devices: {
    id: string;
    label: string;
    created_at: string;
  }[];
};

type RecordListPosition = {
  pageScrollTop: number;
  recordingId: string;
  scrollTop: number;
};

function parseTagInput(value: string) {
  const seen = new Set<string>();
  return value
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

function mergeTags(...groups: string[][]) {
  const merged = new Map<string, string>();
  for (const group of groups) {
    for (const tag of group) {
      const clean = tag.trim();
      if (clean) merged.set(clean.toLowerCase(), clean);
    }
  }
  return [...merged.values()].sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function recordingTimestamp(record: RecordingView) {
  const timestamp = Date.parse(record.created_at);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function buildRecordingTree(records: RecordingView[]) {
  const nodeMap = new Map<string, RecordingTreeNode>();
  const roots: RecordingTreeNode[] = [];

  for (const record of records) {
    nodeMap.set(record.id, { children: [], depth: 0, record, rootIndex: null });
  }

  for (const node of nodeMap.values()) {
    const parent =
      node.record.parent_id && node.record.parent_id !== node.record.id
        ? nodeMap.get(node.record.parent_id)
        : null;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  function sortAndDepth(nodes: RecordingTreeNode[], depth: number) {
    nodes.sort(
      (left, right) =>
        recordingTimestamp(right.record) - recordingTimestamp(left.record),
    );
    nodes.forEach((node, index) => {
      node.depth = depth;
      node.rootIndex = depth === 0 ? nodes.length - index : null;
      sortAndDepth(node.children, depth + 1);
    });
  }

  sortAndDepth(roots, 0);
  return roots;
}

function flattenRecordingTree(
  nodes: RecordingTreeNode[],
  collapsedIds: Set<string>,
) {
  const visible: RecordingTreeNode[] = [];

  function visit(node: RecordingTreeNode) {
    visible.push(node);
    if (collapsedIds.has(node.record.id)) return;
    for (const child of node.children) visit(child);
  }

  for (const node of nodes) visit(node);
  return visible;
}

export function RecorderLibrary() {
  const workspaceView = useWorkspaceView();
  const [records, setRecords] = useState<RecordingView[]>([]);
  const [libraryLoadState, setLibraryLoadState] = useState<"loading" | "ready" | "failed">("loading");
  const [status, setStatus] = useState<ProcessingStatus | null>(null);
  const [query, setQuery] = useState("");
  const [filtersRestored, setFiltersRestored] = useState(false);
  const [knownTags, setKnownTags] = useState<string[]>([]);
  const [activeTag, setActiveTag] = useState(ALL_TAGS);
  const [newTag, setNewTag] = useState("");
  const [tagDrafts, setTagDrafts] = useState<Record<string, string>>({});
  const [tagBusy, setTagBusy] = useState("");
  const [fillerWords, setFillerWords] = useState<FillerWord[]>([]);
  const [fillerDrafts, setFillerDrafts] = useState<
    Record<string, FillerWordDraft>
  >({});
  const [newFillerText, setNewFillerText] = useState("");
  const [newFillerColor, setNewFillerColor] = useState(FILLER_COLORS[0]);
  const [fillerBusy, setFillerBusy] = useState("");
  const [fillerError, setFillerError] = useState("");
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState("");
  const [notes, setNotes] = useState("");
  const [libraryDraft, setLibraryDraft] = useState("");
  const [librarySaving, setLibrarySaving] = useState(false);
  const [libraryMessage, setLibraryMessage] = useState("");
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [recordBusyId, setRecordBusyId] = useState("");
  const [libraryFeedback, setLibraryFeedback] = useState("");
  const [secondaryParent, setSecondaryParent] = useState<RecordingView | null>(null);
  const [collapsedRecordIds, setCollapsedRecordIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  const [failedRecordingBackup, setFailedRecordingBackup] =
    useState<FailedRecordingBackup | null>(null);
  const [previewActive, setPreviewActive] = useState(false);
  const [pairingInfo, setPairingInfo] = useState<PairingInfo | null>(null);
  const [pairingBusy, setPairingBusy] = useState("");

  const tagManagerRef = useRef<HTMLDialogElement | null>(null);
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const recordListRef = useRef<HTMLDivElement | null>(null);
  const pendingRecordListPositionRef = useRef<RecordListPosition | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const failedBackupUrlRef = useRef<string | null>(null);
  const startedAtRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    try {
      const stored = window.sessionStorage.getItem(RECORD_LIST_POSITION_KEY);
      if (stored) {
        pendingRecordListPositionRef.current = JSON.parse(
          stored,
        ) as RecordListPosition;
      }
    } catch {
      window.sessionStorage.removeItem(RECORD_LIST_POSITION_KEY);
    }

    const restoreFilters = window.setTimeout(() => {
      try {
        const storedFilters = window.sessionStorage.getItem(LIBRARY_FILTER_KEY);
        if (storedFilters) {
          const filters = JSON.parse(storedFilters) as { query?: string; tag?: string };
          if (typeof filters.query === "string") setQuery(filters.query);
          if (typeof filters.tag === "string") setActiveTag(filters.tag);
        }
      } catch {
        window.sessionStorage.removeItem(LIBRARY_FILTER_KEY);
      }
      setFiltersRestored(true);
    }, 0);

    return () => {
      window.clearTimeout(restoreFilters);
      if (failedBackupUrlRef.current) {
        URL.revokeObjectURL(failedBackupUrlRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!filtersRestored) return;
    window.sessionStorage.setItem(
      LIBRARY_FILTER_KEY,
      JSON.stringify({ query, tag: activeTag }),
    );
  }, [activeTag, filtersRestored, query]);

  useEffect(() => {
    if (!recording) return;

    const timer = window.setInterval(() => {
      setElapsed((performance.now() - startedAtRef.current) / 1000);
    }, 250);

    return () => window.clearInterval(timer);
  }, [recording]);

  const tagOptions = useMemo(
    () => mergeTags(knownTags, records.flatMap((record) => record.tags)),
    [knownTags, records],
  );
  const selectedTag =
    activeTag === ALL_TAGS || activeTag === UNTAGGED || tagOptions.includes(activeTag)
      ? activeTag
      : ALL_TAGS;
  const libraryPathChanged =
    libraryDraft.trim() !== "" && libraryDraft.trim() !== (status?.library.root || "");

  const filteredRecords = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return records.filter((record) => {
      const tagMatched =
        selectedTag === ALL_TAGS
          ? true
          : selectedTag === UNTAGGED
            ? record.tags.length === 0
            : record.tags.includes(selectedTag);

      if (!tagMatched) return false;
      if (!needle) return true;

      const haystack = [
        record.title,
        record.tags.join(" "),
        record.full_text,
        record.notes,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [query, records, selectedTag]);
  const recordTree = useMemo(
    () => buildRecordingTree(filteredRecords),
    [filteredRecords],
  );
  const visibleRecordNodes = useMemo(
    () => flattenRecordingTree(recordTree, collapsedRecordIds),
    [collapsedRecordIds, recordTree],
  );

  useEffect(() => {
    const position = pendingRecordListPositionRef.current;
    const list = recordListRef.current;
    if (!position || !list || visibleRecordNodes.length === 0) return;

    const frame = window.requestAnimationFrame(() => {
      const item = list.querySelector<HTMLElement>(
        `[data-recording-id="${position.recordingId}"]`,
      );

      list.scrollTop = position.scrollTop;
      window.scrollTo({ top: position.pageScrollTop });

      if (item) {
        const listRect = list.getBoundingClientRect();
        const itemRect = item.getBoundingClientRect();
        const itemIsVisible =
          itemRect.top >= listRect.top && itemRect.bottom <= listRect.bottom;
        if (!itemIsVisible) {
          list.scrollTop = Math.max(
            0,
            list.scrollTop +
              itemRect.top -
              listRect.top -
              (list.clientHeight - item.clientHeight) / 2,
          );
        }
      }

      pendingRecordListPositionRef.current = null;
      window.sessionStorage.removeItem(RECORD_LIST_POSITION_KEY);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [visibleRecordNodes]);

  function rememberRecordListPosition(recordingId: string) {
    const position: RecordListPosition = {
      pageScrollTop: window.scrollY,
      recordingId,
      scrollTop: recordListRef.current?.scrollTop || 0,
    };
    window.sessionStorage.setItem(
      RECORD_LIST_POSITION_KEY,
      JSON.stringify(position),
    );
  }

  function applyRecordUpdate(recording: RecordingView) {
    setRecords((current) =>
      current.map((record) => (record.id === recording.id ? recording : record)),
    );
    setSecondaryParent((current) =>
      current?.id === recording.id ? recording : current,
    );
    setKnownTags((current) => mergeTags(current, recording.tags));
  }

  function toggleRecordCollapse(id: string) {
    setCollapsedRecordIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function prepareSecondaryRecording(record: RecordingView) {
    setSecondaryParent(record);
    setCollapsedRecordIds((current) => {
      const next = new Set(current);
      next.delete(record.id);
      return next;
    });
    setTitle((current) =>
      current.trim() ? current : `二级录制 - ${record.title}`.slice(0, 120),
    );
    setTags((current) => (current.trim() ? current : record.tags.join(", ")));
    setError("");
    window.scrollTo({ behavior: "smooth", top: 0 });
  }

  function extensionFromBlob(blob: Blob) {
    const containerType = blob.type.split(";", 1)[0]?.toLowerCase() || "";

    if (containerType.startsWith("video/")) {
      if (containerType.includes("quicktime")) return "mov";
      if (containerType.includes("mp4")) return "mp4";
      if (containerType.includes("ogg")) return "ogv";
      return "webm";
    }

    if (containerType.includes("wav")) return "wav";
    if (containerType.includes("mpeg") || containerType.includes("mp3")) {
      return "mp3";
    }
    if (containerType.includes("mp4")) return "m4a";
    if (containerType.includes("aac")) return "aac";
    if (containerType.includes("flac")) return "flac";
    if (containerType.includes("opus")) return "opus";
    if (containerType.includes("ogg")) return "ogg";
    return "webm";
  }

  function createUploadDraft(
    blob: Blob,
    sourceFilename = "",
  ): RecordingUploadDraft {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fallbackFilename = `recording-${timestamp}.${extensionFromBlob(blob)}`;
    const cleanFilename =
      sourceFilename.trim().replace(/[\\/:*?"<>|]+/g, "-").slice(0, 180) ||
      fallbackFilename;
    const filenameTitle = sourceFilename
      .trim()
      .replace(/\.[^.]+$/, "")
      .slice(0, 120);
    return {
      filename: cleanFilename,
      notes: notes.trim(),
      parent: secondaryParent,
      tags: tags.trim(),
      title: title.trim() || filenameTitle,
    };
  }

  function clearFailedRecordingBackup() {
    if (failedBackupUrlRef.current) {
      URL.revokeObjectURL(failedBackupUrlRef.current);
      failedBackupUrlRef.current = null;
    }
    setFailedRecordingBackup(null);
  }

  function discardFailedRecordingBackup() {
    if (!failedRecordingBackup) return;
    const confirmed = window.confirm(
      "清除这段临时素材？清除后无法从页面恢复。",
    );
    if (confirmed) clearFailedRecordingBackup();
  }

  function keepFailedRecordingBackup({
    blob,
    draft,
    duration,
    message,
  }: {
    blob: Blob;
    draft: RecordingUploadDraft;
    duration: number;
    message: string;
  }) {
    let url =
      failedRecordingBackup?.blob === blob ? failedRecordingBackup.url : "";
    if (!url) {
      if (failedBackupUrlRef.current) {
        URL.revokeObjectURL(failedBackupUrlRef.current);
      }
      url = URL.createObjectURL(blob);
      failedBackupUrlRef.current = url;
    }

    setFailedRecordingBackup({
      blob,
      draft,
      duration,
      error: message,
      size: blob.size,
      url,
    });
  }

  function retryFailedRecordingBackup() {
    if (!failedRecordingBackup || processing || recording) return;
    setProcessing(true);
    setError("");
    void uploadRecording(
      failedRecordingBackup.blob,
      failedRecordingBackup.duration,
      failedRecordingBackup.draft,
    );
  }

  function openUploadPicker() {
    setError("");
    if (failedRecordingBackup) {
      setError("请先下载备份、重试保存或清除上一段保存失败的临时素材。");
      return;
    }
    uploadInputRef.current?.click();
  }

  async function handleUploadSelection(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;

    const extension = file.name.split(".").pop()?.toLowerCase() || "";
    const supported =
      file.type.startsWith("video/") ||
      file.type.startsWith("audio/") ||
      [
        "webm",
        "mp4",
        "mov",
        "m4v",
        "avi",
        "mkv",
        "mp3",
        "m4a",
        "aac",
        "wav",
        "flac",
        "ogg",
        "opus",
      ].includes(extension);

    if (!supported) {
      setError("请选择视频或音频文件。");
      return;
    }

    setError("");
    setElapsed(0);
    setProcessing(true);
    await uploadRecording(file, 0, createUploadDraft(file, file.name));
  }

  async function saveLibraryPath(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const materialLibraryDir = libraryDraft.trim();
    if (!materialLibraryDir || librarySaving) return;

    setError("");
    setLibraryMessage("");
    setLibrarySaving(true);

    try {
      const response = await fetch("/api/settings", {
        body: JSON.stringify({ materialLibraryDir }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      });
      const payload = (await response.json()) as {
        recordings?: RecordingView[];
        status?: ProcessingStatus;
        tags?: string[];
        error?: string;
      };

      if (!response.ok || !payload.status) {
        throw new Error(payload.error || "素材库路径保存失败。");
      }

      setStatus(payload.status);
      setLibraryDraft(payload.status.library.root);
      setRecords(payload.recordings || []);
      setKnownTags(payload.tags || []);
      setActiveTag(ALL_TAGS);
      setEditingId("");
      setSecondaryParent(null);
      setCollapsedRecordIds(new Set());
      setLibraryMessage("素材库路径已保存");
    } catch (libraryError) {
      setError(
        libraryError instanceof Error
          ? libraryError.message
          : "素材库路径保存失败。",
      );
    } finally {
      setLibrarySaving(false);
    }
  }

  async function createCustomTag(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newTag.trim();
    if (!name || tagBusy) return;

    setTagBusy(name);
    try {
      const response = await fetch("/api/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const payload = (await response.json()) as { tags?: string[]; error?: string };
      if (!response.ok) throw new Error(payload.error || "标签保存失败。");
      setKnownTags(payload.tags || []);
      setNewTag("");
    } catch (tagError) {
      setError(tagError instanceof Error ? tagError.message : "标签保存失败。");
    } finally {
      setTagBusy("");
    }
  }

  async function renameCustomTag(tag: string) {
    const nextName = (tagDrafts[tag] || tag).trim();
    if (!nextName || nextName === tag || tagBusy) return;

    setTagBusy(tag);
    try {
      const response = await fetch("/api/tags", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: tag, to: nextName }),
      });
      const payload = (await response.json()) as {
        tags?: string[];
        recordings?: RecordingView[];
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || "标签改名失败。");
      setKnownTags(payload.tags || []);
      setRecords(payload.recordings || []);
      setTagDrafts((current) => {
        const next = { ...current };
        delete next[tag];
        return next;
      });
      if (activeTag === tag) setActiveTag(nextName);
    } catch (tagError) {
      setError(tagError instanceof Error ? tagError.message : "标签改名失败。");
    } finally {
      setTagBusy("");
    }
  }

  async function deleteCustomTag(tag: string) {
    if (tagBusy) return;
    const confirmed = window.confirm(`删除标签“${tag}”？这个标签会从所有记录中移除。`);
    if (!confirmed) return;

    setTagBusy(tag);
    try {
      const response = await fetch("/api/tags", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: tag }),
      });
      const payload = (await response.json()) as {
        tags?: string[];
        recordings?: RecordingView[];
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || "标签删除失败。");
      setKnownTags(payload.tags || []);
      setRecords(payload.recordings || []);
      if (activeTag === tag) setActiveTag(ALL_TAGS);
    } catch (tagError) {
      setError(tagError instanceof Error ? tagError.message : "标签删除失败。");
    } finally {
      setTagBusy("");
    }
  }

  function applyFillerWords(nextWords: FillerWord[]) {
    setFillerWords(nextWords);
    setFillerDrafts(fillerDraftMap(nextWords));
  }

  async function createFillerWord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = newFillerText.trim();
    if (!text || fillerBusy) return;

    setFillerBusy("__new__");
    setFillerError("");

    try {
      const response = await fetch("/api/filler-words", {
        body: JSON.stringify({ color: newFillerColor, text }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = (await response.json()) as {
        filler_words?: FillerWord[];
        error?: string;
      };
      if (!response.ok || !payload.filler_words) {
        throw new Error(payload.error || "词条保存失败。");
      }
      applyFillerWords(payload.filler_words);
      setNewFillerText("");
    } catch (createError) {
      setFillerError(
        createError instanceof Error ? createError.message : "词条保存失败。",
      );
    } finally {
      setFillerBusy("");
    }
  }

  async function saveFillerWord(word: FillerWord) {
    if (fillerBusy) return;
    const draft = fillerDrafts[word.id] || word;
    const text = draft.text.trim();
    if (!text) return;

    setFillerBusy(word.id);
    setFillerError("");

    try {
      const response = await fetch("/api/filler-words", {
        body: JSON.stringify({ color: draft.color, id: word.id, text }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      });
      const payload = (await response.json()) as {
        filler_words?: FillerWord[];
        error?: string;
      };
      if (!response.ok || !payload.filler_words) {
        throw new Error(payload.error || "词条保存失败。");
      }
      applyFillerWords(payload.filler_words);
    } catch (saveError) {
      setFillerError(
        saveError instanceof Error ? saveError.message : "词条保存失败。",
      );
    } finally {
      setFillerBusy("");
    }
  }

  async function deleteFillerWord(word: FillerWord) {
    if (fillerBusy) return;

    setFillerBusy(word.id);
    setFillerError("");

    try {
      const response = await fetch("/api/filler-words", {
        body: JSON.stringify({ id: word.id }),
        headers: { "Content-Type": "application/json" },
        method: "DELETE",
      });
      const payload = (await response.json()) as {
        filler_words?: FillerWord[];
        error?: string;
      };
      if (!response.ok || !payload.filler_words) {
        throw new Error(payload.error || "词条删除失败。");
      }
      applyFillerWords(payload.filler_words);
    } catch (deleteError) {
      setFillerError(
        deleteError instanceof Error ? deleteError.message : "词条删除失败。",
      );
    } finally {
      setFillerBusy("");
    }
  }

  async function saveRecordEdits(id: string, nextTitle: string, nextTags: string[]) {
    if (recordBusyId) return;

    setRecordBusyId(id);
    try {
      const response = await fetch(`/api/recordings/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: nextTitle, tags: nextTags }),
      });
      const payload = (await response.json()) as {
        recording?: RecordingView;
        error?: string;
      };
      if (!response.ok || !payload.recording) {
        throw new Error(payload.error || "记录保存失败。");
      }
      applyRecordUpdate(payload.recording);
      setEditingId("");
      setLibraryFeedback("修改已保存");
    } catch (recordError) {
      setError(recordError instanceof Error ? recordError.message : "记录保存失败。");
    } finally {
      setRecordBusyId("");
    }
  }

  async function deleteRecord(id: string) {
    if (recordBusyId) return;
    const confirmed = window.confirm("删除这条记录？视频、封面和转写文件也会一起删除。");
    if (!confirmed) return;

    setRecordBusyId(id);
    try {
      const response = await fetch(`/api/recordings/${id}`, { method: "DELETE" });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "记录删除失败。");
      setRecords((current) => current.filter((record) => record.id !== id));
      setSecondaryParent((current) => (current?.id === id ? null : current));
      if (editingId === id) setEditingId("");
    } catch (recordError) {
      setError(recordError instanceof Error ? recordError.message : "记录删除失败。");
    } finally {
      setRecordBusyId("");
    }
  }

  useEffect(() => {
    void fetch("/api/recordings", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("素材加载失败");
        return response.json();
      })
      .then((payload: { recordings?: RecordingView[] }) => {
        setRecords(payload.recordings || []);
        setLibraryLoadState("ready");
      })
      .catch(() => setLibraryLoadState("failed"));

    void fetch("/api/tags", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: { tags?: string[] }) => {
        setKnownTags(payload.tags || []);
      })
      .catch(() => setKnownTags([]));

    void fetch("/api/filler-words", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: { filler_words?: FillerWord[] }) => {
        const nextWords = payload.filler_words || [];
        setFillerWords(nextWords);
        setFillerDrafts(fillerDraftMap(nextWords));
      })
      .catch(() => {
        setFillerWords([]);
        setFillerDrafts({});
      });

    void fetch("/api/status")
      .then((response) => response.json())
      .then((payload: ProcessingStatus) => {
        setStatus(payload);
        setLibraryDraft(payload.library.root);
      })
      .catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    let active = true;

    const loadPairingInfo = () => {
      void fetch("/api/pairing", { cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) return null;
          return (await response.json()) as PairingInfo;
        })
        .then((payload) => {
          if (active && payload) setPairingInfo(payload);
        })
        .catch(() => undefined);
    };

    loadPairingInfo();
    const timer = window.setInterval(loadPairingInfo, 30_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  async function revokePairedDevice(id: string) {
    if (pairingBusy) return;
    setPairingBusy(id);
    try {
      const response = await fetch("/api/pairing", {
        body: JSON.stringify({ id }),
        headers: { "Content-Type": "application/json" },
        method: "DELETE",
      });
      const payload = (await response.json()) as PairingInfo & { error?: string };
      if (!response.ok) throw new Error(payload.error || "撤销设备失败。");
      setPairingInfo(payload);
    } catch (pairingError) {
      setError(
        pairingError instanceof Error ? pairingError.message : "撤销设备失败。",
      );
    } finally {
      setPairingBusy("");
    }
  }

  function pickMimeType() {
    if (typeof MediaRecorder === "undefined") return "";
    return (
      mimeCandidates.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ||
      ""
    );
  }

  async function startRecording(event: MouseEvent<HTMLButtonElement>) {
    setError("");

    if (failedRecordingBackup) {
      setError("先下载备份、重试保存或清除上一段保存失败的临时素材。");
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("当前浏览器不支持音视频录制。");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          facingMode: "user",
        },
      });
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      );

      streamRef.current = stream;
      chunksRef.current = [];
      recorderRef.current = recorder;
      startedAtRef.current = event.timeStamp;
      setElapsed(0);
      setPreviewActive(true);

      if (previewRef.current) {
        previewRef.current.srcObject = stream;
        await previewRef.current.play().catch(() => undefined);
      }

      recorder.ondataavailable = (recordEvent) => {
        if (recordEvent.data.size > 0) chunksRef.current.push(recordEvent.data);
      };
      recorder.onerror = () => {
        setError("录制过程中出现错误。");
      };
      recorder.onstop = () => {
        const duration = (performance.now() - startedAtRef.current) / 1000;
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "video/webm",
        });
        const draft = createUploadDraft(blob);
        stopStream();
        void uploadRecording(blob, duration, draft);
      };

      recorder.start(1000);
      setRecording(true);
    } catch (captureError) {
      stopStream();
      setError(
        captureError instanceof Error
          ? captureError.message
          : "无法获取摄像头或麦克风权限。",
      );
    }
  }

  function stopRecording() {
    if (!recorderRef.current || recorderRef.current.state === "inactive") return;
    setRecording(false);
    setProcessing(true);
    recorderRef.current.stop();
  }

  function stopStream() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (previewRef.current) previewRef.current.srcObject = null;
    setPreviewActive(false);
  }

  async function uploadRecording(
    blob: Blob,
    duration: number,
    draft = createUploadDraft(blob),
  ) {
    const parent = draft.parent;

    try {
      const formData = new FormData();
      formData.append("video", blob, draft.filename);
      formData.append("duration", String(duration));
      formData.append(
        "title",
        draft.title || (parent ? `二级录制 - ${parent.title}`.slice(0, 120) : ""),
      );
      formData.append("tags", draft.tags);
      formData.append("notes", draft.notes);
      if (parent) formData.append("parent_id", parent.id);

      const response = await fetch("/api/recordings", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json()) as {
        recording?: RecordingView;
        error?: string;
      };

      if (!response.ok || !payload.recording) {
        throw new Error(payload.error || "保存失败。");
      }

      clearFailedRecordingBackup();
      setRecords((current) => [payload.recording as RecordingView, ...current]);
      setKnownTags((current) => mergeTags(current, payload.recording?.tags || []));
      if (parent) {
        setCollapsedRecordIds((current) => {
          const next = new Set(current);
          next.delete(parent.id);
          return next;
        });
      }
      setSecondaryParent(null);
      setTitle("");
      setTags("");
      setNotes("");
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : "保存失败。";
      keepFailedRecordingBackup({ blob, draft, duration, message });
      setError(`${message} 临时素材仍保留在当前页面，请先下载备份或重试保存。`);
    } finally {
      setProcessing(false);
      recorderRef.current = null;
      chunksRef.current = [];
    }
  }

  return (
    <main className="appShell libraryWorkspace" data-view={workspaceView}>
      <header className="workspaceHeader">
        <div>
          <h1>{workspaceView === "capture" ? "录制与上传" : workspaceView === "settings" ? "设置" : "素材库"}</h1>
          <p>{workspaceView === "capture" ? "记录这一次表达，保存后回看与复盘。" : workspaceView === "settings" ? "管理存储位置、手机连接和口头词库。" : "查找、整理和回看你的表达练习。"}</p>
        </div>
        {workspaceView === "library" ? (
          <div className="workspaceHeaderActions">
            <button className="uiButton" disabled={processing || Boolean(failedRecordingBackup)} onClick={() => { window.location.hash = "capture"; openUploadPicker(); }} type="button"><Icon name="upload" />上传音视频</button>
            <a className="uiButton uiButtonPrimary" href="#capture"><Icon name="plus" />新建练习</a>
          </div>
        ) : <a className="uiButton" href="#library">返回素材库{recording ? " · 录制中" : ""}</a>}
      </header>
      {(recording || processing || failedRecordingBackup) && workspaceView !== "capture" && (
        <a className="workspaceActivity" href="#capture">{recording ? "正在录制" : processing ? "正在处理素材" : "有保存失败的临时素材"} · 返回录制区查看</a>
      )}
      {error && <div className="inlineError" role="alert">{error}</div>}
      <section className="workspaceGrid">
        <section className="recorderPanel" aria-label={workspaceView === "settings" ? "设置" : "录制"} id="capture" hidden={workspaceView === "library"}>
          <div className="panelHeader">
            <div>
              <h2>录制</h2>
              <p>
                {processing
                  ? "正在保存素材、生成转写和音波"
                  : formatDuration(elapsed)}
              </p>
            </div>
            <div className={recording ? "recordingBadge active" : "recordingBadge"}>
              <span />
              {recording ? "录制中" : "待录制"}
            </div>
          </div>

          <div className="previewFrame">
            <video ref={previewRef} aria-label="录制预览" muted playsInline />
            {!previewActive && (
              <div className="previewEmpty">
                <Icon name="camera" />
                <strong>准备好后，开始录制</strong>
                <span>开始时将请求摄像头和麦克风权限</span>
              </div>
            )}
          </div>

          {secondaryParent && (
            <div className="secondaryRecordingBanner">
              <div>
                <Icon name="branch" />
                <span>关联练习</span>
              </div>
              <strong>{secondaryParent.title}</strong>
              <button
                disabled={recording || processing}
                onClick={() => setSecondaryParent(null)}
                type="button"
              >
                <Icon name="x" />
                取消
              </button>
            </div>
          )}

          <div className="recordingFields">
            <label>
              <span>标题</span>
              <input
                onChange={(event) => setTitle(event.target.value)}
                placeholder="不填则自动生成"
                value={title}
              />
            </label>
            <label>
              <span>标签</span>
              <input
                onChange={(event) => setTags(event.target.value)}
                placeholder="例如：口播、思考（多个标签用逗号分隔）"
                value={tags}
              />
            </label>
            <label className="notesField">
              <span>备注</span>
              <textarea
                onChange={(event) => setNotes(event.target.value)}
                placeholder="训练目标、复盘重点"
                rows={3}
                value={notes}
              />
            </label>
          </div>

          <div className="recorderActions">
            {!recording ? (
              <>
                <button
                  className="primaryAction"
                  disabled={processing || Boolean(failedRecordingBackup)}
                  onClick={startRecording}
                  type="button"
                >
                  <Icon name="record" />
                  {failedRecordingBackup
                    ? "先处理失败素材"
                    : processing
                      ? "处理中"
                      : "开始录制"}
                </button>
                <button
                  className="uploadAction"
                  disabled={processing || Boolean(failedRecordingBackup)}
                  onClick={openUploadPicker}
                  type="button"
                >
                  <Icon name="upload" />
                  上传音视频
                </button>
                <input
                  accept="video/*,audio/*,.mkv,.m4v,.flac,.opus"
                  className="uploadFileInput"
                  onChange={handleUploadSelection}
                  ref={uploadInputRef}
                  type="file"
                />
              </>
            ) : (
              <button className="dangerAction" onClick={stopRecording} type="button">
                <Icon name="stop" />
                停止并保存
              </button>
            )}
          </div>


          {failedRecordingBackup && (
            <div className="failedRecordingBackup">
              <div>
                <strong>临时素材已保留在当前页面</strong>
                <p>
                  {formatDuration(failedRecordingBackup.duration)} ·{" "}
                  {formatFileSize(failedRecordingBackup.size)} · 关闭或刷新页面后会消失
                </p>
                <p>{failedRecordingBackup.error}</p>
              </div>
              <div className="failedRecordingBackupActions">
                <a
                  download={failedRecordingBackup.draft.filename}
                  href={failedRecordingBackup.url}
                >
                  <Icon name="download" />
                  下载备份
                </a>
                <button
                  disabled={processing}
                  onClick={retryFailedRecordingBackup}
                  type="button"
                >
                  <Icon name="refresh" />
                  重试保存
                </button>
                <button
                  className="clearBackupButton"
                  disabled={processing}
                  onClick={discardFailedRecordingBackup}
                  type="button"
                >
                  <Icon name="trash" />
                  清除
                </button>
              </div>
            </div>
          )}

          <details className="advancedSettings" id="settings" open={workspaceView === "settings"}>
            <summary>
              <span><Icon name="settings" /> 设置与连接</span>
              <Icon name="chevronDown" />
            </summary>
            <div className="settingsContent">
              <div className="settingsStatus">
                <StatusDot active={Boolean(status?.ffmpeg.available)} label="音视频处理" />
                <StatusDot active={Boolean(status?.asr.configured)} label="语音转写" />
                {status?.asr.model && <span className="modelPill">{status.asr.model}</span>}
              </div>
          <div className="configPanel">
            <div className="settingsSectionHeading"><h2>存储与转写</h2><p>新素材的保存位置和本机转写服务。</p></div>
            <form className="libraryPathForm" onSubmit={saveLibraryPath}>
              <label htmlFor="library-path">素材保存位置</label>
              <div className="libraryPathControl">
                <input
                  id="library-path"
                  onChange={(event) => {
                    setLibraryDraft(event.target.value);
                    if (libraryMessage) setLibraryMessage("");
                  }}
                  placeholder="例如 D:/表达训练素材库"
                  value={libraryDraft}
                />
                <button
                  disabled={!libraryPathChanged || librarySaving || processing}
                  type="submit"
                >
                  <Icon name="check" />
                  {librarySaving ? "保存中" : "保存路径"}
                </button>
              </div>
              <p className={libraryMessage ? "configMessage saved" : "configMessage"}>
                {libraryMessage || "当前录制会保存到这个本地目录。"}
              </p>
            </form>
            <div>
              <span>转写命令</span>
              <code>{status?.asr.command || "正在读取转写配置…"}</code>
            </div>
          </div>

          {pairingInfo && (
            <section className="pairingPanel" aria-label="手机配对">
              <div className="pairingPanelHeader">
                <div>
                  <h3>手机配对</h3>
                  <p>手机与电脑连接同一 Wi-Fi 后，输入这个短时配对码。</p>
                </div>
                <strong>{pairingInfo.code}</strong>
              </div>
              <div className="pairedDeviceList">
                {pairingInfo.devices.length ? (
                  pairingInfo.devices.map((device) => (
                    <div className="pairedDeviceItem" key={device.id}>
                      <div>
                        <b>{device.label}</b>
                        <span>
                          {new Intl.DateTimeFormat("zh-CN", {
                            dateStyle: "short",
                            timeStyle: "short",
                          }).format(new Date(device.created_at))}
                        </span>
                      </div>
                      <button
                        disabled={pairingBusy === device.id}
                        onClick={() => revokePairedDevice(device.id)}
                        type="button"
                      >
                        撤销
                      </button>
                    </div>
                  ))
                ) : (
                  <p className="pairedDeviceEmpty">暂无已配对设备</p>
                )}
              </div>
            </section>
          )}

          <section className="fillerManager homeFillerManager" aria-label="口头词库设置">
            <div className="fillerManagerHeader">
              <div>
                <h3>口头词库</h3>
                <p>添加你想减少的口头词，复盘时会自动统计并标记。</p>
              </div>
              <span className="fillerManagerCount">{fillerWords.length} 个</span>
            </div>
            <form className="fillerCreateForm" onSubmit={createFillerWord}>
              <input
                aria-label="新增口头词"
                onChange={(event) => setNewFillerText(event.currentTarget.value)}
                placeholder="例如：就是、然后、好比说是"
                value={newFillerText}
              />
              <label className="fillerColorPicker">
                <span>颜色</span>
                <input
                  aria-label="新增口头词颜色"
                  onChange={(event) => setNewFillerColor(event.currentTarget.value)}
                  type="color"
                  value={newFillerColor}
                />
              </label>
              <button
                disabled={!newFillerText.trim() || fillerBusy === "__new__"}
                type="submit"
              >
                <Icon name="plus" />
                添加
              </button>
            </form>
            {fillerError && <p className="fillerError">{fillerError}</p>}
            {fillerWords.length ? (
              <div className="fillerWordList">
                {fillerWords.map((word) => {
                  const draft = fillerDrafts[word.id] || word;
                  const changed =
                    draft.text.trim() !== word.text || draft.color !== word.color;
                  return (
                    <div className="fillerWordItem" key={word.id}>
                      <input
                        aria-label={`编辑口头词 ${word.text}`}
                        onChange={(event) =>
                          setFillerDrafts((current) => ({
                            ...current,
                            [word.id]: {
                              ...draft,
                              text: event.currentTarget.value,
                            },
                          }))
                        }
                        value={draft.text}
                      />
                      <input
                        aria-label={`修改 ${word.text} 的颜色`}
                        className="fillerColorInput"
                        onChange={(event) =>
                          setFillerDrafts((current) => ({
                            ...current,
                            [word.id]: {
                              ...draft,
                              color: event.currentTarget.value,
                            },
                          }))
                        }
                        type="color"
                        value={draft.color}
                      />
                      <span
                        className="fillerPreview"
                        style={{ backgroundColor: draft.color }}
                      >
                        {draft.text || word.text}
                      </span>
                      <button
                        disabled={!changed || !draft.text.trim() || fillerBusy === word.id}
                        onClick={() => void saveFillerWord(word)}
                        type="button"
                      >
                        <Icon name="check" />
                        保存
                      </button>
                      <button
                        className="deleteFillerButton"
                        disabled={fillerBusy === word.id}
                        onClick={() => void deleteFillerWord(word)}
                        type="button"
                      >
                        <Icon name="trash" />
                        删除
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="fillerEmpty">暂无词条，添加后会用于复盘页高亮和词频统计。</p>
            )}
          </section>
            </div>
          </details>
        </section>

        <section className="libraryPanel" aria-label="素材库" id="library" hidden={workspaceView !== "library"}>
          <div className="libraryToolbar">
            <label className="searchBox">
              <Icon name="search" />
              <input type="search" onChange={(event) => setQuery(event.target.value)} aria-label="搜索素材" placeholder="搜索标题、标签或转写内容" value={query} />
            </label>
            <label className="libraryFilterLabel"><span className="libraryVisuallyHidden">标签</span>
              <select aria-label="筛选标签" value={selectedTag} onChange={(event) => setActiveTag(event.target.value)}>
                <option value={ALL_TAGS}>全部标签</option>
                <option value={UNTAGGED}>无标签</option>
                {tagOptions.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
              </select>
            </label>
            <button className="uiButton uiButtonQuiet manageTagsButton" type="button" onClick={() => tagManagerRef.current?.showModal()}><Icon name="tag" />管理标签</button>
          </div>
          {libraryFeedback && <div className="libraryFeedback" role="status"><span>{libraryFeedback}</span><button type="button" aria-label="关闭保存提示" onClick={() => setLibraryFeedback("")}>×</button></div>}
          <div className="libraryResultsSummary">
            <p role="status" aria-live="polite">{libraryLoadState === "loading" ? "正在加载素材…" : libraryLoadState === "failed" ? "暂时无法加载素材" : query || selectedTag !== ALL_TAGS ? `找到 ${filteredRecords.length} 条素材 · 共 ${records.length} 条` : `${records.length} 条素材`}</p>
            {(query || selectedTag !== ALL_TAGS) && <button className="uiButton uiButtonQuiet" onClick={() => { setQuery(""); setActiveTag(ALL_TAGS); }} type="button">清除筛选</button>}
          </div>
          <dialog className="uiModal tagManagerDialog" ref={tagManagerRef} aria-labelledby="tag-manager-title">
            <div className="uiModalHeader">
              <h2 id="tag-manager-title">管理标签</h2>
              <button className="uiButton uiButtonQuiet" type="button" aria-label="关闭标签管理" onClick={() => tagManagerRef.current?.close()}><Icon name="x" /></button>
            </div>
            <p className="dialogDescription">标签可用于整理和筛选素材。修改名称会同步应用到相关记录。</p>
            {error && <div className="inlineError" role="alert">{error}</div>}
            <form className="tagCreateForm" onSubmit={createCustomTag}>
              <input
                onChange={(event) => setNewTag(event.target.value)}
                aria-label="新标签名称"
                placeholder="输入新标签名称"
                value={newTag}
              />
              <button disabled={!newTag.trim() || Boolean(tagBusy)} type="submit">
                <Icon name="plus" />
                添加
              </button>
            </form>
            {tagOptions.length ? (
              <div className="tagManageList">
                {tagOptions.map((tag) => (
                  <div className="tagManageItem" key={tag}>
                    <input
                      aria-label={`编辑标签 ${tag}`}
                      onChange={(event) =>
                        setTagDrafts((current) => ({
                          ...current,
                          [tag]: event.target.value,
                        }))
                      }
                      value={tagDrafts[tag] ?? tag}
                    />
                    <button
                      disabled={
                        tagBusy === tag ||
                        !(tagDrafts[tag] || tag).trim() ||
                        (tagDrafts[tag] ?? tag) === tag
                      }
                      onClick={() => void renameCustomTag(tag)}
                      type="button"
                    >
                      <Icon name="check" />
                      {tagBusy === tag ? "保存中…" : "保存"}
                    </button>
                    <button
                      className="deleteTagButton"
                      disabled={tagBusy === tag}
                      onClick={() => void deleteCustomTag(tag)}
                      type="button"
                    >
                      <Icon name="trash" />
                      删除
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </dialog>

          <div className="recordList" ref={recordListRef} aria-busy={libraryLoadState === "loading"}>
            {libraryLoadState === "loading" ? (
              <div className="librarySkeleton" aria-hidden="true">{[0, 1, 2].map((row) => <div key={row}><span /><section><i /><i /><i /></section></div>)}</div>
            ) : libraryLoadState === "failed" ? (
              <div className="emptyState libraryFailure" role="alert"><Icon name="archive" /><strong>素材暂时加载不了</strong><p>请确认本地服务正在运行，然后重新加载页面。</p><button type="button" onClick={() => window.location.reload()}>重新加载页面</button></div>
            ) : filteredRecords.length ? (
              visibleRecordNodes.map((node) => (
                <RecordingCard
                  childCount={node.children.length}
                  collapsed={collapsedRecordIds.has(node.record.id)}
                  depth={node.depth}
                  editing={editingId === node.record.id}
                  key={node.record.id}
                  knownTags={tagOptions}
                  onCancelEdit={() => setEditingId("")}
                  onDelete={() => void deleteRecord(node.record.id)}
                  onEdit={() => { setEditingId(node.record.id); setLibraryFeedback(""); }}
                  onOpen={() => rememberRecordListPosition(node.record.id)}
                  onSave={(nextTitle, nextTags) =>
                    void saveRecordEdits(node.record.id, nextTitle, nextTags)
                  }
                  onSecondaryRecord={() => { prepareSecondaryRecording(node.record); window.location.hash = "capture"; }}
                  onToggleCollapse={() => toggleRecordCollapse(node.record.id)}
                  record={node.record}
                  rootIndex={node.rootIndex}
                  saving={recordBusyId === node.record.id}
                />
              ))
            ) : (
              <div className="emptyState">
                <Icon name="archive" />
                <strong>{records.length ? "没有找到匹配的素材" : "还没有素材"}</strong>
                <p>{records.length ? "试试清除搜索或切换标签。" : "录制一段视频，或上传已有的音视频。"}</p>
                {records.length ? (
                  <button onClick={() => { setQuery(""); setActiveTag(ALL_TAGS); }} type="button">清除筛选</button>
                ) : (
                  <a href="#capture">去录制或上传</a>
                )}
              </div>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}

function RecordingCard({
  childCount,
  collapsed,
  depth,
  editing,
  knownTags,
  onCancelEdit,
  onDelete,
  onEdit,
  onOpen,
  onSave,
  onSecondaryRecord,
  onToggleCollapse,
  record,
  rootIndex,
  saving,
}: {
  childCount: number;
  collapsed: boolean;
  depth: number;
  editing: boolean;
  knownTags: string[];
  onCancelEdit: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onOpen: () => void;
  onSave: (title: string, tags: string[]) => void;
  onSecondaryRecord: () => void;
  onToggleCollapse: () => void;
  record: RecordingView;
  rootIndex: number | null;
  saving: boolean;
}) {
  const actionId = useId();
  const actionPopoverRef = useRef<HTMLDivElement | null>(null);
  const actionButtonRef = useRef<HTMLButtonElement | null>(null);
  return (
    <article
      className={editing ? "recordItem editing" : "recordItem"}
      data-recording-id={record.id}
      data-child={depth > 0 || undefined}
      style={{ "--record-indent": `${depth * 22}px` } as CSSProperties}
    >
      <div className="recordTreeIndent">
        {Array.from({ length: depth }).map((_, index) => (
          <span className="recordTreeLine" key={index} />
        ))}
        {rootIndex ? (
          <span
            aria-label={`一级序号 ${rootIndex}`}
            className="recordRootIndex"
            title={`第 ${rootIndex} 条一级记录`}
          >
            {String(rootIndex).padStart(2, "0")}
          </span>
        ) : null}
        {childCount ? (
          <button
            aria-label={collapsed ? `展开 ${childCount} 条关联素材` : "收起关联素材"}
            aria-expanded={!collapsed}
            className="recordTreeToggle"
            onClick={onToggleCollapse}
            title={collapsed ? `展开 ${childCount} 条关联素材` : "收起关联素材"}
            type="button"
          >
            <Icon name={collapsed ? "chevronRight" : "chevronDown"} />
          </button>
        ) : (
          <span className="recordTreeSpacer" />
        )}
      </div>
      <Link
        className="recordThumbnailLink"
        aria-label={`打开素材：${record.title}`}
        href={`/app/${record.id}`}
        onClick={onOpen}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img alt="" src={record.thumbnail_url} />
      </Link>
      <div className="recordInfo">
        {editing ? (
          <RecordingEditForm
            knownTags={knownTags}
            onCancelEdit={onCancelEdit}
            onSave={onSave}
            record={record}
            saving={saving}
          />
        ) : (
          <>
            <div className="recordTitleRow">
              <Link
                className="recordTitleLink"
                href={`/app/${record.id}`}
                onClick={onOpen}
              >
                <h3>{record.title}</h3>
              </Link>
              <time dateTime={record.created_at} title={new Date(record.created_at).toLocaleString("zh-CN")}>{formatDate(record.created_at)}</time>
            </div>
            <p>{record.full_text || record.notes || "暂无转写文本"}</p>
            <div className="recordMeta">
              <span>{formatDuration(record.duration)}</span>
              {record.media_type === "audio" && <b>音频</b>}
              {record.tags.length ? (
                record.tags.map((tag) => <b key={tag}>{tag}</b>)
              ) : null}
              {depth > 0 && <em>关联素材</em>}
            </div>
            <div className="recordActions">
              <button ref={actionButtonRef} type="button" className="recordMoreButton" aria-label={`更多操作：${record.title}`} title="更多操作" popoverTarget={actionId}>•••</button>
              <div ref={actionPopoverRef} id={actionId} popover="auto" className="recordActionMenu" onToggle={(event) => {
                if (event.newState !== "open") return;
                const trigger = actionButtonRef.current?.getBoundingClientRect();
                if (!trigger) return;
                const menu = event.currentTarget;
                menu.style.left = `${Math.max(8, Math.min(trigger.right - 184, window.innerWidth - 192))}px`;
                menu.style.top = `${trigger.bottom + 164 > window.innerHeight ? Math.max(8, trigger.top - 160) : trigger.bottom + 4}px`;
              }}>
                <button type="button" disabled={saving} onClick={() => { actionPopoverRef.current?.hidePopover(); onEdit(); }}><Icon name="edit" />编辑标题和标签</button>
                <button type="button" disabled={saving} onClick={() => { actionPopoverRef.current?.hidePopover(); onSecondaryRecord(); }}><Icon name="branch" />添加关联录制</button>
                <button className="recordDeleteAction" type="button" disabled={saving} onClick={() => { actionPopoverRef.current?.hidePopover(); onDelete(); }}><Icon name="trash" />删除素材</button>
              </div>
            </div>
          </>
        )}
      </div>
    </article>
  );
}

function RecordingEditForm({
  knownTags,
  onCancelEdit,
  onSave,
  record,
  saving,
}: {
  knownTags: string[];
  onCancelEdit: () => void;
  onSave: (title: string, tags: string[]) => void;
  record: RecordingView;
  saving: boolean;
}) {
  const [draftTitle, setDraftTitle] = useState(record.title);
  const [draftTags, setDraftTags] = useState(record.tags.join(", "));
  const parsedDraftTags = useMemo(() => parseTagInput(draftTags), [draftTags]);

  function toggleDraftTag(tag: string) {
    const current = parseTagInput(draftTags);
    const exists = current.includes(tag);
    const nextTags = exists
      ? current.filter((item) => item !== tag)
      : [...current, tag].slice(0, 12);
    setDraftTags(nextTags.join(", "));
  }

  function submitEdits(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave(draftTitle, parsedDraftTags);
  }

  return (
    <form className="recordEditForm" onSubmit={submitEdits}>
      <input
        aria-label="记录标题"
        onChange={(event) => setDraftTitle(event.target.value)}
        placeholder="标题"
        value={draftTitle}
      />
      <input
        aria-label="记录标签"
        onChange={(event) => setDraftTags(event.target.value)}
        placeholder="流水账, 口播素材, 思考"
        value={draftTags}
      />
      {knownTags.length ? (
        <div className="recordEditTagSuggestions">
          {knownTags.map((tag) => (
            <button
              aria-pressed={parsedDraftTags.includes(tag)}
              key={tag}
              onClick={() => toggleDraftTag(tag)}
              type="button"
            >
              {tag}
            </button>
          ))}
        </div>
      ) : null}
      <div className="recordEditActions">
        <button disabled={saving || !draftTitle.trim()} type="submit">
          <Icon name="check" />
          {saving ? "保存中…" : "保存修改"}
        </button>
        <button disabled={saving} onClick={onCancelEdit} type="button">
          <Icon name="x" />
          取消
        </button>
      </div>
    </form>
  );
}

function fillerDraftMap(words: FillerWord[]) {
  return Object.fromEntries(
    words.map((word) => [word.id, { color: word.color, text: word.text }]),
  );
}

function StatusDot({ active, label }: { active: boolean; label: string }) {
  return (
    <span className={active ? "statusDot active" : "statusDot"}>
      <i />
      {label}
    </span>
  );
}

export function Icon({
  name,
}: {
  name:
    | "archive"
    | "branch"
    | "camera"
    | "check"
    | "chevronLeft"
    | "chevronDown"
    | "chevronRight"
    | "copy"
    | "download"
    | "edit"
    | "plus"
    | "record"
    | "refresh"
    | "search"
    | "settings"
    | "sparkles"
    | "stop"
    | "tag"
    | "trash"
    | "upload"
    | "x"
    | "waveform";
}) {
  if (name === "settings") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 7h16M4 17h16" />
        <circle cx="9" cy="7" r="2" fill="currentColor" stroke="none" />
        <circle cx="16" cy="17" r="2" fill="currentColor" stroke="none" />
      </svg>
    );
  }

  if (name === "search") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="m16.5 16.5 4 4" />
      </svg>
    );
  }

  if (name === "sparkles") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m12 3 1.2 3.3L16.5 7.5l-3.3 1.2L12 12l-1.2-3.3-3.3-1.2 3.3-1.2z" />
        <path d="m18 13 .8 2.2L21 16l-2.2.8L18 19l-.8-2.2L15 16l2.2-.8z" />
        <path d="m6 14 1 2.8 2.8 1L7 18.8 6 21l-1-2.2-2.8-1L5 16.8z" />
      </svg>
    );
  }

  if (name === "branch") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="6" cy="6" r="2" />
        <circle cx="18" cy="18" r="2" />
        <path d="M8 6h3a4 4 0 0 1 4 4v6" />
        <path d="M6 8v8a2 2 0 0 0 2 2h8" />
      </svg>
    );
  }

  if (name === "chevronDown") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m6 9 6 6 6-6" />
      </svg>
    );
  }

  if (name === "chevronLeft") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m15 18-6-6 6-6" />
      </svg>
    );
  }

  if (name === "chevronRight") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m9 6 6 6-6 6" />
      </svg>
    );
  }

  if (name === "record") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="7" />
      </svg>
    );
  }

  if (name === "stop") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="7" y="7" width="10" height="10" rx="1" />
      </svg>
    );
  }

  if (name === "camera") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6H9l1.5-2h3L15 6h2.5A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5z" />
        <circle cx="12" cy="12.5" r="3.5" />
      </svg>
    );
  }

  if (name === "edit") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
      </svg>
    );
  }

  if (name === "trash") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 7h16" />
        <path d="M10 11v6" />
        <path d="M14 11v6" />
        <path d="M6 7l1 14h10l1-14" />
        <path d="M9 7V4h6v3" />
      </svg>
    );
  }

  if (name === "tag") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M20 13 13 20 4 11V4h7z" />
        <circle cx="8.5" cy="8.5" r="1.5" />
      </svg>
    );
  }

  if (name === "plus") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 5v14" />
        <path d="M5 12h14" />
      </svg>
    );
  }

  if (name === "check") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m5 12 4 4L19 6" />
      </svg>
    );
  }

  if (name === "x") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 6l12 12" />
        <path d="M18 6 6 18" />
      </svg>
    );
  }

  if (name === "copy") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="8" y="8" width="11" height="11" rx="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" />
      </svg>
    );
  }

  if (name === "download") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3v12" />
        <path d="m7 10 5 5 5-5" />
        <path d="M5 21h14" />
      </svg>
    );
  }

  if (name === "upload") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 17V4" />
        <path d="m7 9 5-5 5 5" />
        <path d="M5 20h14" />
      </svg>
    );
  }

  if (name === "refresh") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M20 11a8 8 0 0 0-14.5-4.5L4 8" />
        <path d="M4 4v4h4" />
        <path d="M4 13a8 8 0 0 0 14.5 4.5L20 16" />
        <path d="M20 20v-4h-4" />
      </svg>
    );
  }

  if (name === "waveform") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 12h.01" />
        <path d="M8 8v8" />
        <path d="M12 5v14" />
        <path d="M16 9v6" />
        <path d="M20 12h.01" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16" />
      <path d="M6 7v11h12V7" />
      <path d="M9 7V5h6v2" />
      <path d="M9 11h6" />
      <path d="M9 15h4" />
    </svg>
  );
}

export function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "00:00";
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0MB";
  const megabytes = bytes / 1024 / 1024;
  if (megabytes < 1024) return `${megabytes.toFixed(1)}MB`;
  return `${(megabytes / 1024).toFixed(2)}GB`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
