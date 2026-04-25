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
    `Approve: APPROVE ${post.id}`,
    `Reject: REJECT ${post.id}`
  ].join("\n");

  return requestTelegram("sendMessage", {
    chat_id: chatId,
    text,
    disable_web_page_preview: true
  });
}

export async function getApprovalDecision({ postId, requestedAt }) {
  const { chatId } = requireTelegramConfig();
  const result = await requestTelegram("getUpdates", {
    allowed_updates: ["message"],
    timeout: 0
  });

  const requestedUnix = requestedAt ? Math.floor(new Date(requestedAt).getTime() / 1000) : 0;
  const matchingMessages = result
    .map((update) => update.message)
    .filter(Boolean)
    .filter((message) => String(message.chat?.id) === String(chatId))
    .filter((message) => !requestedUnix || message.date >= requestedUnix)
    .filter((message) => typeof message.text === "string")
    .filter((message) => {
      const normalized = message.text.trim().toUpperCase();
      return normalized === `APPROVE ${postId}` || normalized === `REJECT ${postId}`;
    })
    .sort((left, right) => right.date - left.date);

  const latest = matchingMessages[0];
  if (!latest) {
    return { status: "pending" };
  }

  const normalized = latest.text.trim().toUpperCase();
  return {
    status: normalized.startsWith("APPROVE ") ? "approved" : "rejected",
    messageId: latest.message_id,
    decidedAt: new Date(latest.date * 1000).toISOString()
  };
}
