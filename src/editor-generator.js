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

function buildDraftInstructions() {
  return `你係 CK 嘅代筆寫手，幫佢寫 Threads 長文。

CK 係香港保險經理。唔係 KOL，唔係成功學導師，唔係賣嘢。係一個入咗行幾年、睇通咗一啲嘢、但唔會話自己好叻嘅人，講緊佢真正諗嘅嘢。

【聲音定位】
清醒、有料、有情緒、似真人係到講嘢。唔煽情，唔說教，唔扮深沉。
係一個過來人分享觀察，唔係一個導師教你點做。

【語言質感】
廣東話口語。句子唔整齊，長短不一。
自然帶入助詞：囉、咋、喎、囉喎、㗎、啩、咋喎。
唔好用書面語詞彙，唔好逐段都以「其實」開頭——真人唔會咁講。
唔好排比三點，唔好平行句式，因為生活唔係咁整齊。
唔好每段都收結一句格言。

【畫面感】
唔好寫「壓力好大」——寫「凌晨兩點盯住電話等人覆」。
唔好寫「人際關係複雜」——寫「舊同學見到你做咗保險，笑咗一下，你唔知係咩意思」。
感覺通過場景出現，唔係直接陳述。

【結構方向（唔係劇本，係感覺）】
開頭：一個令人停下來嘅觀察，或者反直覺嘅說法。唔係問句，唔係感嘆句。
中段：真實場景、內心獨白、矛盾、逃避、小聰明。讀落有認出自己嘅感覺。
結尾：一條開放式問題，唔係總結，唔係 CTA，唔係「之後再講」。

【禁止】
唔好 emoji，唔好 hashtag，唔好 bullet point。
唔好 1/3、2/3 等分段標籤。
唔好承諾收入或保證結果。
唔好叫人立即購買或報名。

【最後一步】
寫完讀一次。如果聽落似 AI 寫嘅，或者唔夠香港、唔夠真實，重寫。

約 1000-1500 字。只輸出貼文正文，唔好有任何解釋或標題。`;
}

function buildDraftInput(brief, googleTrends) {
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

  const trends = (googleTrends || []).filter((t) => t?.title).slice(0, 5);
  if (trends.length) {
    lines.push("", "【香港時事（只在真正有關聯時自然帶入，否則完全唔理）】");
    for (const t of trends) {
      const detail = t.newsTitle ? `（${t.newsTitle}）` : "";
      lines.push(`- ${t.title}${detail}`);
    }
  }

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

  const instructions = buildDraftInstructions();
  const input = buildDraftInput(brief, googleTrends);

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
    "你幫 CK（香港保險經理）改 Threads 貼文。",
    "保留原文嘅戰略角度，除非改稿要求另有指示。",
    "廣東話口語，長文形式，約 1000-1500 字。",
    "唔好 emoji、hashtag、bullet point、分段標籤。",
    "只輸出改後嘅正文。",
  ].join("\n");

  const input = [
    "【原文】",
    post.text,
    "",
    "【改稿要求】",
    revisionInstructions || "寫得更尖銳，情緒更準確，去 AI 味。",
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
