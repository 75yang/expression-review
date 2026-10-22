"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { discoverFillers } from "@/lib/filler-discovery";
import "../portfolio.css";

const SAMPLE = "我觉得，我们可以先试用新的会议模板。然后先准备材料，然后开会讨论。就是说，每个人先写一句结论。就是说，先让大家知道要决定什么。就是说，把背景放在结论后面。我我我觉得这样更容易讨论。";
export default function Demo() {
  const [text, setText] = useState(SAMPLE);
  const candidates = useMemo(() => discoverFillers(text), [text]);
  return <div className="portfolio"><header className="portfolioNav"><Link href="/">← Expression Review</Link><span>合成文本演示</span></header>
    <section className="portfolioHero" style={{paddingBottom:24}}><p className="portfolioEyebrow">INTERACTIVE DEMO</p><h1>从一句话开始，<br/><span>发现表达习惯。</span></h1><p>输入一段口语文字，查看可能影响表达节奏的重复词和连接词。</p></section>
    <label htmlFor="demo-text">待分析文本（最多 5,000 字）</label><textarea id="demo-text" value={text} maxLength={5000} onChange={(event) => setText(event.target.value)}/>
    <p className="portfolioNote">示例为展示编写，不来自真实录音。候选不是诊断结果；完整工作台另提供逐处确认和回听。</p>
    <div className="portfolioDemoList" aria-live="polite">{candidates.length ? candidates.map((candidate) => <article key={candidate.text}><details><summary><strong>{candidate.text}</strong> · {candidate.count} 次 · 每千字 {candidate.perThousand} 次</summary><p><small>{candidate.reason}</small></p>{candidate.occurrences.map((occurrence) => <p key={occurrence.offset}>{occurrence.context.slice(0, occurrence.targetIndex)}<mark>{candidate.text}</mark>{occurrence.context.slice(occurrence.targetIndex + candidate.text.length)}</p>)}</details></article>) : <p>暂未发现候选。可以输入更长的表达片段。</p>}</div>
    <footer className="portfolioNav"><Link href="/">作品介绍</Link><Link href="/app">进入完整工作台 →</Link></footer></div>;
}
