import { readJson, writeJson } from "./storage.js";
import { generateText } from "./openrouter-api.js";
import { fetchHongKongTrends } from "./google-trends.js";

const POSTS_PATH = "data/posts.json";
const BRIEFS_PATH = "data/editor-briefs.json";
const BRAND_GUIDE_PATH = "data/brand-guide.json";

function stableIndex(value, length) {
  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash % length;
}

function normalizeGeneratedPost(text) {
  return text
    .replace(/^["'「『]+|["'」』]+$/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function getPostId(date, slot) {
  return `${date}-${slot.replace(":", "")}`;
}

async function loadEditorialContext(date, slot) {
  const briefs = await readJson(BRIEFS_PATH, []);
  const brandGuide = await readJson(BRAND_GUIDE_PATH, {});

  if (briefs.length === 0) {
    throw new Error("No editorial briefs found.");
  }

  const brief = briefs[stableIndex(`${date}-${slot}`, briefs.length)];
  return { brief, brandGuide };
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

  const instructions = [
    "你係一位熟悉香港保險行業、保險銷售心理、保險新人痛點同團隊招募文案嘅 Threads 寫手。",
    "請幫一位做咗一段時間、有實戰經驗、睇得清保險行業心理結構嘅保險經理，寫一篇 Threads 長文。",
    "目標讀者：正在做保險嘅新人／中生代 agent；曾經想放棄、收入唔穩、怕搵人、怕被拒絕嘅保險人；準備入行但心入面有猶豫嘅人；想知保險行業真相，而唔係淨係睇成功故事嘅人。",
    "語氣要神秘、有料、清醒、真實，不要太雞血，不要太 sales，不要扮成功學導師。",
    "文章定位係：保險人心入面不敢講出口嘅真相。唔係炫耀自己幾成功，而係講出保險人心入面最真實但平時唔敢講嘅位。",
    "Write in Hong Kong Cantonese only.",
    "Write around 1000 to 1500 Chinese characters.",
    "Use proper paragraph breaks for a Threads long-form post. The system will split long text into one main post plus replies, so do not add manual part labels like 1/3 or continued below.",
    "Start with a counterintuitive or inner-voice style title.",
    "Structure: first show what outsiders think insurance sales is like; then reverse it with what people discover after entering the industry; then deeply unpack the inner contradiction; include real daily scenes such as no one replying to messages, fear of follow-up, fear of approaching friends, rejection, peers hitting targets, and unstable income; elevate the problem from not working hard enough to lacking system, psychological support, and market building; then land on the mature view that insurance sales depends on system, discipline, mindset, and long-term market cultivation.",
    "End with one open-ended question that invites insurance people to comment or DM without hard selling.",
    "Do not use emoji.",
    "Do not use bullet points.",
    "Do not use hashtags.",
    "Do not hard sell.",
    "Do not only tell people to persist.",
    "Do not stack too many quote-like slogans.",
    "Write like a real person, not like AI.",
    "Write with depth, emotion, visual scenes, humanity, fear, insecurity, internal conflict, avoidance, dignity, desire for success, and fear of failure.",
    "Use Google Trends context only when a trend can be naturally connected to insurance sales, insurance career psychology, AI-assisted insurance work, trust, risk, income instability, public anxiety, family responsibility, or sales systems.",
    "If no trend is relevant, ignore the trends completely. Do not force a trend, celebrity, news event, or keyword into the post.",
    "Never imply false facts about insurance, income, or the trending topic.",
    "Output only the final Threads post text. Do not include explanations."
  ].join("\n");

  const input = JSON.stringify({
    task: "Write one Threads post draft.",
    date,
    slot,
    brand_guide: brandGuide,
    editorial_angle: brief,
    hong_kong_google_trends: googleTrends
  }, null, 2);

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
    "You revise Threads posts for a Hong Kong insurance-sales audience.",
    "Preserve the strategic angle unless the revision instruction says otherwise.",
    "Write in Hong Kong Cantonese.",
    "Keep it as a long-form Threads post around 1000 to 1500 Chinese characters unless the user asks for a different length.",
    "Use paragraph breaks, but do not add manual part labels.",
    "No emoji, hashtags, bullets, hard sell, or empty motivational slogans.",
    "Output only the revised post text."
  ].join("\n");

  const input = JSON.stringify({
    task: "Revise the Threads post based on the user's instruction.",
    brand_guide: brandGuide,
    original_post: post.text,
    revision_instruction: revisionInstructions || "Make it sharper, more curious, and more emotionally precise."
  }, null, 2);

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
