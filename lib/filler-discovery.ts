export type OccurrenceDecision = "filler" | "normal" | "unsure";
export type FillerOccurrence = { offset: number; context: string; targetIndex: number; start: number | null };
export type FillerCandidate = {
  text: string;
  reason: string;
  count: number;
  perThousand: number;
  perMinute: number | null;
  occurrences: FillerOccurrence[];
};

const COMMON = ["嗯", "呃", "额", "然后", "就是", "那个", "这个", "其实", "所以", "对吧", "是吧", "就是说", "怎么说呢", "你知道吧", "我觉得", "某种程度上", "相当于", "基本上", "反正", "总之", "的话", "实际上", "说白了"];
const STOP = new Set(["我们", "你们", "他们", "自己", "一个", "可以", "没有", "因为", "但是", "如果", "什么", "时候", "已经", "需要", "问题", "事情"]);

export function occurrenceKey(text: string, offset: number) {
  return `${offset}:${text}`;
}

export function findOffsets(text: string, term: string) {
  const offsets: number[] = [];
  if (!term) return offsets;
  let from = 0;
  while (from < text.length) {
    const offset = text.indexOf(term, from);
    if (offset < 0) break;
    offsets.push(offset);
    from = offset + term.length;
  }
  return offsets;
}

export function discoverFillers(
  text: string,
  sentences: { text: string; start: number }[] = [],
  duration = 0,
  known: string[] = [],
): FillerCandidate[] {
  const terms = new Map<string, string>();
  for (const term of [...COMMON, ...known]) {
    if (term && text.includes(term)) terms.set(term, known.includes(term) ? "已有词条" : "常见填充或衔接词，需核对用途");
  }
  // Only combine complete word segments within a clause, never arbitrary Chinese substrings.
  const segmenter = new Intl.Segmenter("zh", { granularity: "word" });
  const frequency = new Map<string, number>();
  for (const clause of text.split(/[，。！？；、,!.?;\n\r]+/u)) {
    const words = [...segmenter.segment(clause)].filter((part) => part.isWordLike).map((part) => part.segment);
    for (let i = 0; i < words.length; i++) {
      let phrase = "";
      for (let width = 0; width < 4 && i + width < words.length; width++) {
        phrase += words[i + width];
        if (phrase.length > 12) break;
        if (phrase.length >= 3 && !STOP.has(phrase) && !/^\d+$/u.test(phrase)) {
          frequency.set(phrase, (frequency.get(phrase) || 0) + 1);
        }
      }
    }
  }
  const repeated = [...frequency].filter(([, count]) => count >= 3).sort((a, b) => b[1] - a[1] || b[0].length - a[0].length);
  for (const [phrase, count] of repeated) {
    if (terms.size >= COMMON.length + known.length + 60) break;
    if (terms.has(phrase)) continue;
    if (repeated.some(([longer, n]) => longer.length > phrase.length && longer.includes(phrase) && n === count)) continue;
    terms.set(phrase, "重复词组，也可能是主题词");
  }
  for (const match of text.matchAll(/([\p{Script=Han}])\1{1,}/gu)) {
    if (!["人", "天", "常", "渐", "慢", "好", "哈", "看", "想", "试"].includes(match[1])) terms.set(match[0], "相邻重复，需回听确认是否为重启表达");
  }

  let cursor = 0;
  const spans = sentences.flatMap((sentence) => {
    const offset = text.indexOf(sentence.text, cursor);
    if (offset < 0 || !sentence.text) return [];
    cursor = offset + sentence.text.length;
    return [{ offset, end: cursor, start: sentence.start }];
  });
  const characters = [...text.replace(/[\s\p{P}]/gu, "")].length;
  return [...terms].map(([term, reason]) => {
    const offsets = findOffsets(text, term);
    return {
      text: term, reason, count: offsets.length,
      perThousand: characters ? Number((offsets.length * 1000 / characters).toFixed(1)) : 0,
      perMinute: duration > 0 ? Number((offsets.length * 60 / duration).toFixed(1)) : null,
      occurrences: offsets.map((offset) => ({
        offset,
        context: text.slice(Math.max(0, offset - 35), Math.min(text.length, offset + term.length + 45)),
        targetIndex: Math.min(offset, 35),
        start: spans.find((span) => offset >= span.offset && offset + term.length <= span.end)?.start ?? null,
      })),
    };
  }).filter((candidate) => candidate.count > 0).sort((a, b) =>
    Number(b.reason !== "重复词组，也可能是主题词") - Number(a.reason !== "重复词组，也可能是主题词") || b.count - a.count || b.text.length - a.text.length);
}
