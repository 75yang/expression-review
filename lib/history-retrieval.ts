type HistoryRecord = {
  id: string; parent_id: string | null; title: string; created_at: string;
  tags: string[]; full_text: string;
};
export type HistorySource = {
  id: string; title: string; createdAt: string; excerpt: string; offset: number;
  reason: string; url: string;
};

const STOP = new Set(["这个", "那个", "然后", "就是", "我们", "你们", "他们", "自己", "一个", "可以", "没有", "觉得", "所以", "其实", "的话", "因为", "但是", "什么", "还是", "需要", "时候", "现在", "一些", "已经"]);
function tokens(text: string) {
  return [...new Intl.Segmenter("zh", { granularity: "word" }).segment(text)]
    .filter((part) => part.isWordLike && part.segment.length > 1 && !STOP.has(part.segment) && !/^\d+$/.test(part.segment))
    .map((part) => part.segment.toLowerCase());
}

export function retrieveHistory(current: HistoryRecord, records: HistoryRecord[], limit = 4): HistorySource[] {
  const queryCounts = new Map<string, number>();
  for (const token of tokens(current.full_text)) queryCounts.set(token, (queryCounts.get(token) || 0) + 1);
  const query = new Set([...tokens(`${current.title} ${current.tags.join(" ")}`), ...[...queryCounts].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([token]) => token)]);
  const candidates = records.filter((record) => record.id !== current.id && record.full_text.trim() && record.created_at <= current.created_at);
  const documents = candidates.map((record) => ({ record, terms: new Set(tokens(record.full_text)) }));
  const weight = (token: string) => 1 + Math.log((documents.length + 1) / (1 + documents.filter((doc) => doc.terms.has(token)).length));
  const ranked = documents.map(({ record }) => {
    let best = { excerpt: "", offset: 0, score: 0, matches: 0 };
    // Overlapping character windows preserve exact source offsets for auditability.
    for (let offset = 0; offset < record.full_text.length; offset += 400) {
      const excerpt = record.full_text.slice(offset, offset + 600);
      const terms = new Set(tokens(excerpt));
      const matches = [...query].filter((token) => terms.has(token));
      const score = matches.reduce((sum, token) => sum + weight(token), 0);
      if (!best.excerpt || score > best.score) best = { excerpt, offset, score, matches: matches.length };
    }
    const parent = current.parent_id === record.id;
    const sibling = Boolean(current.parent_id && current.parent_id === record.parent_id);
    const sharedTags = record.tags.filter((tag) => current.tags.includes(tag)).length;
    return { record, best, parent, sibling, score: best.score + sharedTags * 2 + (parent ? 1000 : sibling ? 10 : 0) };
  }).filter((item) => item.parent || item.sibling || item.best.matches >= 2)
    .sort((a, b) => b.score - a.score || b.record.created_at.localeCompare(a.record.created_at));
  return ranked.slice(0, limit).map(({ record, best, parent, sibling }) => ({
    id: record.id, title: record.title, createdAt: record.created_at,
    excerpt: best.excerpt, offset: best.offset,
    reason: parent ? "本次录制的原稿（片段）" : sibling ? "同一原稿的较早练习（片段）" : "主题关键词相关片段",
    url: `/app/${encodeURIComponent(record.id)}`,
  }));
}
