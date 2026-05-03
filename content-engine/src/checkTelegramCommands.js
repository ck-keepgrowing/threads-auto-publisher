import { callPrompt } from "./openrouter.js";
import { publishApprovedDraft } from "./publish.js";
import { isPublishDue } from "./schedule.js";
import { answerCallbackQuery, getTelegramUpdates, sendDraftForReview, sendTelegramMessage } from "./telegram.js";
import { appendJsonArray, findDraftPath, isMainModule, listDrafts, moveFile, nowIso, readJson, sanitizePostText, writeJson } from "./utils.js";

async function findDraftIdFromReply(message) {
  const replyMessageId = message?.reply_to_message?.message_id;
  if (!replyMessageId) {
    return "";
  }

  const pendingDrafts = await listDrafts("pending_review");
  const match = pendingDrafts.find(({ draft }) => String(draft.telegram_message_id) === String(replyMessageId));
  return match?.draft?.id || "";
}

async function findOnlyPendingDraftId() {
  const pendingDrafts = await listDrafts("pending_review");
  return pendingDrafts.length === 1 ? pendingDrafts[0].draft.id : "";
}

async function parseCommand(message) {
  const text = message?.text || "";
  const trimmed = String(text || "").trim();
  if (!trimmed) {
    return null;
  }

  const match = trimmed.match(/^\/(approve|rewrite|reject)(?:@\w+)?\s+(\S+)(?:\s+([\s\S]+))?$/i);
  if (match) {
    return {
      command: match[1].toLowerCase(),
      draftId: match[2],
      rest: (match[3] || "").trim()
    };
  }

  const replyDraftId = await findDraftIdFromReply(message);
  const fallbackDraftId = replyDraftId || await findOnlyPendingDraftId();

  const replyMatch = trimmed.match(/^\/?(approve|approved|ok|yes|continue|繼續|批准|通過|rewrite|revise|改|重寫|reject|rejected|唔要|不要)(?:\s+([\s\S]+))?$/i);
  if (!fallbackDraftId) {
    return null;
  }

  if (!replyMatch) {
    return {
      command: "rewrite",
      draftId: fallbackDraftId,
      rest: trimmed
    };
  }

  const rawCommand = replyMatch[1].toLowerCase();
  const command = ["approve", "approved", "ok", "yes", "continue", "繼續", "批准", "通過"].includes(rawCommand)
    ? "approve"
    : ["reject", "rejected", "唔要", "不要"].includes(rawCommand)
      ? "reject"
      : "rewrite";

  return {
    command,
    draftId: fallbackDraftId,
    rest: (replyMatch[2] || "").trim()
  };
}

async function findDraftIdFromCallbackKey(key) {
  const folders = ["pending_review", "approved"];
  for (const folder of folders) {
    const drafts = await listDrafts(folder);
    const match = drafts.find(({ draft }) => draft.id === key || String(draft.id || "").endsWith(`-${key}`));
    if (match) {
      return match.draft.id;
    }
  }
  return key;
}

async function parseCallbackQuery(callbackQuery) {
  const data = String(callbackQuery?.data || "");
  const match = data.match(/^(approve|reject):(.+)$/);
  if (!match) {
    return null;
  }

  return {
    command: match[1],
    draftId: await findDraftIdFromCallbackKey(match[2]),
    rest: ""
  };
}

async function recordDecision(decision) {
  const state = await readJson("data/telegram_state.json", { last_update_id: 0, review_decisions: [] });
  state.review_decisions = state.review_decisions || [];
  state.review_decisions.push(decision);
  await writeJson("data/telegram_state.json", state);
}

async function recordHumanFeedback({ draft, decision, instruction = "", reason = "", rawMessage = "" }) {
  await appendJsonArray("data/human_feedback.json", {
    draft_id: draft.id,
    decision,
    instruction,
    reason,
    raw_message: rawMessage,
    timestamp: nowIso(),
    topic: draft.topic || "",
    category: draft.category || "",
    hook: draft.hook || "",
    post_excerpt: String(draft.post || "").slice(0, 900),
    core_pain_point: draft.core_pain_point || "",
    hidden_psychology: draft.hidden_psychology || "",
    coaching_advice_summary: draft.coaching_advice_summary || "",
    labels: draft.labels || {},
    hook_type: draft.hook_type || draft.labels?.hook_type || "",
    content_type: draft.content_type || draft.labels?.content_type || draft.category || "",
    target_reader: draft.target_reader || draft.labels?.target_reader || "",
    emotional_trigger: draft.emotional_trigger || draft.labels?.emotional_trigger || "",
    practical_advice_type: draft.practical_advice_type || draft.labels?.practical_advice_type || ""
  });
}

