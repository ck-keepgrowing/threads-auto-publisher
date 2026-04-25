import { loadDotEnv } from "./load-env.js";
import { getRequiredConfig } from "./config.js";
import { readJson, writeJson } from "./storage.js";
import { loadPosts } from "./posts-source.js";
import { publishTextPost } from "./threads-api.js";

loadDotEnv();

const PUBLISHED_PATH = "data/published.json";
const ERRORS_PATH = "data/errors.json";
const MAX_THREADS_TEXT_LENGTH = 500;

function selectPost(posts, published, date) {
  const publishedIds = new Set(published.map((item) => item.id));
  return posts.find((post) => {
    return post.date === date && post.status === "ready" && !publishedIds.has(post.id);
  });
}

function validatePost(post) {
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

async function main() {
  const config = getRequiredConfig();
  const posts = await loadPosts();
  const published = await readJson(PUBLISHED_PATH, []);
  const post = selectPost(posts, published, config.postDate);

  if (!post) {
    console.log(`No ready post found for ${config.postDate} (${config.timeZone}).`);
    return;
  }

  validatePost(post);

  if (config.dryRun) {
    console.log(`[DRY RUN] Would publish post ${post.id}:`);
    console.log(post.text);
    return;
  }

  try {
    const result = await publishTextPost({
      apiVersion: config.apiVersion,
      userId: config.userId,
      accessToken: config.accessToken,
      text: post.text
    });

    published.push({
      id: post.id,
      date: config.postDate,
      text: post.text,
      threadsResponse: result,
      publishedAt: new Date().toISOString()
    });

    await writeJson(PUBLISHED_PATH, published);
    console.log(`Published post ${post.id}.`);
  } catch (error) {
    const errors = await readJson(ERRORS_PATH, []);
    errors.push({
      id: post.id,
      date: config.postDate,
      message: error.message,
      failedAt: new Date().toISOString()
    });
    await writeJson(ERRORS_PATH, errors);
    throw error;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
