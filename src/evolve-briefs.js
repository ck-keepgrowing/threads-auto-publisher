import { loadDotEnv } from "./load-env.js";
import { readJson, writeJson } from "./storage.js";
import { generateText } from "./openrouter-api.js";

loadDotEnv();

const BRIEFS_PATH = "data/editor-briefs.json";
const PERFORMANCE_PATH = "data/performance.json";
const PUBLISHED_PATH = "data/published.json";
const NEW_BRIEFS_PER_RUN = 3;
const MIN_SCORED_POSTS = 5;
const MAX_BRIEFS = 40;

function getTopPerformers(performance, published, n = 5) {
  const textMap = new Map(published.map((p) => [p.id, p.text]));
  return [...performance]
    .filter((p) => p.engagementScore > 0)
    .sort((a, b) => b.engagementScore - a.engagementScore)
    .slice(0, n)
    .map((p) => ({
      pillar: p.pillar,
      engagementScore: p.engagementScore,
      metrics: p.metrics,
      text: textMap.get(p.id) || null,
    }))
    .filter((p) => p.text);
}

function pruneBriefs(briefs) {
  if (briefs.length <= MAX_BRIEFS) return briefs;
  const originals = briefs.filter((b) => !b.source);
  const evolved = briefs
    .filter((b) => b.source === "ai_evolved")
    .sort((a, b) => (b.avgEngagement ?? -1) - (a.avgEngagement ?? -1));
  return [...originals, ...evolved.slice(0, MAX_BRIEFS - originals.length)];
}

async function generateNewBriefs(topPerformers, existingBriefs) {
  const existingPillars = existingBriefs.map((b) => b.pillar).join(", ");

  const instructions = [
    "You are an editorial strategy AI for a Hong Kong insurance professional's Threads account.",
    "Generate new editorial brief angles based on high-performing post patterns.",
    "Output ONLY a valid JSON array of exactly 3 brief objects. No explanation, no markdown, no code block.",
    "Each object must have: pillar (2-6 Chinese chars), audience (string), angle (string), core_emotion (string), example_topics (array of 1-2 strings).",
    "All string values must be in Traditional Chinese.",
    "Do NOT duplicate any existing pillar listed below.",
    "Each new brief must explore a genuinely different psychological angle from existing ones.",
    "Derive your angles from what resonated in the top-performing posts provided.",
  ].join("\n");

  const input = JSON.stringify({
    task: "Generate 3 new editorial briefs.",
    existing_pillars_to_avoid: existingPillars,
    top_performing_posts: topPerformers.map((p) => ({
      pillar: p.pillar,
      engagement_score: p.engagementScore,
      metrics: p.metrics,
      post_excerpt: p.text?.slice(0, 300) ?? null,
    })),
  }, null, 2);

  const raw = await generateText({ instructions, input });
  const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/, "").trim();
  const parsed = JSON.parse(cleaned);

  if (!Array.isArray(parsed)) throw new Error("Expected JSON array from AI.");

  return parsed.slice(0, NEW_BRIEFS_PER_RUN).map((b) => ({
    ...b,
    source: "ai_evolved",
    createdAt: new Date().toISOString(),
  }));
}

async function main() {
  const performance = await readJson(PERFORMANCE_PATH, []);
  const scored = performance.filter((p) => p.engagementScore != null && p.engagementScore > 0);

  if (scored.length < MIN_SCORED_POSTS) {
    console.log(`Only ${scored.length} scored posts (need ${MIN_SCORED_POSTS}). Skipping brief evolution.`);
    return;
  }

  const [published, briefs] = await Promise.all([
    readJson(PUBLISHED_PATH, []),
    readJson(BRIEFS_PATH, []),
  ]);

  const topPerformers = getTopPerformers(performance, published);
  console.log(`Top performers: ${topPerformers.map((p) => `${p.pillar}(${p.engagementScore})`).join(", ")}`);

  const newBriefs = await generateNewBriefs(topPerformers, briefs);
  console.log(`New briefs: ${newBriefs.map((b) => b.pillar).join(", ")}`);

  const updated = pruneBriefs([...briefs, ...newBriefs]);
  await writeJson(BRIEFS_PATH, updated);
  console.log(`editor-briefs.json: ${updated.length} total briefs.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
