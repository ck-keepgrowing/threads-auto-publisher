import { callPrompt } from "./openrouter.js";
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

export async function getTelegramUpdates(offset) {
  try {
    return await telegramRequest("getUpdates", {
      offset,
      timeout: 0,
      allowed_updates: ["message"]
    });
  } catch (error) {
    await logError("telegram:getUpdates", error);
    throw error;
  }
}

export async function buildReviewMessage(draft) {
  try {
    return await callPrompt({
      promptName: "08_telegram_review_message",
      promptPath: "prompts/08_telegram_review_message.md",
      input: { draft },
      json: false
    });
  } catch {
    return [
      "New Threads Draft Pending Review",
      "",
      `Draft ID: ${draft.id}`,
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
      "Reply with one of these commands:",
      `/approve ${draft.id}`,
      `/rewrite ${draft.id} your instruction here`,
      `/reject ${draft.id} reason`,
      "",
      "You can also reply directly to this message with rewrite instructions, or send approve / reject when there is only one pending draft."
    ].join("\n");
  }
}

export async function sendDraftForReview(draft) {
  const message = await buildReviewMessage(draft);
  return sendTelegramMessage(message);
}
