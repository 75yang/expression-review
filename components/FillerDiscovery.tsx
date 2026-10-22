"use client";

import { useState } from "react";
import type { FillerWord } from "@/lib/types";
import { occurrenceKey, type FillerCandidate, type OccurrenceDecision } from "@/lib/filler-discovery";

type Result = { candidates: FillerCandidate[]; revision: string; decisions: Record<string, OccurrenceDecision> };
const LABELS = { filler: "口癖", normal: "正常用法", unsure: "不确定" };

export function FillerDiscovery({ id, words, onWords, onSeek }: {
  id: string; words: FillerWord[]; onWords: (words: FillerWord[]) => void; onSeek: (time: number) => void;
}) {
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [message, setMessage] = useState("");
  const [suggestions, setSuggestions] = useState<Record<string, { decision: OccurrenceDecision; reason: string }>>({});
  const endpoint = `/api/recordings/${encodeURIComponent(id)}/filler-discovery`;

  async function discover() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "发现失败。");
      setResult(data); setSuggestions({}); setExpanded(false);
      setMessage(`找到 ${data.candidates.length} 个候选，次数来自全文匹配；候选不等于口癖。`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "发现失败。"); }
    finally { setBusy(false); }
  }

  async function mark(text: string, offset: number, decision: OccurrenceDecision) {
    if (!result) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(endpoint, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision: result.revision, text, offset, decision }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "保存失败。");
      setResult((current) => current ? { ...current, decisions: { ...current.decisions, [occurrenceKey(text, offset)]: decision } } : current);
    } catch (error) { setMessage(error instanceof Error ? error.message : "保存失败。"); }
    finally { setBusy(false); }
  }

  async function add(text: string) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/filler-words", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, color: "#fde68a" }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "入库失败。");
      onWords(data.filler_words); setMessage(`“${text}”已加入词库，后续会自动高亮和统计；每处用途仍需核对。`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "入库失败。"); }
    finally { setBusy(false); }
  }

  async function analyze() {
    setBusy(true); setMessage("正在判断候选词在原句中的用途…");
    try {
      const response = await fetch(endpoint, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "AI 判断失败。");
      if (data.revision !== result?.revision) throw new Error("逐字稿已变化，请重新发现候选。");
      setSuggestions(Object.fromEntries(data.items.map((item: { key: string; decision: OccurrenceDecision; reason: string }) => [item.key, item])));
      setMessage(`AI 给出 ${data.analyzed} 处建议，${data.remaining} 处未判断。建议不会自动计为已确认口癖；每次最多处理 60 处未标记原句。`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "AI 判断失败。"); }
    finally { setBusy(false); }
  }

  return <section className="fillerDiscovery" aria-label="自动发现口癖">
    <div className="fillerDiscoveryHeader"><div><h3>自动发现口癖</h3><p>本地扫描常见填充词、重复词组和相邻重复。转写遗漏的声音无法在这里统计。</p></div>
      <button type="button" disabled={busy} onClick={() => void discover()}>{busy ? "处理中…" : result ? "重新发现" : "发现候选"}</button>
    </div>
    {result && <><p>AI 辅助判断会将最多 60 处候选原句发送给已配置的 AI 服务。</p><button type="button" disabled={busy || !result.candidates.length} onClick={() => void analyze()}>AI 辅助判断用途</button></>}
    <p role="status">{message}</p>
    {result && result.candidates.length > 10 && <button type="button" onClick={() => setExpanded((current) => !current)}>{expanded ? "收起候选" : `查看全部 ${result.candidates.length} 个候选`}</button>}
    {result?.candidates.slice(0, expanded ? undefined : 10).map((candidate) => {
      const counts = { filler: 0, normal: 0, unsure: 0 };
      for (const occurrence of candidate.occurrences) {
        const decision = result.decisions[occurrenceKey(candidate.text, occurrence.offset)];
        if (decision) counts[decision]++;
      }
      const known = words.some((word) => word.text === candidate.text);
      return <details key={candidate.text} className="fillerCandidate">
        <summary><strong>{candidate.text}</strong> · 总计 {candidate.count} 次 · 已确认口癖 {counts.filler} 次 · 正常 {counts.normal} 次 · 不确定 {counts.unsure} 次 · 未核对 {candidate.count - counts.filler - counts.normal - counts.unsure} 次</summary>
        <p>{candidate.reason}。词频：每千字 {candidate.perThousand} 次{candidate.perMinute !== null ? `，每分钟 ${candidate.perMinute} 次` : ""}。不同候选可能重叠，不能直接相加。</p>
        <button type="button" disabled={busy || known} onClick={() => void add(candidate.text)}>{known ? "已在口癖库" : "确认加入词库"}</button>
        <ol>{candidate.occurrences.map((occurrence) => {
          const key = occurrenceKey(candidate.text, occurrence.offset);
          const suggestion = suggestions[key];
          return <li key={key}>
            <p>{occurrence.context.slice(0, occurrence.targetIndex)}<mark>{candidate.text}</mark>{occurrence.context.slice(occurrence.targetIndex + candidate.text.length)}</p>
            {occurrence.start !== null && <button type="button" onClick={() => onSeek(occurrence.start!)}>定位回听 · {Math.floor(occurrence.start / 60)}:{String(Math.floor(occurrence.start % 60)).padStart(2, "0")}</button>}
            {occurrence.start === null && <span>无对应时间位置</span>}
            <span> · 全文第 {occurrence.offset + 1} 字 · </span>
            <label>此处用途 <select aria-label={`${candidate.text} 第 ${occurrence.offset + 1} 字用途`} value={result.decisions[key] || ""} disabled={busy} onChange={(event) => void mark(candidate.text, occurrence.offset, event.target.value as OccurrenceDecision)}>
              <option value="" disabled>未核对</option>{Object.entries(LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></label>
            {suggestion && <p>AI 建议：{LABELS[suggestion.decision]} — {suggestion.reason}</p>}
          </li>;
        })}</ol>
      </details>;
    })}
  </section>;
}
