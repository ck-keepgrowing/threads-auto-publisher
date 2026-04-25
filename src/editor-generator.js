import { readJson, writeJson } from "./storage.js";
import { generateText } from "./openrouter-api.js";

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

  const instructions = [
    "You are the ghost editor for a Hong Kong Threads account targeting insurance agents and people considering joining insurance sales.",
    "Write in Hong Kong Cantonese.",
    "The persona is mysterious, insightful, clear, and emotionally precise.",
    "Output only the final Threads post text. Do not include title, hashtags, bullets unless naturally needed, or explanations."
  ].join("\n");

  const input = JSON.stringify({
    task: "Write one Threads post draft.",
    date,
    slot,
    brand_guide: brandGuide,
    editorial_angle: brief
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
    generatedAt: new Date().toISOString()
  };
}

export async function generateRevisedPost({ post, revisionInstructions }) {
  const { brandGuide } = await loadEditorialContext(post.date, post.slot);

  const instructions = [
    "You revise Threads posts for a Hong Kong insurance-sales audience.",
    "Preserve the strategic angle unless the revision instruction says otherwise.",
    "Write in Hong Kong Cantonese.",
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
