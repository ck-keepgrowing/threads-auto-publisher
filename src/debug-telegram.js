import { writeJson } from "./storage.js";
import { loadDotEnv } from "./load-env.js";

loadDotEnv();

const BASE_URL = "https://api.telegram.org";
const DEBUG_PATH = "data/telegram-debug.json";

function requireConfig() {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken) {
    throw new Error("TELEGRAM_BOT_TOKEN is required.");
  }
  if (!chatId) {
    throw new Error("TELEGRAM_CHAT_ID is required.");
  }

  return { botToken, chatId };
}

function classifyText(text) {
  if (typeof text !== "string") {
    return undefined;
  }

  const normalized = text.trim().toUpperCase();
  if (normalized === "APPROVE" || normalized === "APPROVED" || normalized.startsWith("APPROVE ")) {
    return "approve";
  }
  if (normalized === "REJECT" || normalized === "REJECTED" || normalized.startsWith("REJECT ")) {
    return "reject";
  }
  if (normalized === "REVISE" || normalized.startsWith("REVISE ")) {
    return "revise";
  }
  return "other";
}

function classifyCallback(data) {
  const [action, postId, approvalToken] = String(data || "").split(":");
  if (!["APPROVE", "REJECT", "REVISE"].includes(action)) {
    return { action: "other" };
  }

  return {
    action: action.toLowerCase(),
    postId,
    hasApprovalToken: Boolean(approvalToken)
  };
}

async function main() {
  const { botToken, chatId } = requireConfig();
  const response = await fetch(`${BASE_URL}/bot${botToken}/getUpdates`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      allowed_updates: ["message", "callback_query"],
      offset: -100,
      timeout: 0
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.description || `Telegram API error: ${response.status}`);
  }

  const updates = payload.result || [];
  const summary = updates.slice(-20).map((update) => {
    if (update.callback_query) {
      const query = update.callback_query;
      return {
        updateId: update.update_id,
        type: "callback_query",
        chatMatches: String(query.message?.chat?.id) === String(chatId),
        messageId: query.message?.message_id,
        messageDate: query.message?.date ? new Date(query.message.date * 1000).toISOString() : undefined,
        callback: classifyCallback(query.data)
      };
    }

    if (update.message) {
      const message = update.message;
      return {
        updateId: update.update_id,
        type: "message",
        chatMatches: String(message.chat?.id) === String(chatId),
        messageId: message.message_id,
        messageDate: message.date ? new Date(message.date * 1000).toISOString() : undefined,
        textClass: classifyText(message.text)
      };
    }

    return {
      updateId: update.update_id,
      type: "other"
    };
  });

  await writeJson(DEBUG_PATH, {
    checkedAt: new Date().toISOString(),
    updateCount: updates.length,
    matchingChatCount: summary.filter((item) => item.chatMatches).length,
    latest: summary
  });

  console.log(`Wrote Telegram debug summary for ${updates.length} updates.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
