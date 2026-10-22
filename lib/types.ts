export type Locale = "en" | "zh";

export type ClarificationOption = {
  id: string;
  label: string;
};

export type ClarificationQuestion = {
  id: string;
  prompt: string;
  allowMultiple: boolean;
  options: ClarificationOption[];
};

export type FinalExpression = {
  preciseName: string;
  concreteExplanation: string;
  copyableExpression: string;
};

export type AgentTurn = {
  phase: "clarify" | "ready" | "final";
  diagnosis: string[];
  understanding: string;
  questions: ClarificationQuestion[];
  final: FinalExpression | null;
};

export type ConversationItem =
  | { kind: "user"; text: string }
  | { kind: "agent"; turn: AgentTurn };

export type ChatResponse = {
  turn: AgentTurn;
};

export type TranscriptSentence = {
  start: number;
  end: number;
  text: string;
};

export type TranscriptDocument = {
  id: string;
  language: "zh" | "unknown";
  created_at: string;
  sentences: TranscriptSentence[];
  full_text: string;
  status: "ready" | "empty" | "error";
  error?: string;
};

export type WaveformDocument = {
  id: string;
  created_at: string;
  duration: number;
  sample_rate: number;
  peaks_per_second: number;
  peaks: number[];
  status: "ready" | "empty" | "error";
  error?: string;
};

export type FillerWord = {
  id: string;
  text: string;
  color: string;
};

export type RecordingRecord = {
  id: string;
  parent_id: string | null;
  client_upload_id: string | null;
  media_type: "video" | "audio";
  title: string;
  created_at: string;
  duration: number;
  video_path: string;
  thumbnail_path: string;
  transcript_path: string;
  tags: string[];
  notes: string;
  full_text: string;
};

export type RecordingView = RecordingRecord & {
  video_url: string;
  thumbnail_url: string;
};

export type RecordingDetail = RecordingView & {
  transcript: TranscriptDocument;
};
