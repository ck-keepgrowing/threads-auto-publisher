import { callPrompt } from "./openrouter.js";
import { publishApprovedDraft } from "./publish.js";
import { getTelegramUpdates, sendDraftForReview, sendTelegramMessage } from "./telegram.js";
import { findDraftPath, isMainModule, listDrafts, moveFile, nowIso, readJson, writeJson } from "./utils.js";

async function findDraftIdFromReply(message) {
  const replyMessageId = message?.reply_to_message?.message_id;
  if (!replyMessageId) {
    return "";
  }

  const pendingDrafts = await listDrafts("pending_review");
  const match = pendingDrafts.find(({ draft }) => String(draft.telegram_message_id) === String(replyMessageId));
  return match?.draft?.id || "";
}

async function parseCommand(message) {
  const text = message?.text || "";
  const trimmed = String(text || "").trim();
  const match = trimmed.match(/^\/(approve|rewrite|reject)(?:@\w+)?\s+(\S+)(?:\s+([\s\S]+))?$/i);
  if (match) {
    return {
      command: match[1].toLowerCase(),
      draftId: match[2],
      rest: (match[3] || "").trim()
    };
  }

  const replyDraftId = await findDraftIdFromReply(message);
  if (!replyDraftId) {
    return null;
  }

  const replyMatch = trimmed.match(/^\/?(approve|approved|ok|yes|continue|繼續|批准|通過|rewrite|revise|改|重寫|reject|rejected|唔要|不要)(?:\s+([\s\S]+))?$/i);
  if (!replyMatch) {
    return null;
  }

  const rawCommand = replyMatch[1].toLowerCase();
  const command = ["approve", "approved", "ok", "yes", "continue", "繼續", "批准", "通過"].includes(rawCommand)
    ? "approve"
    : ["reject", "rejected", "唔要", "不要"].includes(rawCommand)
      ? "reject"
      : "rewrite";

  return {
    command,
    draftId: replyDraftId,
    rest: (replyMatch[2] || "").trim()
  };
}

async function recordDecision(decision) {
  const state = await readJson("data/telegram_state.json", { last_update_id: 0, review_decisions: [] });
  state.review_decisions = state.review_decisions || [];
  state.review_decisions.push(decision);
  await writeJson("data/telegram_state.json", state);
}

async function approveDraft(draftId, reason) {
  const draftPath = await findDraftPath(draftId, ["pending_review"]);
  if (!draftPath) {
    const approvedPath = await findDraftPath(draftId, ["approved"]);
    if (approvedPath) {
      await sendTelegramMessage(`Draft ${draftId} is already approved. Publishing now.`);
      await publishApprovedDraft(draftId);
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
  await writeJson(draftPath, draft);
  await moveFile(draftPath, `drafts/approved/${draft.id}.json`);
  await recordDecision({ draft_id: draft.id, decision: "approved", reason: reason || "", timestamp: nowIso() });
  await sendTelegramMessage(`Approved ${draft.id}. Publishing now.`);
  await publishApprovedDraft(draft.id);
}

async function rejectDraft(draftId, reason) {
  const draftPath = await findDraftPath(draftId, ["pending_review"]);
  if (!draftPath) {
    await sendTelegramMessage(`Cannot reject ${draftId}: pending review draft not found.`);
    return;
  }
  const draft = await readJson(draftPath);
  draft.status = "rejected";
  draft.rejected_at = nowIso();
  draft.rejection_reason = reason || "";
  await writeJson(draftPath, draft);
  await moveFile(draftPath, `drafts/rejected/${draft.id}.json`);
  await recordDecision({ draft_id: draft.id, decision: "rejected", reason: reason || "", timestamp: nowIso() });
  await sendTelegramMessage(`Rejected ${draft.id}. It will not be published.`);
}

async function rewriteDraft(draftId, instruction) {
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

  draft.hook = rewritten.final_hook || draft.hook;
  draft.post = rewritten.final_post || draft.post;
  draft.coaching_advice_summary = rewritten.final_coaching_advice || draft.coaching_advice_summary;
  draft.status = "pending_review";
  draft.updated_at = nowIso();
  draft.review_notes = draft.review_notes || [];
  draft.review_notes.push({ type: "rewrite_instruction", text: instruction, timestamp: nowIso() });
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

export async function checkTelegramCommands() {
  const state = await readJson("data/telegram_state.json", { last_update_id: 0, review_decisions: [] });
  const updates = await getTelegramUpdates(Number(state.last_update_id || 0) + 1);
  let latestUpdateId = Number(state.last_update_id || 0);
  let processedCommands = 0;

  for (const update of updates) {
    latestUpdateId = Math.max(latestUpdateId, Number(update.update_id || 0));
    const message = update.message;
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
      await approveDraft(parsed.draftId, parsed.rest);
      processedCommands += 1;
    } else if (parsed.command === "rewrite") {
      await rewriteDraft(parsed.draftId, parsed.rest);
      processedCommands += 1;
    } else if (parsed.command === "reject") {
      await rejectDraft(parsed.draftId, parsed.rest);
      processedCommands += 1;
    }
  }

  if (latestUpdateId !== Number(state.last_update_id || 0)) {
    const nextState = await readJson("data/telegram_state.json", { last_update_id: 0, review_decisions: [] });
    nextState.last_update_id = latestUpdateId;
    await writeJson("data/telegram_state.json", nextState);
  }

  console.log(`Checked Telegram commands. Updates: ${updates.length}. Commands processed: ${processedCommands}.`);
}

if (isMainModule(import.meta.url)) {
  checkTelegramCommands().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
