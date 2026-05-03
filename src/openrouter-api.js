const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";

function extractText(response) {
  const text = response.choices?.[0]?.message?.content?.trim();

  if (!text) {
    throw new Error("OpenRouter response did not contain output text.");
  }

  return text;
}

export async function generateText({ instructions, input }) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";

  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is required for AI draft generation.");
  }

  const response = await fetch(OPENROUTER_CHAT_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/ck-keepgrowing/threads-auto-publisher",
      "X-OpenRouter-Title": "Threads Auto Publisher"
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: instructions
        },
        {
          role: "user",
          content: input
        }
      ],
      max_tokens: Number(process.env.OPENROUTER_MAX_TOKENS || 2200),
      temperature: 0.9
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error?.message || `OpenRouter API error: ${response.status}`);
  }

  return extractText(payload);
}
