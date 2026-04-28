import { loadDotEnv } from "./load-env.js";
import { getConfig } from "./config.js";
import { loadPosts } from "./posts-source.js";
import { readJson, writeJson } from "./storage.js";
import { APPROVAL_REQUESTS_PATH, PUBLISHED_PATH, getSlotLabel, selectPost, validatePost } from "./post-utils.js";
import { sendApprovalMessage } from "./telegram-api.js";
import { generateDraftPost, upsertPost } from "./editor-generator.js";

loadDotEnv();

function createApprovalToken() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

async function main() {
  const config = getConfig();
  const slot = process.env.TARGET_SLOT;
  let posts = await loadPosts();
  const published = await readJson(PUBLISHED_PATH, []);
  const requests = await readJson(APPROVAL_REQUESTS_PATH, []);
  const existingRequest = requests.find((request) => request.date === config.postDate && request.slot === slot);
  if (existingRequest && String(process.env.FORCE_APPROVAL || "false").toLowerCase() !== "true") {
    console.log(`Approval request already exists for ${config.postDate} ${getSlotLabel(slot)}.`);
    return;
  }

  let post = selectPost(posts, published, config.postDate, slot);

  if ((process.env.CONTENT_SOURCE || "local") === "local") {
    if (config.dryRun) {
      console.log(`[DRY RUN] Would generate a fresh AI draft for ${config.postDate} ${getSlotLabel(slot)} before Telegram approval.`);
      if (post) {
        console.log("Existing post would be replaced:");
        console.log(post.text);
      }
      return;
    }

    // Approval always starts with a fresh editor draft so the content follows the latest brief and brand guide.
    post = await generateDraftPost({
      date: config.postDate,
      slot
    });
    await upsertPost(post);
    posts = await loadPosts();
  } else if (!post) {
    console.log(`No ready post found for ${config.postDate} ${getSlotLabel(slot)}.`);
    return;
  }

  validatePost(post);

  if (config.dryRun) {
    console.log(`[DRY RUN] Would send Telegram approval for ${post.id} (${getSlotLabel(slot)}):`);
    console.log(post.text);
    return;
  }

  const approvalToken = createApprovalToken();
  const message = await sendApprovalMessage({
    post,
    date: config.postDate,
    slot: getSlotLabel(slot),
    approvalToken
  });

  requests.push({
    id: post.id,
    date: config.postDate,
    slot,
    post: {
      id: post.id,
      date: post.date,
      slot: post.slot,
      text: post.text,
      status: post.status,
      source: post.source,
      pillar: post.pillar,
      generatedAt: post.generatedAt,
      revisedAt: post.revisedAt,
      revisionInstructions: post.revisionInstructions
    },
    approvalToken,
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
