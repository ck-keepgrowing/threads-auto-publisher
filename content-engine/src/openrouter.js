import { appendJsonArray, logError, readText, stripCodeFence, summarize } from "./utils.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MAX_TOKENS = 2200;

function resolveMaxTokens(promptName) {
  const explicit = process.env.OPENROUTER_MAX_TOKENS;
  if (explicit) {
    return Number(explicit);
  }

  if (/coach_writer|rewriter|telegram_review_message|prompt_optimizer/i.test(promptName)) {
    return Number(process.env.OPENROUTER_LONG_MAX_TOKENS || "4500");
  }

  return Number(process.env.OPENROUTER_SHORT_MAX_TOKENS || DEFAULT_MAX_TOKENS);
}

function parseJsonContent(content) {
  const cleaned = stripCodeFence(content);
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error("OpenRouter response was not valid JSON.");
  }
}

async function requestOpenRouter({ model, messages, jsonMode, maxTokens }) {
  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.OPENROUTER_HTTP_REFERER || "https://github.com/ck-keepgrowing/threads-auto-publisher",
      "X-Title": "Insurance Coach Content Engine"
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: Number(process.env.OPENROUTER_TEMPERATURE || "0.7"),
      max_tokens: maxTokens,
      ...(jsonMode ? { response_format: { type: "json_object" } } : {})
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.error?.message || response.statusText;
    throw new Error(`OpenRouter error ${response.status}: ${message}`);
  }

  return payload.choices?.[0]?.message?.content || "";
}

export async function callPrompt({ promptName, promptPath, input, json = true }) {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("Missing required environment variable: OPENROUTER_API_KEY");
  }

  const prompt = await readText(promptPath);
  const primaryModel = process.env.OPENROUTER_MODEL || "openai/gpt-5.4-mini";
  const fallbackModel = process.env.OPENROUTER_FALLBACK_MODEL || primaryModel;
  const maxTokens = resolveMaxTokens(promptName);
  const messages = [
    { role: "system", content: prompt },
    { role: "user", content: JSON.stringify(input, null, 2) }
  ];
  const startedAt = new Date().toISOString();

  const models = fallbackModel === primaryModel ? [primaryModel, primaryModel] : [primaryModel, fallbackModel];

  for (const [index, model] of models.entries()) {
    try {
      const content = await requestOpenRouter({ model, messages, jsonMode: json, maxTokens });
      const output = json ? parseJsonContent(content) : content.trim();
      await appendJsonArray("logs/ai_calls.json", {
        prompt_name: promptName,
        model,
        timestamp: startedAt,
        input_summary: summarize(input),
        output_summary: summarize(output),
        max_tokens: maxTokens,
        success: true,
        retry_index: index
      });
      return output;
    } catch (error) {
      await appendJsonArray("logs/ai_calls.json", {
        prompt_name: promptName,
        model,
        timestamp: startedAt,
        input_summary: summarize(input),
        output_summary: "",
        max_tokens: maxTokens,
        success: false,
        retry_index: index,
        error: error.message
      });
      if (index === models.length - 1) {
        await logError(`openrouter:${promptName}`, error);
        throw error;
      }
    }
  }

  throw new Error(`OpenRouter call failed for ${promptName}`);
}
