import { readJson, writeJson } from "./storage.js";
import { publishTextPost } from "./threads-api.js";

export const PUBLISHED_PATH = "data/published.json";
export const ERRORS_PATH = "data/errors.json";
export const APPROVAL_REQUESTS_PATH = "data/approval-requests.json";
export const MAX_THREADS_TEXT_LENGTH = 500;

function splitLongParagraph(paragraph) {
  const chunks = [];
  const sentences = paragraph
    .split(/(?<=[。！？!?])\s*/u)
    .filter(Boolean);

  let current = "";
  const units = sentences.length > 1 ? sentences : paragraph.match(/.{1,480}/gsu) || [];

  for (const rawUnit of units) {
    const safeUnits = rawUnit.length > MAX_THREADS_TEXT_LENGTH
      ? rawUnit.match(/.{1,480}/gsu) || []
      : [rawUnit];

    for (const unit of safeUnits) {
      const next = current ? `${current}${unit}` : unit;
      if (next.length <= MAX_THREADS_TEXT_LENGTH) {
        current = next;
        continue;
      }
      if (current) {
        chunks.push(current.trim());
      }
      current = unit;
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
}

export function splitThreadText(text) {
  const paragraphs = String(text || "")
    .replace(/\n{3,}/g, "\n\n")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  const parts = [];
  let current = "";

  for (const paragraph of paragraphs) {
    const paragraphChunks = paragraph.length > MAX_THREADS_TEXT_LENGTH
      ? splitLongParagraph(paragraph)
      : [paragraph];

    for (const chunk of paragraphChunks) {
      const next = current ? `${current}\n\n${chunk}` : chunk;
      if (next.length <= MAX_THREADS_TEXT_LENGTH) {
        current = next;
        continue;
      }
      if (current) {
        parts.push(current);
      }
      current = chunk;
    }
  }

  if (current) {
    parts.push(current);
  }

  return parts;
}

export function selectPost(posts, published, date, slot) {
  const publishedIds = new Set(published.map((item) => item.id));
  return posts.find((post) => {
    const slotMatches = slot ? post.slot === slot : true;
    return post.date === date && slotMatches && post.status === "ready" && !publishedIds.has(post.id);
  });
}

export function validatePost(post) {
  if (!post.id) {
    throw new Error("Post is missing id.");
  }
  if (!post.text || !post.text.trim()) {
    throw new Error(`Post ${post.id} is missing text.`);
  }
  const threadParts = splitThreadText(post.text);
  const oversizedPart = threadParts.find((part) => part.length > MAX_THREADS_TEXT_LENGTH);
  if (oversizedPart) {
    throw new Error(`Post ${post.id} has a thread part with ${oversizedPart.length} characters. Threads text posts should be ${MAX_THREADS_TEXT_LENGTH} characters or fewer.`);
  }
}

export async function publishThreadText({ config, text }) {
  const threadParts = splitThreadText(text);
  const results = [];
  let replyToId;
  let rootPostId;

  for (const [index, part] of threadParts.entries()) {
    if (replyToId) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    const result = await publishTextPost({
      apiVersion: config.apiVersion,
      userId: config.userId,
      accessToken: config.accessToken,
      text: part,
      replyToId
    });

    results.push({
      index,
      text: part,
      threadsResponse: result
    });
    const publishedPostId = result.id || result.post_id || result.thread_id || result.media_id;
    if (index === 0) {
      rootPostId = publishedPostId;
    }
    replyToId = rootPostId;
    if (index < threadParts.length - 1 && !replyToId) {
      throw new Error(`Threads API did not return a post id for thread part ${index + 1}. Cannot publish continuation replies.`);
    }
  }

  return results;
}

export async function recordError({ id, date, slot, message }) {
  const errors = await readJson(ERRORS_PATH, []);
  errors.push({
    id,
    date,
    slot,
    message,
    failedAt: new Date().toISOString()
  });
  await writeJson(ERRORS_PATH, errors);
}

export async function publishAndRecord({ config, post, slot, approvalRequestId }) {
  const threadResults = await publishThreadText({ config, text: post.text });

  const published = await readJson(PUBLISHED_PATH, []);
  published.push({
    id: post.id,
    date: config.postDate,
    slot,
    pillar: post.pillar || null,
    approvalRequestId,
    text: post.text,
    threadParts: threadResults.map((part) => ({
      index: part.index,
      text: part.text,
      threadsResponse: part.threadsResponse
    })),
    threadsResponse: threadResults[0]?.threadsResponse,
    publishedAt: new Date().toISOString()
  });

  await writeJson(PUBLISHED_PATH, published);
  return {
    id: threadResults[0]?.threadsResponse?.id,
    threadParts: threadResults
  };
}

export function getSlotLabel(slot) {
  return slot || "unspecified";
}
