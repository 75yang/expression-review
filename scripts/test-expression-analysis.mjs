import assert from "node:assert/strict";
import { test } from "node:test";
import { discoverFillers, findOffsets, occurrenceKey } from "../lib/filler-discovery.ts";
import { retrieveHistory } from "../lib/history-retrieval.ts";

test("full counts preserve normal uses and repeated sentence timestamps", () => {
  const text = "先提交，然后等待。然后我觉得，然后再说。";
  const candidates = discoverFillers(text, [{ text: "先提交，然后等待。", start: 0 }, { text: "然后我觉得，然后再说。", start: 6 }], 60);
  const term = candidates.find((candidate) => candidate.text === "然后");
  assert.equal(term.count, 3);
  assert.equal(term.perMinute, 3);
  assert.deepEqual(term.occurrences.map((o) => o.start), [0, 6, 6]);
  for (const o of term.occurrences) assert.equal(o.context.slice(o.targetIndex, o.targetIndex + 2), "然后");
  assert.notEqual(occurrenceKey("然后", 0), occurrenceKey("然后", 6));
});

test("unknown repeated phrases and restart words are discovered", () => {
  const candidates = discoverFillers("换句话说，我们出发。换句话说，需要准备。换句话说，要安排。我我我想说。", [], 0);
  assert.ok(candidates.some((candidate) => candidate.text.includes("换句话说")));
  assert.ok(candidates.some((candidate) => candidate.text === "我我我"));
  assert.ok(candidates.every((candidate) => candidate.perMinute === null));
});

test("no invented timestamps, no empty matches or arbitrary substring counts", () => {
  assert.deepEqual(discoverFillers(""), []);
  assert.deepEqual(findOffsets("哈哈哈", ""), []);
  assert.deepEqual(findOffsets("哈哈哈", "哈哈"), [0]);
  const candidate = discoverFillers("我的独特说法。", [{ text: "不匹配的句子", start: 5 }], 0, ["独特说法"])[0];
  assert.equal(candidate.count, 1);
  assert.equal(candidate.occurrences[0].start, null);
});

const record = (id, full_text, extra = {}) => ({ id, full_text, title: "练习", tags: [], created_at: "2026-10-01", parent_id: null, ...extra });
test("retrieval excludes self, future records and unrelated records", () => {
  const current = record("now", "项目预算需要控制，项目进度需要安排。", { created_at: "2026-10-03" });
  const history = [current, record("future", current.full_text, { created_at: "2026-10-04" }), record("unrelated", "今天吃水果，明天去爬山。"), record("match", "我们需要安排项目预算和项目进度。")];
  const sources = retrieveHistory(current, history);
  assert.deepEqual(sources.map((source) => source.id), ["match"]);
  assert.equal(sources[0].excerpt, history[3].full_text.slice(sources[0].offset, sources[0].offset + 600));
});

test("explicit parent takes priority even without topic overlap; empty library works", () => {
  const current = record("now", "今天谈预算", { parent_id: "parent", created_at: "2026-10-03" });
  const sources = retrieveHistory(current, [record("parent", "以前聊的是完全不同的内容")]);
  assert.equal(sources[0].id, "parent");
  assert.match(sources[0].reason, /原稿/);
  assert.deepEqual(retrieveHistory(current, []), []);
});
