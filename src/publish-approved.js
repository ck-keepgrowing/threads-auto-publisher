import { loadDotEnv } from "./load-env.js";
import { getRequiredConfig } from "./config.js";
import { loadPosts } from "./posts-source.js";
import { readJson, writeJson } from "./storage.js";
import { APPROVAL_REQUESTS_PATH, PUBLISHED_PATH, getSlotLabel, publishAndRecord, recordError, selectPost, validatePost } from "./post-utils.js";
import { getApprovalDecision, sendApprovalMessage, sendTelegramMessage } from "./telegram-api.js";
import { generateRevisedPost, upsertPost } from "./editor-generator.js";

loadDotEnv();

function getApprovalRequestId(request) {
  if (!request) {
    return undefined;
  }
  return `${request.id}:${request.telegramMessageId || request.requestedAt}`;
}

function findLatestRequestForPost(requests, post) {
  return requests
    .filter((request) => request.id === post.id)
    .sort((left, right) => new Date(right.requestedAt) - new Date(left.requestedAt))[0];
}

function findLatestRequestForSlot(requests, date, slot) {
  return requests
    .filter((request) => request.date === date && request.slot === slot)
    .sort((left, right) => new Date(right.requestedAt) - new Date(left.requestedAt))[0];
}

async function notifyTelegram(text) {
  try {
    await sendTelegramMessage(text);
  } catch (error) {
    console.warn(`Telegram notification failed: ${error.message}`);
  }
}

async function main() {
  const config = getRequiredConfig();
  const slot = process.env.TARGET_SLOT;
  const posts = await loadPosts();
  const published = await readJson(PUBLISHED_PATH, []);
  const requests = await readJson(APPROVAL_REQUESTS_PATH, []);
  const latestSlotRequest = findLatestRequestForSlot(requests, config.postDate, slot);
  const post = latestSlotRequest?.post
    ? {
        ...latestSlotRequest.post
      }
    : selectPost(posts, published, config.postDate, slot);

  if (!post) {
    console.log(`No ready post found for ${config.postDate} ${getSlotLabel(slot)}.`);
    return;
  }

  validatePost(post);

  const latestRequest = latestSlotRequest || findLatestRequestForPost(requests, post);
  const approvalRequestId = getApprovalRequestId(latestRequest);
  const approvedPost = latestRequest?.post
    ? {
        ...post,
        ...latestRequest.post
      }
    : post;

  validatePost(approvedPost);

  if (approvalRequestId && published.some((item) => item.approvalRequestId === approvalRequestId)) {
    console.log(`Approval request ${approvalRequestId} was already published.`);
    return;
  }

  if (config.dryRun) {
    console.log(`[DRY RUN] Would check Telegram approval and publish ${approvedPost.id} (${getSlotLabel(slot)}):`);
    console.log(approvedPost.text);
    return;
  }

  if (String(process.env.FORCE_APPROVED || "false").toLowerCase() === "true") {
    const result = await publishAndRecord({ config, post: approvedPost, slot, approvalRequestId });
    await notifyTelegram([
      "Threads post published.",
      "",
      `Post ID: ${approvedPost.id}`,
      `Scheduled time: ${config.postDate} ${getSlotLabel(slot)} HKT`,
      `Threads ID: ${result.id || "unknown"}`
    ].join("\n"));
    console.log(`Force published approved post ${approvedPost.id}.`);
    return;
  }

  const decision = await getApprovalDecision({
    postId: post.id,
    requestedAt: latestRequest?.requestedAt,
    telegramMessageId: latestRequest?.telegramMessageId,
    approvalToken: latestRequest?.approvalToken
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
    await notifyTelegram([
      "Rejected. This Threads post will not be published.",
      "",
      `Post ID: ${post.id}`,
      `Scheduled time: ${config.postDate} ${getSlotLabel(slot)} HKT`
    ].join("\n"));
    console.log(message);
    return;
  }

  if (decision.status === "revision_requested") {
    const revisedText = await generateRevisedPost({
      post: approvedPost,
      revisionInstructions: decision.revisionInstructions
    });

    const revisedPost = await upsertPost({
      ...approvedPost,
      text: revisedText,
      status: "ready",
      revisedAt: new Date().toISOString(),
      revisionInstructions: decision.revisionInstructions || "Button revise requested"
    });

    const approvalToken = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const message = await sendApprovalMessage({
      post: revisedPost,
      date: config.postDate,
      slot: getSlotLabel(slot),
      approvalToken
    });

    const requests = await readJson(APPROVAL_REQUESTS_PATH, []);
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

    console.log(`Revised post ${post.id} with AI and sent it for approval again.`);
    return;
  }

  await notifyTelegram([
    "Approval received.",
    "",
    `Post ID: ${approvedPost.id}`,
    `Scheduled time: ${config.postDate} ${getSlotLabel(slot)} HKT`,
    "Publishing now."
  ].join("\n"));

  const result = await publishAndRecord({ config, post: approvedPost, slot, approvalRequestId });
  await notifyTelegram([
    "Threads post published.",
    "",
    `Post ID: ${approvedPost.id}`,
    `Scheduled time: ${config.postDate} ${getSlotLabel(slot)} HKT`,
    `Threads ID: ${result.id || "unknown"}`
  ].join("\n"));
  console.log(`Published approved post ${approvedPost.id}.`);
}

main().catch(async (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
