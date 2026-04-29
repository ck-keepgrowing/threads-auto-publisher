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

function buildCallbackData(action, postId, approvalToken) {
  return approvalToken ? `${action}:${postId}:${approvalToken}` : `${action}:${postId}`;
}

function parseCallbackData(data) {
  const [action, postId, approvalToken] = String(data || "").split(":");
  if (!["APPROVE", "REJECT", "REVISE"].includes(action) || !postId) {
    return undefined;
  }

  return { action, postId, approvalToken };
}

export async function sendApprovalMessage({ post, date, slot, approvalToken }) {
  const { chatId } = requireTelegramConfig();
  const text = [
    `Threads approval request (${date} ${slot} HKT)`,
    "",
    `Post ID: ${post.id}`,
    "",
    post.text,
    "",
    "Reply with one of these:",
    "approve",
    "reject",
    "revise your edit instructions"
  ].join("\n");

  return requestTelegram("sendMessage", {
    chat_id: chatId,
    text,
    disable_web_page_preview: true
  });
}

export async function sendTelegramMessage(text) {
  const { chatId } = requireTelegramConfig();
  return requestTelegram("sendMessage", {
    chat_id: chatId,
    text,
    disable_web_page_preview: true
  });
}

export async function getApprovalDecision({ postId, requestedAt, telegramMessageId, approvalToken }) {
  const { chatId } = requireTelegramConfig();
  const result = await requestTelegram("getUpdates", {
    allowed_updates: ["message", "callback_query"],
    limit: 100,
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
    .map(({ updateId, query }) => ({
      updateId,
      query,
      parsed: parseCallbackData(query.data)
    }))
    .filter(({ parsed }) => parsed?.postId === postId)
    .filter(({ parsed, query }) => {
      if (approvalToken) {
        return parsed.approvalToken === approvalToken;
      }
      if (telegramMessageId) {
        return Number(query.message?.message_id) === Number(telegramMessageId);
      }
      return true;
    })
    .map(({ updateId, query, parsed }) => ({
      updateId,
      status: parsed.action === "APPROVE" ? "approved" : parsed.action === "REJECT" ? "rejected" : "revision_requested",
      messageId: query.message.message_id,
      decidedAt: new Date((query.message.date || Math.floor(Date.now() / 1000)) * 1000).toISOString()
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
        || normalized.startsWith("REVISE ")
        || normalized.startsWith("修改")
        || normalized.startsWith("更改")
        || normalized.startsWith("改")
        || normalized.includes("REVISE");
    })
    .map(({ updateId, message }) => {
      const normalized = message.text.trim().toUpperCase();
      const isApproved = normalized === "APPROVE" || normalized === "APPROVED" || normalized.startsWith("APPROVE ");
      const isRejected = normalized === "REJECT" || normalized === "REJECTED" || normalized.startsWith("REJECT ");
      const revisionInstructions = normalized.startsWith("REVISE")
        ? message.text.trim().replace(/^revise\s*/i, "").trim()
        : undefined;

      return {
        updateId,
        status: isApproved ? "approved" : isRejected ? "rejected" : "revision_requested",
        messageId: message.message_id,
        decidedAt: new Date(message.date * 1000).toISOString(),
        revisionInstructions: revisionInstructions || message.text.trim()
      };
    });

  const latest = [...callbackDecisions, ...textDecisions].sort((left, right) => right.updateId - left.updateId)[0];
  if (!latest) {
    return { status: "pending" };
  }

  return latest;
}
