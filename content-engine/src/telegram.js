import { logError, requireEnv } from "./utils.js";

function telegramUrl(method) {
  return `https://api.telegram.org/bot${requireEnv("TELEGRAM_BOT_TOKEN")}/${method}`;
}

async function telegramRequest(method, body) {
  const response = await fetch(telegramUrl(method), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(`Telegram ${method} failed: ${payload.description || response.statusText}`);
  }
  return payload.result;
}

export async function sendTelegramMessage(text) {
  try {
    return await telegramRequest("sendMessage", {
      chat_id: requireEnv("TELEGRAM_CHAT_ID"),
      text,
      disable_web_page_preview: true
    });
  } catch (error) {
    await logError("telegram:sendMessage", error);
    throw error;
  }
}

export async function answerCallbackQuery(callbackQueryId, text = "") {
  try {
    return await telegramRequest("answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      text
    });
  } catch (error) {
    await logError("telegram:answerCallbackQuery", error);
    return null;
  }
}

export async function getTelegramUpdates(offset) {
  try {
    return await telegramRequest("getUpdates", {
      offset,
      timeout: 0,
      allowed_updates: ["message", "callback_query"]
    });
  } catch (error) {
    await logError("telegram:getUpdates", error);
    throw error;
  }
}

export async function buildReviewMessage(draft) {
  return [
    "New Threads Draft Pending Review",
    "",
    `Draft ID: ${draft.id}`,
    draft.publish_due_at_hkt ? `Publish Time: ${draft.publish_due_at_hkt} HKT` : "",
    "",
    "Topic:",
    draft.topic,
    "",
    "Core Pain Point:",
    draft.core_pain_point,
    "",
    "Coaching Advice:",
    draft.coaching_advice_summary,
    "",
    "Hook:",
    draft.hook,
    "",
    "Post:",
    draft.post,
    "",
    `Critic Score: ${draft.critic_score}`,
    "",
    "Review:",
    "Use the Approve / Reject buttons below, or reply directly with rewrite instructions.",
    "Text fallback:",
    `/approve ${draft.id}`,
    `/rewrite ${draft.id} your instruction here`,
    `/reject ${draft.id} reason`
  ].filter(Boolean).join("\n");
}

export async function sendDraftForReview(draft) {
  const message = await buildReviewMessage(draft);
  const draftKey = String(draft.id || "").split("-").pop();
  return telegramRequest("sendMessage", {
    chat_id: requireEnv("TELEGRAM_CHAT_ID"),
    text: message,
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: [
        [
          { text: "Approve", callback_data: `approve:${draftKey}` },
          { text: "Reject", callback_data: `reject:${draftKey}` }
        ]
      ]
    }
  });
}
