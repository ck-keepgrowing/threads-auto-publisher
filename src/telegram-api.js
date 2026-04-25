const BASE_URL = "https://api.telegram.org";

function requireTelegramConfig() {
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

async function requestTelegram(method, payload) {
  const { botToken } = requireTelegramConfig();
  const response = await fetch(`${BASE_URL}/bot${botToken}/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok === false) {
    throw new Error(result.description || `Telegram API error: ${response.status}`);
  }

  return result.result;
}

export async function sendApprovalMessage({ post, date, slot }) {
  const { chatId } = requireTelegramConfig();
  const text = [
    `Threads approval request (${date} ${slot} HKT)`,
    "",
    `Post ID: ${post.id}`,
    "",
    post.text,
    "",
    "Tap a button below, or reply with:",
    "REVISE your edit instructions"
  ].join("\n");

  return requestTelegram("sendMessage", {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: [
        [
          { text: "Approve", callback_data: `APPROVE:${post.id}` },
          { text: "Reject", callback_data: `REJECT:${post.id}` },
          { text: "Revise", callback_data: `REVISE:${post.id}` }
        ]
      ]
    }
  });
}

export async function getApprovalDecision({ postId, requestedAt }) {
  const { chatId } = requireTelegramConfig();
  const result = await requestTelegram("getUpdates", {
    allowed_updates: ["message", "callback_query"],
    timeout: 0
  });

  const requestedUnix = requestedAt ? Math.floor(new Date(requestedAt).getTime() / 1000) : 0;

  const callbackDecisions = result
    .map((update) => update.callback_query)
    .filter(Boolean)
    .filter((query) => String(query.message?.chat?.id) === String(chatId))
    .filter((query) => !requestedUnix || query.message?.date >= requestedUnix)
    .filter((query) => query.data === `APPROVE:${postId}` || query.data === `REJECT:${postId}` || query.data === `REVISE:${postId}`)
    .map((query) => ({
      status: query.data.startsWith("APPROVE:") ? "approved" : query.data.startsWith("REJECT:") ? "rejected" : "revision_requested",
      messageId: query.message.message_id,
      decidedAt: new Date(query.message.date * 1000).toISOString()
    }));

  const textDecisions = result
    .map((update) => update.message)
    .filter(Boolean)
    .filter((message) => String(message.chat?.id) === String(chatId))
    .filter((message) => !requestedUnix || message.date >= requestedUnix)
    .filter((message) => typeof message.text === "string")
    .filter((message) => {
      const normalized = message.text.trim().toUpperCase();
      return normalized === `APPROVE ${postId}` || normalized === `REJECT ${postId}` || normalized.startsWith("REVISE ");
    })
    .map((message) => {
      const normalized = message.text.trim().toUpperCase();
      return {
        status: normalized.startsWith("APPROVE ") ? "approved" : normalized.startsWith("REJECT ") ? "rejected" : "revision_requested",
        messageId: message.message_id,
        decidedAt: new Date(message.date * 1000).toISOString(),
        revisionInstructions: normalized.startsWith("REVISE ") ? message.text.trim().slice("REVISE ".length).trim() : undefined
      };
    });

  const latest = [...callbackDecisions, ...textDecisions].sort((left, right) => new Date(right.decidedAt) - new Date(left.decidedAt))[0];
  if (!latest) {
    return { status: "pending" };
  }

  return latest;
}