async function approveDraft(draftId, reason, rawMessage = "") {
  const draftPath = await findDraftPath(draftId, ["pending_review"]);
  if (!draftPath) {
    const approvedPath = await findDraftPath(draftId, ["approved"]);
    if (approvedPath) {
      const approvedDraft = await readJson(approvedPath);
      if (isPublishDue(approvedDraft)) {
        await sendTelegramMessage(`Draft ${draftId} is already approved. Publishing now.`);
        await publishApprovedDraft(draftId);
      } else {
        await sendTelegramMessage(`Draft ${draftId} is already approved and scheduled for ${approvedDraft.publish_due_at_hkt || approvedDraft.scheduled_slot} HKT.`);
      }
      return;
    }
    await sendTelegramMessage(`Cannot approve ${draftId}: pending review draft not found.`);
    return;
  }
  const draft = await readJson(draftPath);
  draft.status = "approved";
  draft.approved_at = nowIso();
  draft.review_notes = draft.review_notes || [];
  if (reason) {
    draft.review_notes.push({ type: "approve_reason", text: reason, timestamp: nowIso() });
  }
  await recordHumanFeedback({ draft, decision: "approved", reason, rawMessage });
  await writeJson(draftPath, draft);
  await moveFile(draftPath, `drafts/approved/${draft.id}.json`);
  await recordDecision({ draft_id: draft.id, decision: "approved", reason: reason || "", timestamp: nowIso() });

  if (isPublishDue(draft)) {
    await sendTelegramMessage(`Approved ${draft.id}. Publishing now.`);
    await publishApprovedDraft(draft.id);
  } else {
    await sendTelegramMessage(`Approved ${draft.id}. It will publish at ${draft.publish_due_at_hkt || draft.scheduled_slot} HKT.`);
  }
}

async function rejectDraft(draftId, reason, rawMessage = "") {
  const draftPath = await findDraftPath(draftId, ["pending_review"]);
  if (!draftPath) {
    await sendTelegramMessage(`Cannot reject ${draftId}: pending review draft not found.`);
    return;
  }
  const draft = await readJson(draftPath);
  draft.status = "rejected";
  draft.rejected_at = nowIso();
  draft.rejection_reason = reason || "";
  await recordHumanFeedback({ draft, decision: "rejected", reason, rawMessage });
  await writeJson(draftPath, draft);
  await moveFile(draftPath, `drafts/rejected/${draft.id}.json`);
  await recordDecision({ draft_id: draft.id, decision: "rejected", reason: reason || "", timestamp: nowIso() });
  await sendTelegramMessage(`Rejected ${draft.id}. It will not be published.`);
}

async function rewriteDraft(draftId, instruction, rawMessage = "") {
  const draftPath = await findDraftPath(draftId, ["pending_review"]);
  if (!draftPath) {
    await sendTelegramMessage(`Cannot rewrite ${draftId}: pending review draft not found.`);
    return;
  }
  if (!instruction) {
    await sendTelegramMessage(`Please add rewrite instructions after /rewrite ${draftId}.`);
    return;
  }

  const draft = await readJson(draftPath);
  const rewritten = await callPrompt({
    promptName: "06_rewriter_human_feedback",
    promptPath: "prompts/06_rewriter.md",
    input: {
      draft,
      human_rewrite_instruction: instruction,
      rule: "Keep status pending_review. Do not publish."
    }
  });

  draft.hook = sanitizePostText(rewritten.final_hook || draft.hook);
  draft.post = sanitizePostText(rewritten.final_post || draft.post);
  draft.coaching_advice_summary = sanitizePostText(rewritten.final_coaching_advice || draft.coaching_advice_summary);
  draft.status = "pending_review";
  draft.updated_at = nowIso();
  draft.review_notes = draft.review_notes || [];
  draft.review_notes.push({ type: "rewrite_instruction", text: instruction, timestamp: nowIso() });
  await recordHumanFeedback({ draft, decision: "rewrite", instruction, rawMessage });
  draft.rewrite_count = Number(draft.rewrite_count || 0) + 1;
  draft.labels = { ...(draft.labels || {}), ...(rewritten.labels || {}) };
  draft.hook_type = draft.labels.hook_type || draft.hook_type || "";
  draft.content_type = draft.labels.content_type || draft.content_type || draft.category || "";
  draft.target_reader = draft.labels.target_reader || draft.target_reader || "";
  draft.emotional_trigger = draft.labels.emotional_trigger || draft.emotional_trigger || "";
  draft.practical_advice_type = draft.labels.practical_advice_type || draft.practical_advice_type || "";
  await writeJson(draftPath, draft);
  await recordDecision({ draft_id: draft.id, decision: "rewrite", instruction, timestamp: nowIso() });
  const result = await sendDraftForReview(draft);
  draft.telegram_message_id = result?.message_id || draft.telegram_message_id || null;
  await writeJson(draftPath, draft);
}

