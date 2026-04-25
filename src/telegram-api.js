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
    "Tap a button below.",
    "Or reply: approve / reject / revise your edit instructions"
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
    .filter((update) => update.callback_query)
    .map((update) => ({
      updateId: update.update_id,
      query: update.callback_query
    }))
    .filter(({ query }) => String(query.message?.chat?.id) === String(chatId))
    .filter(({ query }) => query.data === `APPROVE:${postId}` || query.data === `REJECT:${postId}` || query.data === `REVISE:${postId}`)
    .map(({ updateId, query }) => ({
      updateId,
      status: query.data.startsWith("APPROVE:") ? "approved" : query.data.startsWith("REJECT:") ? "rejected" : "revision_requested",
      messageId: query.message.message_id,
      decidedAt: new Date(query.message.date * 1000).toISOString()
    }));

  const textDecisions = result
    .filter((update) => update.message)
    .map((update) => ({
      updateId: update.update_id,
      message: update.message
    }))
    .filter(({ message }) => String(message.chat?.id) === String(chatId))
    .filter(({ message }) => !requestedUnix || message.date >= requestedUnix)
    .filter(({ message }) => typeof message.text === "string")
    .filter(({ message }) => {
      const normalized = message.text.trim().toUpperCase();
      return normalized === "APPROVE"
        || normalized === "APPROVED"
        || normalized === `APPROVE ${postId}`
        || normalized === "REJECT"
        || normalized === "REJECTED"
        || normalized === `REJECT ${postId}`
        || normalized === "REVISE"
        || normalized.startsWith("REVISE ");
    })
    .map(({ updateId, message }) => {
      const normalized = message.text.trim().toUpperCase();
      const isApproved = normalized === "APPROVE" || normalized === "APPROVED" || normalized.startsWith("APPROVE ");
      const isRejected = normalized === "REJECT" || normalized === "REJECTED" || normalized.startsWith("REJECT ");
      const revisionInstructions = normalized.startsWith("REVISE ")
        ? message.text.trim().slice("REVISE ".length).trim()
        : undefined;

      return {
        updateId,
        status: isApproved ? "approved" : isRejected ? "rejected" : "revision_requested",
        messageId: message.message_id,
        decidedAt: new Date(message.date * 1000).toISOString(),
        revisionInstructions
      };
    });

  const latest = [...callbackDecisions, ...textDecisions].sort((left, right) => right.updateId - left.updateId)[0];
  if (!latest) {
    return { status: "pending" };
  }

  return latest;
}
