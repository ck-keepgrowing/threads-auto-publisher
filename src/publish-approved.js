import { loadDotEnv } from "./load-env.js";
import { getRequiredConfig } from "./config.js";
import { loadPosts } from "./posts-source.js";
import { readJson, writeJson } from "./storage.js";
import { APPROVAL_REQUESTS_PATH, PUBLISHED_PATH, getSlotLabel, publishAndRecord, recordError, selectPost, validatePost } from "./post-utils.js";
import { getApprovalDecision, sendApprovalMessage } from "./telegram-api.js";
import { generateRevisedPost, upsertPost } from "./editor-generator.js";

loadDotEnv();

function findLatestRequest(requests, post) {
  return requests
    .filter((request) => request.id === post.id)
    .sort((left, right) => new Date(right.requestedAt) - new Date(left.requestedAt))[0];
}

async function main() {
  const config = getRequiredConfig();
  const slot = process.env.TARGET_SLOT;
  const posts = await loadPosts();
  const published = await readJson(PUBLISHED_PATH, []);
  const post = selectPost(posts, published, config.postDate, slot);

  if (!post) {
    console.log(`No ready post found for ${config.postDate} ${getSlotLabel(slot)}.`);
    return;
  }

  validatePost(post);

  const requests = await readJson(APPROVAL_REQUESTS_PATH, []);
  const latestRequest = findLatestRequest(requests, post);

  if (config.dryRun) {
    console.log(`[DRY RUN] Would check Telegram approval and publish ${post.id} (${getSlotLabel(slot)}):`);
    console.log(post.text);
    return;
  }

  const decision = await getApprovalDecision({
    postId: post.id,
    requestedAt: latestRequest?.requestedAt
  });

  if (decision.status === "pending") {
    const message = `Post ${post.id} was not published because no Telegram approval was found.`;
    await recordError({
      id: post.id,
      date: config.postDate,
      slot,
      message
    });
    console.log(message);
    return;
  }

  if (decision.status === "rejected") {
    const message = `Post ${post.id} was rejected in Telegram.`;
    await recordError({
      id: post.id,
      date: config.postDate,
      slot,
      message
    });
    console.log(message);
    return;
  }

  if (decision.status === "revision_requested") {
    const revisedText = await generateRevisedPost({
      post,
      revisionInstructions: decision.revisionInstructions
    });

    const revisedPost = await upsertPost({
      ...post,
      text: revisedText,
      status: "ready",
      revisedAt: new Date().toISOString(),
      revisionInstructions: decision.revisionInstructions || "Button revise requested"
    });

    const message = await sendApprovalMessage({
      post: revisedPost,
      date: config.postDate,
      slot: getSlotLabel(slot)
    });

    const requests = await readJson(APPROVAL_REQUESTS_PATH, []);
    requests.push({
      id: revisedPost.id,
      date: config.postDate,
      slot,
      telegramMessageId: message.message_id,
      requestedAt: new Date().toISOString(),
      reason: "revision"
    });
    await writeJson(APPROVAL_REQUESTS_PATH, requests);

    console.log(`Revised post ${post.id} with AI and sent it for approval again.`);
    return;
  }

  await publishAndRecord({ config, post, slot });
  console.log(`Published approved post ${post.id}.`);
}

main().catch(async (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
