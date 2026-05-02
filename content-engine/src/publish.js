import { publishTextToThreads } from "./threads.js";
import { sendTelegramMessage } from "./telegram.js";
import { appendJsonArray, findDraftPath, isMainModule, moveFile, nowIso, readJson, writeJson } from "./utils.js";

export async function publishApprovedDraft(draftId) {
  const draftPath = await findDraftPath(draftId, ["approved"]);
  if (!draftPath) {
    throw new Error(`Approved draft not found: ${draftId}`);
  }

  const draft = await readJson(draftPath);
  if (draft.status !== "approved") {
    throw new Error(`Draft ${draftId} has status ${draft.status}; only approved drafts can be published.`);
  }

  const threadsResponse = await publishTextToThreads(draft.post);
  const postId = threadsResponse.id || threadsResponse.post_id || threadsResponse.thread_id || threadsResponse.media_id || null;
  const publishedAt = nowIso();
  const publishedRecord = {
    ...draft,
    status: "published",
    published_at: publishedAt,
    threads_post_id: postId,
    threads_response: threadsResponse
  };

  await writeJson(draftPath, publishedRecord);
  await moveFile(draftPath, `published/${draft.id}.json`);
  await appendJsonArray("data/published_posts.json", {
    id: draft.id,
    topic: draft.topic,
    category: draft.category,
    core_pain_point: draft.core_pain_point,
    hidden_psychology: draft.hidden_psychology,
    coaching_advice_summary: draft.coaching_advice_summary,
    hook: draft.hook,
    post: draft.post,
    hook_type: draft.hook_type || draft.labels?.hook_type || "",
    content_type: draft.content_type || draft.labels?.content_type || draft.category || "",
    target_reader: draft.target_reader || draft.labels?.target_reader || "",
    emotional_trigger: draft.emotional_trigger || draft.labels?.emotional_trigger || "",
    practical_advice_type: draft.practical_advice_type || draft.labels?.practical_advice_type || "",
    published_at: publishedAt,
    threads_post_id: postId,
    threads_response: threadsResponse
  });

  await sendTelegramMessage([
    "Threads post published.",
    "",
    `Draft ID: ${draft.id}`,
    postId ? `Threads Post ID: ${postId}` : "Threads Post ID: not returned by API"
  ].join("\n"));

  console.log(`Published approved draft ${draft.id}.`);
  return publishedRecord;
}

if (isMainModule(import.meta.url)) {
  const draftId = process.argv[2] || process.env.DRAFT_ID;
  if (!draftId) {
    console.error("Usage: node src/publish.js <draft_id>");
    process.exitCode = 1;
  } else {
    publishApprovedDraft(draftId).catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
  }
}
