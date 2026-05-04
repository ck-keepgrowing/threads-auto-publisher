import { loadDotEnv } from "./load-env.js";
import { getConfig } from "./config.js";
import { loadPosts } from "./posts-source.js";
import { readJson, writeJson } from "./storage.js";
import { APPROVAL_REQUESTS_PATH, PUBLISHED_PATH, getSlotLabel, selectPost, splitThreadText, validatePost } from "./post-utils.js";
import { getApprovalDecision, sendApprovalMessage, sendTelegramMessage } from "./telegram-api.js";
import { generateDraftPost, generateRevisedPost, upsertPost } from "./editor-generator.js";

loadDotEnv();

function createApprovalToken() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

async function handleEarlyRevision({ config, slot, existingRequest, requests, posts, published }) {
  const decision = await getApprovalDecision({
    postId: existingRequest.id,
    requestedAt: existingRequest.requestedAt,
    telegramMessageId: existingRequest.telegramMessageId,
    approvalToken: existingRequest.approvalToken
  });

  if (decision.status !== "revision_requested") {
    return false;
  }

  const currentPost = selectPost(posts, published, config.postDate, slot) || existingRequest.post;
  if (!currentPost) {
    console.log(`Cannot revise ${existingRequest.id}: no current post found.`);
    return false;
  }

  if (config.dryRun) {
    console.log(`[DRY RUN] Would revise ${existingRequest.id} during approval window using: ${decision.revisionInstructions || "(no instructions)"}`);
    return true;
  }

  try {
    await sendTelegramMessage(`改緊 ${existingRequest.id}...\n指示：${decision.revisionInstructions || "(冇)"}`);
  } catch (error) {
    console.warn(`Failed to send revise ack: ${error.message}`);
  }

  const revisedText = await generateRevisedPost({
    post: currentPost,
    revisionInstructions: decision.revisionInstructions
  });

  const revisedPost = await upsertPost({
    ...currentPost,
    text: revisedText,
    status: "ready",
    revisedAt: new Date().toISOString(),
    revisionInstructions: decision.revisionInstructions || "Revise requested during approval window"
  });

  validatePost(revisedPost);

  const approvalToken = createApprovalToken();
  const message = await sendApprovalMessage({
    post: revisedPost,
    date: config.postDate,
    slot: getSlotLabel(slot),
    approvalToken
  });

  requests.push({
    id: revisedPost.id,
    date: config.postDate,
    slot,
    post: {
      id: revisedPost.id,
      date: revisedPost.date,
      slot: revisedPost.slot,
      text: revisedPost.text,
      status: revisedPost.status,
      source: revisedPost.source,
      pillar: revisedPost.pillar,
      generatedAt: revisedPost.generatedAt,
      revisedAt: revisedPost.revisedAt,
      revisionInstructions: revisedPost.revisionInstructions
    },
    approvalToken,
    telegramMessageId: message.message_id,
    requestedAt: new Date().toISOString(),
    reason: "revision"
  });
  await writeJson(APPROVAL_REQUESTS_PATH, requests);

  console.log(`Revised ${existingRequest.id} during approval window and sent new approval.`);
  return true;
}

export async function sendApprovalForSlot({ slot: requestedSlot } = {}) {
  const config = getConfig();
  const slot = requestedSlot || process.env.TARGET_SLOT;
  let posts = await loadPosts();
  const published = await readJson(PUBLISHED_PATH, []);
  const requests = await readJson(APPROVAL_REQUESTS_PATH, []);
  if (published.some((item) => item.date === config.postDate && item.slot === slot)) {
    console.log(`Post for ${config.postDate} ${getSlotLabel(slot)} was already published.`);
    return;
  }
  const requestsForSlot = requests
    .filter((request) => request.date === config.postDate && request.slot === slot)
    .sort((left, right) => new Date(right.requestedAt) - new Date(left.requestedAt));
  const existingRequest = requestsForSlot[0];
  if (existingRequest && String(process.env.FORCE_APPROVAL || "false").toLowerCase() !== "true") {
    try {
      const handled = await handleEarlyRevision({
        config,
        slot,
        existingRequest,
        requests,
        posts,
        published
      });
      if (handled) {
        return;
      }
    } catch (error) {
      console.warn(`Early revision attempt failed for ${existingRequest.id}: ${error.message}`);
    }
    console.log(`Approval request already exists for ${config.postDate} ${getSlotLabel(slot)}.`);
    return;
  }

  let post = selectPost(posts, published, config.postDate, slot);

  if ((process.env.CONTENT_SOURCE || "local") === "local" && !post) {
    if (config.dryRun) {
      console.log(`[DRY RUN] Would generate a fresh AI draft for ${config.postDate} ${getSlotLabel(slot)} before Telegram approval.`);
      return;
    }

    // If no prepared post exists for this slot, start approval with a fresh editor draft.
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
    splitThreadText(post.text).forEach((part, index) => {
      console.log(`\n--- Thread part ${index + 1} ---\n${part}`);
    });
    return;
  }

  const approvalToken = createApprovalToken();
  const message = await sendApprovalMessage({
    post,
    date: config.postDate,
    slot: getSlotLabel(slot),
    approvalToken,
    autoPublish: post.autoPublish
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

if (import.meta.url === `file://${process.argv[1]}`) {
  sendApprovalForSlot().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
