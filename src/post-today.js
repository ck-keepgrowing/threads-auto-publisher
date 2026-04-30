import { loadDotEnv } from "./load-env.js";
import { getRequiredConfig } from "./config.js";
import { readJson, writeJson } from "./storage.js";
import { loadPosts } from "./posts-source.js";
import { ERRORS_PATH, PUBLISHED_PATH, publishThreadText, selectPost, splitThreadText, validatePost } from "./post-utils.js";

loadDotEnv();

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
    splitThreadText(post.text).forEach((part, index) => {
      console.log(`\n--- Thread part ${index + 1} ---\n${part}`);
    });
    return;
  }

  try {
    const threadResults = await publishThreadText({ config, text: post.text });

    published.push({
      id: post.id,
      date: config.postDate,
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