async function publishDueApprovedDrafts() {
  const approvedDrafts = await listDrafts("approved");
  let publishedCount = 0;

  for (const { draft } of approvedDrafts) {
    if (!isPublishDue(draft)) {
      continue;
    }
    await sendTelegramMessage(`Scheduled time reached. Publishing ${draft.id}.`);
    await publishApprovedDraft(draft.id);
    publishedCount += 1;
  }

  return publishedCount;
}

async function resendPendingReviewDraftsIfRequested() {
  if (String(process.env.COACH_RESEND_PENDING_REVIEW || "").toLowerCase() !== "true") {
    return 0;
  }

  const pendingDrafts = await listDrafts("pending_review");
  for (const { path, draft } of pendingDrafts) {
    const result = await sendDraftForReview(draft);
    draft.telegram_message_id = result?.message_id || draft.telegram_message_id || null;
    draft.resent_at = nowIso();
    await writeJson(path, draft);
  }

  return pendingDrafts.length;
}

export async function checkTelegramCommands() {
  const state = await readJson("data/telegram_state.json", { last_update_id: 0, review_decisions: [] });
  const updates = await getTelegramUpdates(Number(state.last_update_id || 0) + 1);
  let latestUpdateId = Number(state.last_update_id || 0);
  let processedCommands = 0;

  for (const update of updates) {
    latestUpdateId = Math.max(latestUpdateId, Number(update.update_id || 0));
    const callbackQuery = update.callback_query;
    const message = update.message || callbackQuery?.message;

    if (callbackQuery) {
      if (String(callbackQuery.message?.chat?.id) !== String(process.env.TELEGRAM_CHAT_ID)) {
        continue;
      }

      const parsed = await parseCallbackQuery(callbackQuery);
      if (!parsed) {
        await answerCallbackQuery(callbackQuery.id, "Unsupported action");
        continue;
      }

      if (parsed.command === "approve") {
        await answerCallbackQuery(callbackQuery.id, "Approving");
        await approveDraft(parsed.draftId, parsed.rest, callbackQuery.data);
        processedCommands += 1;
      } else if (parsed.command === "reject") {
        await answerCallbackQuery(callbackQuery.id, "Rejecting");
        await rejectDraft(parsed.draftId, parsed.rest, callbackQuery.data);
        processedCommands += 1;
      }
      continue;
    }

    if (!message?.text) {
      continue;
    }
    if (String(message.chat?.id) !== String(process.env.TELEGRAM_CHAT_ID)) {
      continue;
    }

    const parsed = await parseCommand(message);
    if (!parsed) {
      continue;
    }

    if (parsed.command === "approve") {
      await approveDraft(parsed.draftId, parsed.rest, message.text);
      processedCommands += 1;
    } else if (parsed.command === "rewrite") {
      await rewriteDraft(parsed.draftId, parsed.rest, message.text);
      processedCommands += 1;
    } else if (parsed.command === "reject") {
      await rejectDraft(parsed.draftId, parsed.rest, message.text);
      processedCommands += 1;
    }
  }

  const scheduledPublished = await publishDueApprovedDrafts();
  const resentPending = await resendPendingReviewDraftsIfRequested();

  if (latestUpdateId !== Number(state.last_update_id || 0)) {
    const nextState = await readJson("data/telegram_state.json", { last_update_id: 0, review_decisions: [] });
    nextState.last_update_id = latestUpdateId;
    await writeJson("data/telegram_state.json", nextState);
  }

  console.log(`Checked Telegram commands. Updates: ${updates.length}. Commands processed: ${processedCommands}. Scheduled published: ${scheduledPublished}. Pending reviews resent: ${resentPending}.`);
}

if (isMainModule(import.meta.url)) {
  checkTelegramCommands().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
