"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type ChangeEvent,
  type FormEvent,
  type MouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { formatDuration, Icon } from "@/components/RecorderLibrary";
import { FillerDiscovery } from "@/components/FillerDiscovery";
import type { HistorySource } from "@/lib/history-retrieval";
import type {
  FillerWord,
  RecordingDetail,
  RecordingView,
  TranscriptSentence,
  WaveformDocument,
} from "@/lib/types";

const WAVEFORM_BARS_PER_SENTENCE = 64;
const DEFAULT_REVIEW_NOTE_SECTIONS = [
  { id: "viewpoint", title: "观点层", body: "" },
  { id: "expression", title: "表述层", body: "" },
];
const MAX_NOTES_LENGTH = 100_000;
const PLAYBACK_RATES = [1, 1.5, 2] as const;
const COLLAPSED_FILLER_STAT_COUNT = 2;

type ReviewNoteSection = {
  body: string;
  id: string;
  title: string;
};

export function ReviewSession({ id }: { id: string }) {
  const router = useRouter();
  const [recording, setRecording] = useState<RecordingDetail | null>(null);
  const [recordingIndex, setRecordingIndex] = useState<RecordingView[]>([]);
  const [waveform, setWaveform] = useState<WaveformDocument | null>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const [draftNoteSections, setDraftNoteSections] = useState<ReviewNoteSection[]>(
    () => cloneDefaultReviewNoteSections(),
  );
  const [activeNoteSectionId, setActiveNoteSectionId] = useState("viewpoint");
  const [notesStatus, setNotesStatus] = useState<
    "idle" | "saving" | "saved" | "failed"
  >("idle");
  const [reviewDraftStatus, setReviewDraftStatus] = useState<
    "idle" | "generating" | "ready" | "failed"
  >("idle");
  const [reviewDraftMessage, setReviewDraftMessage] = useState("");
  const [useHistory, setUseHistory] = useState(true);
  const [historySources, setHistorySources] = useState<HistorySource[]>([]);
  const [fillerWords, setFillerWords] = useState<FillerWord[]>([]);
  const [fillerMinCount, setFillerMinCount] = useState(1);
  const [fillerStatsExpanded, setFillerStatsExpanded] = useState(false);
  const [showWaveform, setShowWaveform] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [mediaDuration, setMediaDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [titleSaving, setTitleSaving] = useState(false);
  const [titleError, setTitleError] = useState("");
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState("");
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const reviewTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const copyResetRef = useRef<number | null>(null);
  const notesResetRef = useRef<number | null>(null);
  const leaveDialogRef = useRef<HTMLDialogElement | null>(null);
  const pendingDestinationRef = useRef<string | null>(null);
  const recordingId = recording?.id;
  const recordingDuration = recording?.duration || 0;

  useEffect(() => {
    let active = true;

    void fetch(`/api/recordings/${id}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: { recording?: RecordingDetail; error?: string }) => {
        if (!active) return;
        if (!payload.recording) throw new Error(payload.error || "记录不存在。");
        setRecording(payload.recording);
        setTitleDraft(payload.recording.title);
        setEditingTitle(false);
        setTitleError("");
        const sections = parseReviewNotes(payload.recording.notes || "");
        setDraftNoteSections(sections);
        setActiveNoteSectionId(sections[0]?.id || "viewpoint");
        setNotesStatus("idle");
      })
      .catch((fetchError) => {
        if (active) {
          setError(fetchError instanceof Error ? fetchError.message : "加载失败。");
        }
      });

    return () => {
      active = false;
    };
  }, [id]);

  useEffect(() => {
    let active = true;

    void fetch("/api/recordings", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: { recordings?: RecordingView[] }) => {
        if (active) setRecordingIndex(payload.recordings || []);
      })
      .catch(() => {
        if (active) setRecordingIndex([]);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    void fetch("/api/filler-words", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: { filler_words?: FillerWord[] }) => {
        if (!active) return;
        setFillerWords(payload.filler_words || []);
      })
      .catch(() => {
        if (!active) return;
        setFillerWords([]);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!recordingId || !showWaveform) return;
    if (waveform?.id === recordingId) return;

    let active = true;
    const controller = new AbortController();

    void fetch(`/api/recordings/${recordingId}/waveform`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json()) as {
          waveform?: WaveformDocument;
          error?: string;
        };

        if (!response.ok || !payload.waveform) {
          throw new Error(payload.error || "音波图生成失败。");
        }

        return payload.waveform;
      })
      .then((nextWaveform) => {
        if (active) setWaveform(nextWaveform);
      })
      .catch((waveformError) => {
        if (waveformError instanceof Error && waveformError.name === "AbortError") {
          return;
        }
        if (!active) return;
        setWaveform({
          id: recordingId,
          created_at: new Date().toISOString(),
          duration: recordingDuration,
          sample_rate: 0,
          peaks_per_second: 0,
          peaks: [],
          status: "error",
          error: "音波图生成失败。",
        });
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [recordingDuration, recordingId, showWaveform, waveform?.id]);

  useEffect(() => {
    return () => {
      if (copyResetRef.current) window.clearTimeout(copyResetRef.current);
      if (notesResetRef.current) window.clearTimeout(notesResetRef.current);
    };
  }, []);

  useEffect(() => {
    if (mediaRef.current) mediaRef.current.playbackRate = playbackRate;
  }, [playbackRate, recordingId]);

  useEffect(() => {
    resizeReviewTextarea(reviewTextareaRef.current);
  }, [activeNoteSectionId, draftNoteSections]);

  const sentences = useMemo(
    () => recording?.transcript.sentences || [],
    [recording?.transcript.sentences],
  );
  const activeIndex = useMemo(
    () => findActiveSentence(sentences, currentTime),
    [currentTime, sentences],
  );
  const durationForSlider = mediaDuration || recording?.duration || 0;
  const sliderMax = durationForSlider > 0 ? durationForSlider : 1;
  const sliderValue = Math.min(currentTime, sliderMax);
  const activeWaveform =
    recording && waveform?.id === recording.id ? waveform : null;
  const waveformLoading = Boolean(recording && showWaveform && !activeWaveform);
  const transcriptText = useMemo(() => {
    if (!recording) return "";
    const fullText = recording.transcript.full_text.trim();
    return fullText || sentences.map((sentence) => sentence.text).join("\n");
  }, [recording, sentences]);
  const normalizedFillerMinCount = Math.max(
    1,
    Math.floor(Number.isFinite(fillerMinCount) ? fillerMinCount : 1),
  );
  const fillerStats = useMemo(
    () => countFillerWordOccurrences(transcriptText, fillerWords),
    [fillerWords, transcriptText],
  );
  const visibleFillerStats = useMemo(
    () => fillerStats.filter((stat) => stat.count >= normalizedFillerMinCount),
    [fillerStats, normalizedFillerMinCount],
  );
  const displayedFillerStats = fillerStatsExpanded
    ? visibleFillerStats
    : visibleFillerStats.slice(0, COLLAPSED_FILLER_STAT_COUNT);
  const orderedRecordings = useMemo(
    () => flattenRecordingHierarchy(recordingIndex),
    [recordingIndex],
  );
  const currentRecordingIndex = orderedRecordings.findIndex(
    (item) => item.id === recording?.id,
  );
  const previousRecording =
    currentRecordingIndex > 0 ? orderedRecordings[currentRecordingIndex - 1] : null;
  const nextRecording =
    currentRecordingIndex >= 0 && currentRecordingIndex < orderedRecordings.length - 1
      ? orderedRecordings[currentRecordingIndex + 1]
      : null;
  const matchedFillerWordCount = fillerStats.filter((stat) => stat.count > 0).length;
  const totalFillerCount = fillerStats.reduce((sum, stat) => sum + stat.count, 0);
  const draftNotes = useMemo(
    () => serializeReviewNotes(draftNoteSections),
    [draftNoteSections],
  );
  const savedNotes = useMemo(
    () => serializeReviewNotes(parseReviewNotes(recording?.notes || "")),
    [recording?.notes],
  );
  const activeNoteSection =
    draftNoteSections.find((section) => section.id === activeNoteSectionId) ||
    draftNoteSections[0] ||
    DEFAULT_REVIEW_NOTE_SECTIONS[0];
  const notesCharacterCount = draftNoteSections.reduce(
    (sum, section) => sum + section.title.length + section.body.length,
    0,
  );
  const notesChanged = draftNotes.trim() !== savedNotes.trim();
  const hasUnsavedChanges = notesChanged || (editingTitle && titleDraft !== recording?.title);
  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const onLinkClick = (event: globalThis.MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element).closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
      const destination = new URL(link.href, window.location.href);
      if (destination.pathname === window.location.pathname && destination.search === window.location.search) return;
      event.preventDefault();
      event.stopPropagation();
      pendingDestinationRef.current = link.href;
      leaveDialogRef.current?.showModal();
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", onLinkClick, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", onLinkClick, true);
    };
  }, [hasUnsavedChanges]);

  function navigateToRecording(destination: string) {
    if (hasUnsavedChanges) {
      pendingDestinationRef.current = destination;
      leaveDialogRef.current?.showModal();
    } else router.push(destination);
  }
  const notesStatusText =
    notesStatus === "saving"
      ? "正在保存"
      : notesStatus === "saved"
        ? "已保存"
        : notesStatus === "failed"
          ? "保存失败，请重试"
          : notesChanged
            ? "有未保存内容"
            : "已保存到本条素材";

  function syncDuration(media: HTMLMediaElement) {
    const nextDuration =
      Number.isFinite(media.duration) && media.duration > 0
        ? media.duration
        : recording?.duration || 0;
    setMediaDuration(nextDuration);
    media.playbackRate = playbackRate;
  }

  function changePlaybackRate(nextRate: number) {
    setPlaybackRate(nextRate);
    if (mediaRef.current) mediaRef.current.playbackRate = nextRate;
  }

  function startTitleEdit() {
    if (!recording) return;
    setTitleDraft(recording.title);
    setTitleError("");
    setEditingTitle(true);
  }

  function cancelTitleEdit() {
    setTitleDraft(recording?.title || "");
    setTitleError("");
    setEditingTitle(false);
  }

  async function saveRecordingTitle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!recording || titleSaving) return;

    const nextTitle = titleDraft.trim();
    if (!nextTitle) {
      setTitleError("标题不能为空。");
      return;
    }
    if (nextTitle === recording.title) {
      setEditingTitle(false);
      return;
    }

    setTitleSaving(true);
    setTitleError("");
    try {
      const response = await fetch(`/api/recordings/${recording.id}`, {
        body: JSON.stringify({ title: nextTitle }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      });
      const payload = (await response.json()) as {
        recording?: { title?: string };
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || "标题保存失败。");

      const savedTitle = payload.recording?.title || nextTitle;
      setRecording((current) =>
        current ? { ...current, title: savedTitle } : current,
      );
      setTitleDraft(savedTitle);
      setEditingTitle(false);
    } catch (saveError) {
      setTitleError(
        saveError instanceof Error ? saveError.message : "标题保存失败。",
      );
    } finally {
      setTitleSaving(false);
    }
  }

  async function togglePlayback() {
    const media = mediaRef.current;
    if (!media) return;

    if (media.paused) {
      await media.play().catch(() => undefined);
    } else {
      media.pause();
    }
  }

  function scrubTo(value: number) {
    const media = mediaRef.current;
    if (!media) return;
    const nextTime = Math.min(Math.max(0, value), sliderMax);
    media.currentTime = nextTime;
    setCurrentTime(nextTime);
  }

  function jumpTo(sentence: TranscriptSentence) {
    scrubTo(sentence.start);
    mediaRef.current?.focus();
  }

  function resetCopyStatus() {
    if (copyResetRef.current) window.clearTimeout(copyResetRef.current);
    copyResetRef.current = window.setTimeout(() => setCopyStatus("idle"), 1600);
  }

  function resetNotesStatus() {
    if (notesResetRef.current) window.clearTimeout(notesResetRef.current);
    notesResetRef.current = window.setTimeout(() => setNotesStatus("idle"), 1800);
  }

  async function copyTranscript() {
    const text = transcriptText.trim();
    if (!text) return;

    try {
      await copyTextToClipboard(text);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    } finally {
      resetCopyStatus();
    }
  }

  async function saveReviewNotes() {
    if (!recording || notesStatus === "saving") return;

    setNotesStatus("saving");

    try {
      const response = await fetch(`/api/recordings/${recording.id}`, {
        body: JSON.stringify({ notes: draftNotes }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      });
      const payload = (await response.json()) as {
        recording?: Partial<RecordingDetail>;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error || "保存失败。");
      }

      const savedNotes =
        typeof payload.recording?.notes === "string"
          ? payload.recording.notes
          : draftNotes;

      const savedSections = parseReviewNotes(savedNotes);
      setDraftNoteSections(savedSections);
      setActiveNoteSectionId((current) =>
        savedSections.some((section) => section.id === current)
          ? current
          : savedSections[0]?.id || "viewpoint",
      );
      setRecording((current) =>
        current ? { ...current, notes: savedNotes } : current,
      );
      setNotesStatus("saved");
    } catch {
      setNotesStatus("failed");
    } finally {
      resetNotesStatus();
    }
  }

  async function generateReviewDraft() {
    if (!recording || reviewDraftStatus === "generating") return;

    const targetSections = draftNoteSections.filter(
      (section) =>
        section.id === "viewpoint" ||
        section.id === "expression" ||
        section.title === "观点层" ||
        section.title === "表述层",
    );
    const hasExistingContent = targetSections.some((section) => section.body.trim());
    const message = hasExistingContent
      ? "AI 草稿会替换观点层和表述层当前编辑内容，但不会自动保存；其他自定义层会保留。转写文字将发送给已配置的在线 AI 服务，音视频不会上传。是否继续？"
      : "转写文字将发送给已配置的在线 AI 服务进行分析，音视频不会上传。生成结果不会自动保存。是否继续？";

    if (!window.confirm(message + (useHistory ? " 本次还会检索最多 4 条历史逐字稿片段并发送给同一 AI 服务，来源将随草稿展示。" : ""))) return;

    setReviewDraftStatus("generating");
    setReviewDraftMessage("正在分析转写稿...");
    setHistorySources([]);

    try {
      const response = await fetch(`/api/recordings/${recording.id}/review-draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ useHistory }),
      });
      const payload = (await response.json()) as {
        draft?: { expression: string; viewpoint: string };
        error?: string;
        model?: string;
        truncated?: boolean;
        historySources?: HistorySource[];
      };

      if (!response.ok || !payload.draft) {
        throw new Error(payload.error || "AI 复盘生成失败。");
      }

      const viewpointSection = draftNoteSections.find(
        (section) => section.id === "viewpoint" || section.title === "观点层",
      );
      const expressionSection = draftNoteSections.find(
        (section) => section.id === "expression" || section.title === "表述层",
      );
      const generatedSections = [
        {
          id: viewpointSection?.id || "viewpoint",
          title: "观点层",
          body: payload.draft.viewpoint.trim(),
        },
        {
          id: expressionSection?.id || "expression",
          title: "表述层",
          body: payload.draft.expression.trim(),
        },
      ];

      setDraftNoteSections((current) => {
        const next = current.filter(
          (section) =>
            section.id !== "viewpoint" &&
            section.id !== "expression" &&
            section.title !== "观点层" &&
            section.title !== "表述层",
        );
        return [...generatedSections, ...next];
      });
      setActiveNoteSectionId(generatedSections[0].id);
      setNotesStatus("idle");
      setReviewDraftStatus("ready");
      setHistorySources(payload.historySources || []);
      setReviewDraftMessage(
        `${payload.model || "AI"} 已生成草稿${payload.truncated ? "（长稿仅分析前 60000 字）" : ""}${useHistory ? `，检索到 ${payload.historySources?.length || 0} 条历史片段` : ""}，检查后点击保存。`,
      );
    } catch (draftError) {
      setReviewDraftStatus("failed");
      setReviewDraftMessage(
        draftError instanceof Error ? draftError.message : "AI 复盘生成失败。",
      );
    }
  }

  function updateActiveNoteBody(event: ChangeEvent<HTMLTextAreaElement>) {
    const nextBody = event.currentTarget.value.slice(0, MAX_NOTES_LENGTH);
    resizeReviewTextarea(event.currentTarget);
    setDraftNoteSections((current) =>
      current.map((section) =>
        section.id === activeNoteSection.id
          ? { ...section, body: nextBody }
          : section,
      ),
    );
    if (notesStatus !== "idle") setNotesStatus("idle");
  }

  function updateActiveNoteTitle(event: ChangeEvent<HTMLInputElement>) {
    const nextTitle = event.currentTarget.value.trimStart().slice(0, 24);
    setDraftNoteSections((current) =>
      current.map((section) =>
        section.id === activeNoteSection.id
          ? { ...section, title: nextTitle }
          : section,
      ),
    );
    if (notesStatus !== "idle") setNotesStatus("idle");
  }

  function addReviewNoteSection() {
    const id = `note-${Date.now().toString(36)}`;
    const nextSection = {
      id,
      title: `新层 ${draftNoteSections.length + 1}`,
      body: "",
    };
    setDraftNoteSections((current) => [...current, nextSection]);
    setActiveNoteSectionId(id);
    if (notesStatus !== "idle") setNotesStatus("idle");
  }

  function deleteActiveNoteSection() {
    if (draftNoteSections.length <= 1) return;
    const activeIndex = Math.max(
      0,
      draftNoteSections.findIndex((section) => section.id === activeNoteSection.id),
    );
    const nextSections = draftNoteSections.filter(
      (section) => section.id !== activeNoteSection.id,
    );
    setDraftNoteSections(nextSections);
    setActiveNoteSectionId(
      nextSections[Math.min(activeIndex, nextSections.length - 1)]?.id ||
        nextSections[0]?.id ||
        "viewpoint",
    );
    if (notesStatus !== "idle") setNotesStatus("idle");
  }

  async function rerunTranscript() {
    setTranscribing(true);
    setError("");

    try {
      const response = await fetch(`/api/recordings/${id}/transcript`, {
        method: "POST",
      });
      const payload = (await response.json()) as {
        recording?: RecordingDetail;
        error?: string;
      };

      if (!response.ok || !payload.recording) {
        throw new Error(payload.error || "转写失败。");
      }

      setRecording(payload.recording);
      const sections = parseReviewNotes(payload.recording.notes || "");
      setDraftNoteSections(sections);
      setActiveNoteSectionId(sections[0]?.id || "viewpoint");
      setNotesStatus("idle");
    } catch (transcriptError) {
      setError(
        transcriptError instanceof Error ? transcriptError.message : "转写失败。",
      );
    } finally {
      setTranscribing(false);
    }
  }

  if (error) {
    return (
      <main className="appShell">
        <Link className="backLink" href="/app#library">
          返回
        </Link>
        <div className="inlineError" role="alert">{error}</div>
        <button className="uiButton" onClick={() => window.location.reload()} type="button">重新加载</button>
      </main>
    );
  }

  if (!recording) {
    return (
      <main className="appShell">
        <div className="loadingState" role="status" aria-live="polite">正在加载素材与复盘记录…</div>
      </main>
    );
  }

  return (
    <main className="reviewShell">
      <dialog className="uiModal" ref={leaveDialogRef} aria-labelledby="leave-review-title">
        <div className="uiModalHeader"><h2 id="leave-review-title">有修改尚未保存</h2></div>
        <p>离开会丢失当前修改。你可以继续编辑并保存，或放弃修改离开。</p>
        <div className="uiModalFooter">
          <button className="uiButton" type="button" onClick={() => {
            leaveDialogRef.current?.close();
            const destination = pendingDestinationRef.current;
            if (destination) router.push(destination);
          }}>放弃修改并离开</button>
          <button className="uiButton uiButtonPrimary" type="button" autoFocus onClick={() => leaveDialogRef.current?.close()}>继续编辑</button>
        </div>
      </dialog>
      <header className="reviewHeader">
        <Link className="backLink" href="/app#library">
          返回素材库
        </Link>
        <div className="reviewTitleBlock">
          {editingTitle ? (
            <form className="reviewTitleEditor" onSubmit={saveRecordingTitle}>
              <input
                aria-label="视频标题"
                autoFocus
                maxLength={120}
                onChange={(event) => {
                  setTitleDraft(event.currentTarget.value);
                  if (titleError) setTitleError("");
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") cancelTitleEdit();
                }}
                value={titleDraft}
              />
              <button
                aria-label="保存标题"
                disabled={titleSaving || !titleDraft.trim()}
                title="保存标题"
                type="submit"
              >
                <Icon name="check" />
              </button>
              <button
                aria-label="取消修改标题"
                disabled={titleSaving}
                onClick={cancelTitleEdit}
                title="取消"
                type="button"
              >
                <Icon name="x" />
              </button>
            </form>
          ) : (
            <div className="reviewTitleDisplay">
              <h1>{recording.title}</h1>
              <button
                aria-label="修改标题"
                onClick={startTitleEdit}
                title="修改标题"
                type="button"
              >
                <Icon name="edit" />
              </button>
            </div>
          )}
          {titleError ? <span className="reviewTitleError">{titleError}</span> : null}
          <p>
            {new Intl.DateTimeFormat("zh-CN", {
              dateStyle: "medium",
              timeStyle: "short",
            }).format(new Date(recording.created_at))}
            <span>{formatDuration(durationForSlider || recording.duration)}</span>
          </p>
        </div>
        <nav className="reviewQuickNav" aria-label="复盘导航">
          <a href="#player">播放</a>
          <a href="#notes">复盘</a>
          <a href="#transcript">转写稿</a>
          {previousRecording ? (
            <Link aria-label={`上一条：${previousRecording.title}`} href={`/app/${previousRecording.id}`} title={previousRecording.title}>
              <Icon name="chevronLeft" />
            </Link>
          ) : null}
          {nextRecording ? (
            <Link aria-label={`下一条：${nextRecording.title}`} href={`/app/${nextRecording.id}`} title={nextRecording.title}>
              <Icon name="chevronRight" />
            </Link>
          ) : null}
        </nav>
      </header>

      <section className="reviewGrid">
        <section
          className="videoPane"
          id="player"
          aria-label={recording.media_type === "audio" ? "音频播放" : "视频播放"}
        >
          {recording.media_type === "audio" ? (
            <div className="audioPlayerFrame">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img alt={`${recording.title} 音频封面`} src={recording.thumbnail_url} />
              <audio
                ref={(element) => {
                  mediaRef.current = element;
                }}
                onEnded={() => setPlaying(false)}
                onLoadedMetadata={(event) => syncDuration(event.currentTarget)}
                onPause={() => setPlaying(false)}
                onPlay={() => setPlaying(true)}
                onTimeUpdate={(event) => {
                  setCurrentTime(event.currentTarget.currentTime);
                  syncDuration(event.currentTarget);
                }}
                preload="metadata"
                src={recording.video_url}
              />
            </div>
          ) : (
            <video
              ref={(element) => {
                mediaRef.current = element;
              }}
              onEnded={() => setPlaying(false)}
              onLoadedMetadata={(event) => syncDuration(event.currentTarget)}
              onPause={() => setPlaying(false)}
              onPlay={() => setPlaying(true)}
              onTimeUpdate={(event) => {
                setCurrentTime(event.currentTarget.currentTime);
                syncDuration(event.currentTarget);
              }}
              poster={recording.thumbnail_url}
              preload="metadata"
              src={recording.video_url}
            />
          )}
          <div className="videoControls">
            <button className="playButton" onClick={togglePlayback} type="button">
              {playing ? "暂停" : "播放"}
            </button>
            <span>{formatDuration(currentTime)}</span>
            <input
              aria-label="播放进度"
              className="timeSlider"
              max={sliderMax}
              min="0"
              onChange={(event) => scrubTo(Number(event.currentTarget.value))}
              step="0.1"
              type="range"
              value={sliderValue}
            />
            <span>{formatDuration(durationForSlider)}</span>
            <div className="playbackRateControl" aria-label="播放速度">
              {PLAYBACK_RATES.map((rate) => (
                <button
                  aria-pressed={playbackRate === rate}
                  key={rate}
                  onClick={() => changePlaybackRate(rate)}
                  type="button"
                >
                  {rate}×
                </button>
              ))}
            </div>
          </div>
          <div className="reviewMeta">
            <div className="tagRow">
              {recording.tags.length ? (
                recording.tags.map((tag) => <span key={tag}>{tag}</span>)
              ) : (
                <span>未标记</span>
              )}
            </div>
          </div>
          <section className="reviewNotesPanel" aria-label="复盘记录" id="notes">
            <div className="reviewNotesHeader">
              <div>
                <h2>复盘记录</h2>
                <p>记录观点、修改表达，整理下一次练习的重点。</p>
              </div>
              <div className="reviewNotesHeaderActions">
                <button
                  className="aiReviewButton"
                  disabled={
                    reviewDraftStatus === "generating" || !transcriptText.trim()
                  }
                  onClick={generateReviewDraft}
                  title="发送转写文字生成复盘草稿；不上传音视频"
                  type="button"
                >
                  <Icon name="sparkles" />
                  {reviewDraftStatus === "generating" ? "分析中" : "AI 初步分析"}
                </button>
                <span>{notesCharacterCount.toLocaleString("zh-CN")} 字</span>
              </div>
            </div>
            <label className="reviewHistorySources"><input type="checkbox" checked={useHistory} disabled={reviewDraftStatus === "generating"} onChange={(event) => setUseHistory(event.target.checked)} /> 参考历史表达（同题原稿优先，再查相关主题；最多 4 个片段）</label>
            {historySources.length > 0 && <details className="reviewHistorySources"><summary>查看本次历史来源 · {historySources.length} 条</summary>{historySources.map((source, index) => <article key={source.id}><p><a href={source.url} target="_blank" rel="noreferrer">[H{index + 1}] {source.title}</a> · {source.createdAt} · {source.reason}</p><blockquote>{source.excerpt}</blockquote></article>)}</details>}
            {reviewDraftMessage ? (
              <p className={`reviewDraftStatus ${reviewDraftStatus}`} role="status">
                {reviewDraftMessage}
              </p>
            ) : null}
            <div className="reviewNoteTabs" role="tablist" aria-label="复盘记录层级">
              {draftNoteSections.map((section) => (
                <button
                  aria-selected={section.id === activeNoteSection.id}
                  key={section.id}
                  onClick={() => setActiveNoteSectionId(section.id)}
                  role="tab"
                  type="button"
                >
                  {section.title || "未命名"}
                </button>
              ))}
              <button
                className="addNoteSectionButton"
                onClick={addReviewNoteSection}
                type="button"
              >
                <Icon name="plus" />
                新增分组
              </button>
            </div>
            <div className="reviewDocumentEditor">
              <div className="reviewDocumentToolbar">
                <label>
                  <span>小标题</span>
                  <input
                    aria-label="复盘层小标题"
                    onChange={updateActiveNoteTitle}
                    placeholder="例如：观点层"
                    value={activeNoteSection.title}
                  />
                </label>
                <button
                  disabled={draftNoteSections.length <= 1}
                  onClick={deleteActiveNoteSection}
                  type="button"
                >
                  <Icon name="trash" />
                  删除分组
                </button>
              </div>
              <textarea
                ref={reviewTextareaRef}
                className="reviewNotesInput"
                aria-label={`${activeNoteSection.title || "未命名分组"}复盘内容`}
                onChange={updateActiveNoteBody}
                placeholder="写下这一层的复盘、改稿、判断和建议..."
                rows={10}
                value={activeNoteSection.body}
              />
            </div>
            <div className="reviewNotesActions">
              <span className={`reviewNotesStatus ${notesStatus}`} role="status">
                {notesStatusText}
              </span>
              <button
                className="saveNotesButton"
                disabled={!notesChanged || notesStatus === "saving"}
                onClick={saveReviewNotes}
                type="button"
              >
                {notesStatus === "saving" ? "保存中…" : "保存复盘"}
              </button>
            </div>
          </section>
        </section>

        <aside className="transcriptPane" aria-label="转写稿" id="transcript">
          <div className="transcriptHeader">
            <div>
              <h2>转写稿</h2>
              <p>{transcribing ? "正在转写…" : recording.transcript.status === "ready" ? "点击句子定位播放" : recording.transcript.status === "error" ? "转写失败，可重新转写" : "还没有转写内容"}</p>
            </div>
            <div className="transcriptHeaderActions">
              <button
                aria-pressed={showWaveform}
                className="toggleWaveformButton"
                onClick={() => setShowWaveform((current) => !current)}
                type="button"
              >
                <Icon name="waveform" />
                {showWaveform ? "隐藏音波" : "显示音波"}
              </button>
              <button
                className="rerunTranscriptButton"
                disabled={transcribing}
                onClick={rerunTranscript}
                type="button"
              >
                <Icon name="refresh" />
                {transcribing ? "转写中…" : "重新转写"}
              </button>
              <button
                className={`copyTranscriptButton ${copyStatus}`}
                disabled={!transcriptText.trim()}
                onClick={copyTranscript}
                type="button"
              >
                <Icon name="copy" />
                {copyStatus === "copied"
                  ? "已复制"
                  : copyStatus === "failed"
                    ? "复制失败"
                    : "复制"}
              </button>
              <span className="transcriptTimePill">{formatDuration(currentTime)}</span>
            </div>
          </div>

          {recording.transcript.error && (
            <div className="transcriptError">
              <p>{recording.transcript.error}</p>
            </div>
          )}

          <section className="fillerStatsPanel" aria-label="当前稿子口头词统计">
            <div className="fillerStatsHeader">
              <div>
                <h3>口头词统计</h3>
                <p>
                  当前稿子命中 {matchedFillerWordCount} 个词，合计{" "}
                  {totalFillerCount} 次
                </p>
              </div>
              <div className="fillerStatsActions">
                <label className="fillerThresholdControl">
                  <span>至少</span>
                  <input
                    aria-label="口头词统计最少出现次数"
                    min="1"
                    onChange={(event) =>
                      setFillerMinCount(
                        Math.max(1, Math.floor(Number(event.currentTarget.value) || 1)),
                      )
                    }
                    type="number"
                    value={normalizedFillerMinCount}
                  />
                  <span>次</span>
                </label>
                {visibleFillerStats.length > COLLAPSED_FILLER_STAT_COUNT && (
                  <button
                    aria-controls="filler-stats-list"
                    aria-expanded={fillerStatsExpanded}
                    className="fillerStatsToggle"
                    onClick={() => setFillerStatsExpanded((expanded) => !expanded)}
                    type="button"
                  >
                    <Icon name={fillerStatsExpanded ? "chevronDown" : "chevronRight"} />
                    {fillerStatsExpanded ? "收起" : "展开"}
                  </button>
                )}
              </div>
            </div>
            {visibleFillerStats.length ? (
              <div className="fillerStatsList" id="filler-stats-list">
                {displayedFillerStats.map((stat) => (
                  <div className="fillerStatItem" key={stat.word.id}>
                    <span
                      aria-hidden="true"
                      className="fillerStatSwatch"
                      style={{ backgroundColor: stat.word.color }}
                    />
                    <strong>{stat.word.text}</strong>
                    <span>{stat.count} 次</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="fillerEmpty">
                当前稿子没有达到 {normalizedFillerMinCount} 次的口头词。
              </p>
            )}
          </section>

          <FillerDiscovery key={`${recording.id}:${transcriptText}`} id={recording.id} words={fillerWords} onWords={setFillerWords} onSeek={scrubTo} />

          {sentences.length ? (
            <div className={showWaveform ? "transcriptRows" : "transcriptRows compact"}>
              {waveformLoading && (
                <p className="waveformStatus">正在生成本地音波图</p>
              )}
              {showWaveform && activeWaveform?.status === "error" && (
                <p className="waveformStatus">未读取到真实音波，已显示时间占位图。</p>
              )}
              {sentences.map((sentence, index) => {
                const active = index === activeIndex;
                return (
                  <article
                    className={active ? "transcriptRow active" : "transcriptRow"}
                    key={`${sentence.start}-${sentence.text}`}
                  >
                    <button
                      className="transcriptLine"
                      onClick={() => jumpTo(sentence)}
                      title={`${formatDuration(sentence.start)} - ${formatDuration(
                        sentence.end,
                      )}`}
                      type="button"
                    >
                      <span className="sentenceTime">{formatDuration(sentence.start)}</span>
                      <HighlightedTranscriptText
                        fillerWords={fillerWords}
                        text={sentence.text}
                      />
                    </button>
                    {showWaveform && (
                      <WaveformStrip
                        active={active}
                        currentTime={currentTime}
                        onSeek={scrubTo}
                        sentence={sentence}
                        waveform={activeWaveform}
                      />
                    )}
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="emptyTranscript">
              <Icon name="archive" />
              <strong>暂无转写稿</strong>
              <p>可使用上方“重新转写”生成文字，或先播放素材并记录复盘。</p>
            </div>
          )}
        </aside>
      </section>

      {currentRecordingIndex >= 0 && orderedRecordings.length > 1 ? (
        <nav className="recordingNavigator" aria-label="素材切换">
          {previousRecording ? (
            <Link className="recordingNavigatorLink previous" href={`/app/${previousRecording.id}`}>
              <Icon name="chevronLeft" />
              <span>
                <small>上一条</small>
                <strong>{previousRecording.title}</strong>
              </span>
            </Link>
          ) : (
            <span className="recordingNavigatorLink previous disabled" aria-disabled="true">
              <Icon name="chevronLeft" />
              <span>
                <small>上一条</small>
                <strong>已经是第一条</strong>
              </span>
            </span>
          )}

          <label className="recordingJumpControl">
            <span>
              当前第 {currentRecordingIndex + 1} / {orderedRecordings.length} 条
            </span>
            <select
              aria-label="跳转到指定素材"
              onChange={(event) => navigateToRecording(`/app/${event.currentTarget.value}`)}
              value={recording.id}
            >
              {orderedRecordings.map((item, index) => (
                <option key={item.id} value={item.id}>
                  {index + 1}. {item.title}
                </option>
              ))}
            </select>
          </label>

          {nextRecording ? (
            <Link className="recordingNavigatorLink next" href={`/app/${nextRecording.id}`}>
              <span>
                <small>下一条</small>
                <strong>{nextRecording.title}</strong>
              </span>
              <Icon name="chevronRight" />
            </Link>
          ) : (
            <span className="recordingNavigatorLink next disabled" aria-disabled="true">
              <span>
                <small>下一条</small>
                <strong>已经是最后一条</strong>
              </span>
              <Icon name="chevronRight" />
            </span>
          )}
        </nav>
      ) : null}
    </main>
  );
}

function flattenRecordingHierarchy(records: RecordingView[]) {
  const nodes = new Map(
    records.map((record) => [record.id, { children: [] as RecordingView[], record }]),
  );
  const roots: RecordingView[] = [];

  for (const record of records) {
    const parent =
      record.parent_id && record.parent_id !== record.id
        ? nodes.get(record.parent_id)
        : null;
    if (parent) parent.children.push(record);
    else roots.push(record);
  }

  const byNewest = (left: RecordingView, right: RecordingView) =>
    recordingTime(right) - recordingTime(left);
  roots.sort(byNewest);
  for (const node of nodes.values()) node.children.sort(byNewest);

  const ordered: RecordingView[] = [];
  const visited = new Set<string>();
  const visit = (record: RecordingView) => {
    if (visited.has(record.id)) return;
    visited.add(record.id);
    ordered.push(record);
    for (const child of nodes.get(record.id)?.children || []) visit(child);
  };

  for (const root of roots) visit(root);
  for (const record of records) visit(record);
  return ordered;
}

function recordingTime(recording: RecordingView) {
  const timestamp = Date.parse(recording.created_at);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function HighlightedTranscriptText({
  fillerWords,
  text,
}: {
  fillerWords: FillerWord[];
  text: string;
}) {
  return (
    <>
      {highlightTranscriptText(text, fillerWords).map((part, index) =>
        part.fillerWord ? (
          <span
            className="fillerHighlight"
            key={`${index}-${part.text}`}
            style={{ backgroundColor: part.fillerWord.color }}
            title={`口头词：${part.fillerWord.text}`}
          >
            {part.text}
          </span>
        ) : (
          <span key={`${index}-${part.text}`}>{part.text}</span>
        ),
      )}
    </>
  );
}

function WaveformStrip({
  active,
  currentTime,
  onSeek,
  sentence,
  waveform,
}: {
  active: boolean;
  currentTime: number;
  onSeek: (time: number) => void;
  sentence: TranscriptSentence;
  waveform: WaveformDocument | null;
}) {
  const bars = useMemo(
    () => sentenceWaveformBars(sentence, waveform, WAVEFORM_BARS_PER_SENTENCE),
    [sentence, waveform],
  );
  const span = Math.max(0.01, sentence.end - sentence.start);
  const progress = active
    ? Math.min(Math.max((currentTime - sentence.start) / span, 0), 1)
    : null;

  function handleSeek(event: MouseEvent<HTMLButtonElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = rect.width
      ? Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1)
      : 0;
    onSeek(sentence.start + ratio * span);
  }

  return (
    <button
      aria-label={`${formatDuration(sentence.start)} 至 ${formatDuration(
        sentence.end,
      )} 的音波图`}
      className={active ? "waveformStrip active" : "waveformStrip"}
      onClick={handleSeek}
      type="button"
    >
      <span className="waveformBars">
        {bars.map((height, index) => (
          <i
            aria-hidden="true"
            key={`${index}-${height}`}
            style={{ height: `${Math.round(16 + height * 68)}%` }}
          />
        ))}
        {progress !== null && (
          <span
            aria-hidden="true"
            className="waveformPlayhead"
            style={{ left: `${progress * 100}%` }}
          />
        )}
      </span>
    </button>
  );
}

function sentenceWaveformBars(
  sentence: TranscriptSentence,
  waveform: WaveformDocument | null,
  barCount: number,
) {
  if (waveform?.status === "ready" && waveform.peaks.length && waveform.duration > 0) {
    const startIndex = Math.floor(
      (Math.max(0, sentence.start) / waveform.duration) * waveform.peaks.length,
    );
    const endIndex = Math.max(
      startIndex + 1,
      Math.ceil(
        (Math.max(sentence.end, sentence.start + 0.01) / waveform.duration) *
          waveform.peaks.length,
      ),
    );
    return resamplePeaks(
      waveform.peaks.slice(
        Math.min(startIndex, waveform.peaks.length - 1),
        Math.min(endIndex, waveform.peaks.length),
      ),
      barCount,
    );
  }

  return fallbackBars(sentence, barCount);
}

function resamplePeaks(peaks: number[], targetCount: number) {
  if (!peaks.length) return Array.from({ length: targetCount }, () => 0.12);

  return Array.from({ length: targetCount }, (_, index) => {
    const start = Math.floor((index / targetCount) * peaks.length);
    const end = Math.max(
      start + 1,
      Math.floor(((index + 1) / targetCount) * peaks.length),
    );
    const segment = peaks.slice(start, end);
    return Math.min(Math.max(Math.max(...segment), 0.04), 1);
  });
}

function fallbackBars(sentence: TranscriptSentence, targetCount: number) {
  const seed = Math.max(
    1,
    Math.round(sentence.start * 31 + sentence.end * 17 + sentence.text.length * 13),
  );
  return Array.from({ length: targetCount }, (_, index) => {
    const wave = Math.sin((index + seed) * 0.53) * 0.5 + 0.5;
    const pulse = Math.sin((index + seed) * 0.17) * 0.5 + 0.5;
    return 0.12 + wave * 0.5 + pulse * 0.22;
  });
}

async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to the textarea strategy when browser permissions block it.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.left = "-9999px";
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    const copied = document.execCommand("copy");
    if (!copied) throw new Error("Copy command failed.");
  } finally {
    document.body.removeChild(textarea);
  }
}

function cloneDefaultReviewNoteSections() {
  return DEFAULT_REVIEW_NOTE_SECTIONS.map((section) => ({ ...section }));
}

function createReviewSectionId(title: string, index: number) {
  const normalized = title.trim().toLowerCase() || "section";
  return `note-${index}-${Array.from(normalized)
    .map((char) => char.charCodeAt(0).toString(36))
    .join("")
    .slice(0, 18)}`;
}

function parseReviewNotes(notes: string): ReviewNoteSection[] {
  const cleanNotes = notes.trim();
  if (!cleanNotes) return cloneDefaultReviewNoteSections();

  const sections: ReviewNoteSection[] = [];
  const legacyLines: string[] = [];
  let currentSection: ReviewNoteSection | null = null;

  for (const line of cleanNotes.replace(/\r\n/g, "\n").split("\n")) {
    const heading = line.match(/^【(.{1,24})】$/);
    if (heading) {
      if (currentSection) sections.push(trimSectionBody(currentSection));
      currentSection = {
        id: createReviewSectionId(heading[1], sections.length),
        title: heading[1].trim() || "未命名",
        body: "",
      };
      continue;
    }

    if (currentSection) {
      currentSection.body += `${currentSection.body ? "\n" : ""}${line}`;
    } else {
      legacyLines.push(line);
    }
  }

  if (currentSection) sections.push(trimSectionBody(currentSection));

  if (!sections.length) {
    const defaults = cloneDefaultReviewNoteSections();
    defaults[0] = { ...defaults[0], body: legacyLines.join("\n").trim() };
    return defaults;
  }

  if (legacyLines.join("").trim()) {
    sections.unshift({
      id: "viewpoint",
      title: "观点层",
      body: legacyLines.join("\n").trim(),
    });
  }

  return sections.length ? sections : cloneDefaultReviewNoteSections();
}

function trimSectionBody(section: ReviewNoteSection) {
  return {
    ...section,
    body: section.body.replace(/\n+$/g, ""),
    title: section.title.trim() || "未命名",
  };
}

function serializeReviewNotes(sections: ReviewNoteSection[]) {
  const hasAnyBody = sections.some((section) => section.body.trim());
  if (!hasAnyBody) return "";

  const cleanedSections = sections
    .map(trimSectionBody)
    .filter((section) => section.body.trim() || isDefaultReviewSection(section));

  return cleanedSections
    .map((section) => `【${section.title.slice(0, 24)}】\n${section.body}`)
    .join("\n\n")
    .slice(0, MAX_NOTES_LENGTH);
}

function isDefaultReviewSection(section: ReviewNoteSection) {
  return (
    DEFAULT_REVIEW_NOTE_SECTIONS.some(
      (defaultSection) =>
        defaultSection.id === section.id && defaultSection.title === section.title,
    )
  );
}

function resizeReviewTextarea(textarea: HTMLTextAreaElement | null) {
  if (!textarea) return;
  textarea.style.height = "auto";
  textarea.style.height = `${Math.max(280, textarea.scrollHeight)}px`;
}

function countFillerWordOccurrences(text: string, fillerWords: FillerWord[]) {
  const stats = fillerWords
    .map((word) => ({
      word,
      count: countNonOverlappingOccurrences(text, word.text),
    }))
    .filter((stat) => stat.word.text.trim())
    .sort((left, right) => {
      if (right.count !== left.count) return right.count - left.count;
      return right.word.text.length - left.word.text.length;
    });

  return stats;
}

function countNonOverlappingOccurrences(text: string, needle: string) {
  const cleanNeedle = needle.trim().toLowerCase();
  if (!text || !cleanNeedle) return 0;

  const haystack = text.toLowerCase();
  let count = 0;
  let index = 0;

  while (index < haystack.length) {
    const foundAt = haystack.indexOf(cleanNeedle, index);
    if (foundAt < 0) break;
    count += 1;
    index = foundAt + cleanNeedle.length;
  }

  return count;
}

function highlightTranscriptText(text: string, fillerWords: FillerWord[]) {
  const words = fillerWords
    .map((word) => ({ ...word, text: word.text.trim() }))
    .filter((word) => word.text)
    .sort((left, right) => right.text.length - left.text.length);

  if (!text || !words.length) return [{ text }];

  const parts: Array<{ fillerWord?: FillerWord; text: string }> = [];
  const lowerText = text.toLowerCase();
  let index = 0;

  while (index < text.length) {
    const matched = words.find((word) =>
      lowerText.startsWith(word.text.toLowerCase(), index),
    );

    if (matched) {
      parts.push({
        fillerWord: matched,
        text: text.slice(index, index + matched.text.length),
      });
      index += matched.text.length;
    } else {
      const nextIndex = index + 1;
      const previous = parts[parts.length - 1];
      const nextChar = text.slice(index, nextIndex);
      if (previous && !previous.fillerWord) {
        previous.text += nextChar;
      } else {
        parts.push({ text: nextChar });
      }
      index = nextIndex;
    }
  }

  return parts;
}

function findActiveSentence(sentences: TranscriptSentence[], currentTime: number) {
  if (!sentences.length) return -1;
  const exact = sentences.findIndex(
    (sentence) => currentTime >= sentence.start && currentTime < sentence.end,
  );
  if (exact >= 0) return exact;

  for (let index = sentences.length - 1; index >= 0; index -= 1) {
    if (currentTime >= sentences[index].start) return index;
  }

  return 0;
}
