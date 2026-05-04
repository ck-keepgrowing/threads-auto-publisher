import { readJson, writeJson } from "./storage.js";
import { generateText } from "./openrouter-api.js";
import { fetchHongKongTrends } from "./google-trends.js";

const POSTS_PATH = "data/posts.json";
const BRIEFS_PATH = "data/editor-briefs.json";
const BRAND_GUIDE_PATH = "data/brand-guide.json";

function normalizeGeneratedPost(text) {
  return text
    .replace(/^["'「『]+|["'」』]+$/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function getPostId(date, slot) {
  return `${date}-${slot.replace(":", "")}`;
}

function selectBrief(briefs, recentUsage = [], pillarStats = {}) {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const recentPillars = new Set(recentUsage.filter((u) => u.date >= cutoff).map((u) => u.pillar));

  const weights = briefs.map((brief) => {
    let weight = 1.0;
    if (recentPillars.has(brief.pillar)) weight *= 0.15;
    const stats = pillarStats[brief.pillar];
    if (stats?.avgEngagement != null) {
      weight *= 1 + Math.min(stats.avgEngagement / 30, 0.4);
    }
    return Math.max(weight, 0.01);
  });

  const total = weights.reduce((a, b) => a + b, 0);
  let rand = Math.random() * total;
  for (let i = 0; i < briefs.length; i++) {
    rand -= weights[i];
    if (rand <= 0) return briefs[i];
  }
  return briefs[briefs.length - 1];
}

async function loadEditorialContext(date, slot) {
  const [briefs, brandGuide, topicMemory] = await Promise.all([
    readJson(BRIEFS_PATH, []),
    readJson(BRAND_GUIDE_PATH, {}),
    readJson("data/topic-memory.json", { recentUsage: [], pillarStats: {} }),
  ]);

  if (briefs.length === 0) {
    throw new Error("No editorial briefs found.");
  }

  const brief = selectBrief(briefs, topicMemory.recentUsage, topicMemory.pillarStats);
  return { brief, brandGuide };
}

function buildCoreWritingBrief(brandGuide = {}) {
  const tone = (brandGuide.tone || []).map((line) => `- ${line}`).join("\n");
  const softCtas = (brandGuide.soft_cta_examples || []).slice(0, 5).map((line) => `- ${line}`).join("\n");

  return `你係 CK 嘅代筆寫手。

CK 係香港保險經理／銷售系統教練。佢嘅讀者：保險新人、中生代 agent、想入行但有猶豫嘅人。佢哋唔需要被 motivate，需要被 understand，再俾佢哋一個帶得走嘅角度。

【寫作目的（最重要）】
唔係呻苦水，唔係寫散文，唔係喊口號。一篇文章必須做到 4 件事：

1) 切中一個保險人深處嘅痛點。Specific 到讀者讀完會諗「呢條友識我」，唔係「人人都會咁啦」。
2) 用真實場景去驗證痛點。場景係證據，唔係取代觀察。1-2 個夠，唔好 5 個 scene 疊埋一齊。
3) 拆穿表面，講出底層結構。將「個人問題」reframe 成「系統／結構／心態」問題。例如：唔係話術問題，係 pipeline 結構問題；唔係勇氣不足，係冇一個唔消耗自尊嘅流程；唔係不夠努力，係缺乏延遲反饋嘅紀律。冇呢一步，篇文就只係呻。
4) 留低一個帶得走嘅 take-away。可以係：
   - 一個分類框架（例如：核心圈／專業圈／弱關係圈，分別點對待）
   - 一個觀念轉換（例如：唔係「點樣令人 buy」，係「點樣令自己唔需要 sell」）
   - 一個下次遇到相同情況可以用嘅角度／做法
   - 或者一個 anchored open question — 但 question 要建基於前面 reframe 過嘅嘢，唔好 vacuous

冇第 3 同第 4 點，文章就 fail。

【聲音定位】
${tone || "- 清醒、有料、真實\n- 一針見血但不羞辱讀者\n- 神秘但不扮高深\n- 不雞血、不hard sell、不扮成功學導師"}

似一個過來人坐喺隔離傾偈，唔係導師教你點做。
唔好用「你要…」「你應該…」「記住…」「你一定要…」。
唔好標語式句子，唔好成功學味道，唔好過度感性鋪陳——CK 個人風格係穩陣、chill、有實力，唔係催淚 KOL。

【語言質感】
廣東話口語。句子唔整齊，長短不一。
自然帶入助詞：囉、咋、喎、㗎、啩、咋喎、咩、嘅。
唔好成段都以「其實」開頭。
唔好排比三點，唔好平行句式，唔好每段收結一句格言。

【畫面感】
唔好寫「壓力好大」——寫「凌晨兩點盯住電話等人覆」。
唔好寫「人際關係複雜」——寫「舊同學見到你做咗保險，笑咗一下，你唔知係咩意思」。
畫面係用嚟驗證觀察，唔係取代觀察。

【收尾參考（CK 過去用過嘅 take-away angle，借鏡唔好抄）】
${softCtas || "- 真正問題未必係你唔夠努力，而係你冇系統。\n- 你以為你缺勇氣，其實你缺一個唔會消耗自尊嘅流程。"}

【禁止】
唔好 emoji、hashtag、bullet point、分段標籤（1/3、2/3、下篇續）。
唔好承諾收入／保證成交／一定成功／立即購買。
唔好「之後再講」「遲啲再拆」呢類懶惰收尾。
唔好硬 sell，但可以有 soft anchor（讀者覺得「呢個人手上有套嘢」）。

【最後一步：自己 check 一次】
- 第 3 步（底層結構 reframe）有冇真係穿到 surface？定係只係換個方式講同一件事？
- 第 4 步（take-away）讀完真係帶得走？定係一句空泛嘅情緒？
- 夠唔夠 practical？少感性鋪陳、多直接重點、少大道理、多真實應用場景？
答唔到 yes，重寫。

約 1000-1500 字。只輸出貼文正文，唔好有任何解釋、標題或前言。`;
}

function buildDraftInstructions(brandGuide) {
  return buildCoreWritingBrief(brandGuide);
}

function buildDraftInput(brief, googleTrends, brandGuide = {}) {
  const lines = [
    "【今日寫作方向】",
    "",
    `角度：${brief.pillar}`,
    `讀者：${brief.audience}`,
    `切入：${brief.angle}`,
    `感覺：${brief.core_emotion}`,
  ];

  if (brief.example_topics?.length) {
    lines.push("", `參考題目（啟發用，唔係規定）：${brief.example_topics.join("、")}`);
  }

  if (brandGuide.positioning) {
    lines.push("", `【CK 嘅 brand 定位】`, brandGuide.positioning);
  }

  if (brandGuide.business_goal) {
    lines.push("", `【長期目標（影響 take-away 嘅角度）】`, brandGuide.business_goal);
  }

  const trends = (googleTrends || []).filter((t) => t?.title).slice(0, 5);
  if (trends.length) {
    lines.push("", "【香港時事（只在真正有關聯時自然帶入，否則完全唔理）】");
    for (const t of trends) {
      const detail = t.newsTitle ? `（${t.newsTitle}）` : "";
      lines.push(`- ${t.title}${detail}`);
    }
  }

  lines.push(
    "",
    "【提示】",
    "唔好停喺描述痛點。一定要有第 3 步（reframe 底層結構）同第 4 步（帶得走嘅 take-away）。",
    "take-away 可以隱含一個系統／流程／分類框架嘅雛形，但唔好硬 sell。"
  );

  return lines.join("\n");
}

export async function generateDraftPost({ date, slot }) {
  const { brief, brandGuide } = await loadEditorialContext(date, slot);
  let googleTrends = [];

  try {
    googleTrends = await fetchHongKongTrends({
      limit: Number(process.env.GOOGLE_TRENDS_LIMIT || 10)
    });
  } catch (error) {
    console.warn(`Could not fetch Google Trends context: ${error.message}`);
  }

  const instructions = buildDraftInstructions(brandGuide);
  const input = buildDraftInput(brief, googleTrends, brandGuide);

  const text = normalizeGeneratedPost(await generateText({ instructions, input }));
  return {
    id: getPostId(date, slot),
    date,
    slot,
    text,
    status: "ready",
    source: "ai_editor",
    pillar: brief.pillar,
    autoPublish: String(process.env.AUTO_PUBLISH_DRAFTS || "false").toLowerCase() === "true",
    generatedAt: new Date().toISOString()
  };
}

export async function generateRevisedPost({ post, revisionInstructions }) {
  const { brandGuide } = await loadEditorialContext(post.date, post.slot);

  const instructions = [
    buildCoreWritingBrief(brandGuide),
    "",
    "【今次係改稿（唔係由零開始）】",
    "保留原文嘅戰略角度同 take-away 方向，除非改稿要求另有指示。",
    "改稿目標：令 4 個 beat（精準痛點 → 真實場景 → reframe 底層結構 → 帶得走 take-away）更明顯，唔係淨係換措辭。",
    "如果原文缺第 3 步（reframe）或第 4 步（take-away），今次必須補返。",
  ].join("\n");

  const input = [
    "【原文】",
    post.text,
    "",
    "【改稿要求】",
    revisionInstructions || "寫得更尖銳，痛點更精準，補強 reframe 同 take-away，去 AI 味。",
  ].join("\n");

  return normalizeGeneratedPost(await generateText({ instructions, input }));
}

export async function upsertPost(post) {
  const posts = await readJson(POSTS_PATH, []);
  const index = posts.findIndex((item) => item.id === post.id);

  if (index === -1) {
    posts.push(post);
  } else {
    posts[index] = {
      ...posts[index],
      ...post
    };
  }

  await writeJson(POSTS_PATH, posts);
  return post;
}
