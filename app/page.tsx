import Link from "next/link";
import "./portfolio.css";

const Waveform = ({ active = false }: { active?: boolean }) => (
  <span className={`portfolioWaveform${active ? " active" : ""}`} aria-hidden="true">
    {[8, 16, 10, 22, 30, 18, 12, 26, 34, 20, 15, 28, 18, 9, 24, 31, 17, 12, 20].map((height, index) => <i key={index} style={{ height }} />)}
  </span>
);

export default function Home() {
  return <div className="portfolio">
    <header className="portfolioNav"><Link href="/">言 · Expression Review</Link><nav aria-label="作品导航"><a href="#workflow">训练流程</a><a href="#review">复盘方式</a><Link href="/demo">文本体验 ↗</Link></nav></header>
    <section className="portfolioHero"><p className="portfolioEyebrow">让每一次表达，都成为下一次的参照</p><h1>听见自己。<br/><span>把下一次说得更好。</span></h1><p className="portfolioLead">录下表达，将声音转成可定位的文稿；对照视频、声音与音波回看，再从表述和叙事两个层面完成复盘。</p><div className="portfolioActions"><Link className="portfolioPrimary" href="/app">打开训练工作台 →</Link><Link href="/demo">体验文本分析</Link></div></section>
    <section className="portfolioStage" aria-label="视频、文稿与音波联动示意"><div className="portfolioPlayer"><div className="portfolioVideo"><span className="portfolioPlay">▶</span><span className="portfolioVideoLabel">表达练习 · 第 2 次</span></div><div className="portfolioTimeline"><span>01:24</span><div><i /></div><span>03:18</span></div><div className="portfolioStageCaption"><strong>同一时间轴上的完整现场</strong><span>视频画面、原声、逐句文稿与音波同步定位</span></div></div><div className="portfolioTranscript"><div className="portfolioPanelTitle"><span>逐句文稿</span><small>点击任一句，回到对应画面</small></div><article><time>01:18</time><Waveform/><p>我们先说结论，这次调整主要解决两个问题。</p></article><article className="active"><time>01:24</time><Waveform active/><p>第一，听的人能不能立刻知道我想表达什么。</p></article><article><time>01:31</time><Waveform/><p>第二，后面的例子有没有真正支持这个判断。</p></article></div></section>
    <section className="portfolioWorkflow" id="workflow"><div className="portfolioSectionIntro"><p className="portfolioEyebrow">一条连续的训练路径</p><h2>从开口，到看见问题，再到重新表达。</h2></div><ol><li><span>01</span><div><h3>录制与导入</h3><p>直接录音、录像，或导入已有素材；多次重录保留在同一练习脉络中。</p></div></li><li><span>02</span><div><h3>语音转文稿</h3><p>将声音转成带时间位置的逐句文本，让内容可搜索、可回看、可比较。</p></div></li><li><span>03</span><div><h3>音画文联动</h3><p>播放进度、视频、原声、音波与当前句同步，点击文字即可定位回听。</p></div></li><li><span>04</span><div><h3>复盘与重录</h3><p>留下具体判断和下一轮目标，再用新的表达验证修改是否真正有效。</p></div></li></ol></section>
    <section className="portfolioReview" id="review"><div className="portfolioSectionIntro"><p className="portfolioEyebrow">内容复盘</p><h2>一句话怎么说，和整段话为什么成立，分开来看。</h2></div><div className="portfolioReviewGrid"><article><span className="portfolioReviewNumber">A</span><p className="portfolioEyebrow">表述层</p><h3>让每一句更清楚</h3><ul><li>开头是否直接进入主题</li><li>句子是否重复、绕行或指代不清</li><li>衔接、节奏和信息密度是否合适</li><li>给出忠于原意的参考改写</li></ul></article><article><span className="portfolioReviewNumber">B</span><p className="portfolioEyebrow">叙事层</p><h3>让整段表达更成立</h3><ul><li>核心主张是否明确</li><li>论点、证据与结论能否互相支撑</li><li>故事顺序是否帮助听者理解</li><li>对照历史表达，找到下一次的组织方式</li></ul></article></div></section>
    <section className="portfolioFiller"><div><p className="portfolioEyebrow">口头习惯辅助</p><h2>发现高频词，也保留语境。</h2></div><p>自动找出填充词、重复词组和表达重启，统计出现位置；回到原句逐处核对，区分真正的口癖与正常用词。</p><Link href="/demo">试试文本分析 →</Link></section>
    <section className="portfolioBottom"><p className="portfolioEyebrow">Expression Review</p><h2>完整记录一次表达如何发生，也记录它如何变得更好。</h2><Link className="portfolioPrimary" href="/app">进入工作台 →</Link></section>
    <footer className="portfolioNav"><span>Expression Review · MIT</span><Link href="/demo">文本体验 →</Link></footer>
  </div>;
}
