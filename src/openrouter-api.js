const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_MAX_RETRIES = 2;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseModels() {
  const primary = process.env.OPENROUTER_MODEL || "anthropic/claude-sonnet-4.5";
  const fallbacksRaw = process.env.OPENROUTER_FALLBACK_MODELS
    || "anthropic/claude-haiku-4.5,openai/gpt-4o";
  // OpenRouter caps the models[] array at 3 entries total (primary + fallbacks).
  const fallbacks = fallbacksRaw
    .split(",")
    .map((slug) => slug.trim())
    .filter((slug) => slug && slug !== primary)
    .slice(0, 2);
  return { primary, fallbacks };
}

function extractText(response) {
  const message = response.choices?.[0]?.message;
  if (!message) {
    throw new Error("OpenRouter response did not contain a message.");
  }
  const content = typeof message.content === "string"
    ? message.content
    : Array.isArray(message.content)
      ? message.content.map((part) => part?.text || "").join("")
      : "";
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error("OpenRouter response did not contain output text.");
  }
  return trimmed;
}

async function callOpenRouter({ apiKey, primary, fallbacks, instructions, input, maxTokens, timeoutMs }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const body = {
      model: primary,
      messages: [
        { role: "system", content: instructions },
        { role: "user", content: input }
      ],
      max_tokens: maxTokens,
      temperature: 0.9
    };

    if (fallbacks.length > 0) {
      // OpenRouter native fallback: if primary fails (rate-limited, errored,
      // unavailable), it auto-routes to the next entry in this list.
      body.models = [primary, ...fallbacks];
    }

    const response = await fetch(OPENROUTER_CHAT_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/ck-keepgrowing/threads-auto-publisher",
        "X-Title": "Threads Auto Publisher"
      },
      body: JSON.stringify(body)
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload.error?.message || response.statusText;
      const error = new Error(`OpenRouter API error ${response.status}: ${message}`);
      error.status = response.status;
      throw error;
    }

    return { text: extractText(payload), modelUsed: payload.model || primary };
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`OpenRouter request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function isRetryable(error) {
  if (!error) return false;
  if (error.message?.includes("timed out")) return true;
  const status = error.status;
  if (!status) return true; // network errors -> retry
  return status === 429 || status >= 500;
}

export async function generateText({ instructions, input }) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is required for AI draft generation.");
  }

  const { primary, fallbacks } = parseModels();
  const maxTokens = Number(process.env.OPENROUTER_MAX_TOKENS || 2200);
  const timeoutMs = Number(process.env.OPENROUTER_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  const maxRetries = Number(process.env.OPENROUTER_MAX_RETRIES || DEFAULT_MAX_RETRIES);

  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const { text, modelUsed } = await callOpenRouter({
        apiKey, primary, fallbacks, instructions, input, maxTokens, timeoutMs
      });
      if (modelUsed && modelUsed !== primary) {
        console.log(`OpenRouter fell back to ${modelUsed} (primary ${primary}).`);
      }
      return text;
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === maxRetries) {
        break;
      }
      const backoff = Math.min(2000 * 2 ** attempt, 15000);
      console.warn(`OpenRouter call failed (attempt ${attempt + 1}): ${error.message}. Retrying in ${backoff}ms.`);
      await sleep(backoff);
    }
  }

  throw lastError || new Error("OpenRouter call failed.");
}
