import { readJson, writeJson } from "./storage.js";
import { publishTextPost } from "./threads-api.js";

export const PUBLISHED_PATH = "data/published.json";
export const ERRORS_PATH = "data/errors.json";
export const APPROVAL_REQUESTS_PATH = "data/approval-requests.json";
export const MAX_THREADS_TEXT_LENGTH = 500;

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
  if (post.text.length > MAX_THREADS_TEXT_LENGTH) {
    throw new Error(`Post ${post.id} is ${post.text.length} characters. Threads text posts should be ${MAX_THREADS_TEXT_LENGTH} characters or fewer.`);
  }
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
  const result = await publishTextPost({
    apiVersion: config.apiVersion,
    userId: config.userId,
    accessToken: config.accessToken,
    text: post.text
  });

  const published = await readJson(PUBLISHED_PATH, []);
  published.push({
    id: post.id,
    date: config.postDate,
    slot,
    approvalRequestId,
    text: post.text,
    threadsResponse: result,
    publishedAt: new Date().toISOString()
  });

  await writeJson(PUBLISHED_PATH, published);
  return result;
}

export function getSlotLabel(slot) {
  return slot || "unspecified";
}
