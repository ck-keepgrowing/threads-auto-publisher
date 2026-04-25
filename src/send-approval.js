import { loadDotEnv } from "./load-env.js";
import { getConfig } from "./config.js";
import { loadPosts } from "./posts-source.js";
import { readJson, writeJson } from "./storage.js";
import { APPROVAL_REQUESTS_PATH, PUBLISHED_PATH, getSlotLabel, selectPost, validatePost } from "./post-utils.js";
import { sendApprovalMessage } from "./telegram-api.js";
import { generateDraftPost, upsertPost } from "./editor-generator.js";

loadDotEnv();

async function main() {
  const config = getConfig();
  const slot = process.env.TARGET_SLOT;
  let posts = await loadPosts();
  const published = await readJson(PUBLISHED_PATH, []);
  let post = selectPost(posts, published, config.postDate, slot);

  if (!post) {
    if (process.env.CONTENT_SOURCE && process.env.CONTENT_SOURCE !== "local") {
      console.log(`No ready post found for ${config.postDate} ${getSlotLabel(slot)}.`);
      return;
    }

    if (config.dryRun) {
      console.log(`[DRY RUN] Would generate AI draft for ${config.postDate} ${getSlotLabel(slot)}.`);
      return;
    }

    post = await generateDraftPost({
      date: config.postDate,
      slot
    });
    await upsertPost(post);
    posts = await loadPosts();
  }

  validatePost(post);

  if (config.dryRun) {
    console.log(`[DRY RUN] Would send Telegram approval for ${post.id} (${getSlotLabel(slot)}):`);
    console.log(post.text);
    return;
  }

  const message = await sendApprovalMessage({
    post,
    date: config.postDate,
    slot: getSlotLabel(slot)
  });

  const requests = await readJson(APPROVAL_REQUESTS_PATH, []);
  requests.push({
    id: post.id,
    date: config.postDate,
    slot,
    telegramMessageId: message.message_id,
    requestedAt: new Date().toISOString()
  });
  await writeJson(APPROVAL_REQUESTS_PATH, requests);

  console.log(`Sent Telegram approval request for ${post.id}.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
