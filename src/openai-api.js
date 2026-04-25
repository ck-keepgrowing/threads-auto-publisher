const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

function extractText(response) {
  if (response.output_text) {
    return response.output_text.trim();
  }

  const text = response.output
    ?.flatMap((item) => item.content || [])
    ?.map((content) => content.text)
    ?.filter(Boolean)
    ?.join("\n")
    ?.trim();

  if (!text) {
    throw new Error("OpenAI response did not contain output text.");
  }

  return text;
}

export async function generateText({ instructions, input }) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-5.4-mini";

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for AI draft generation.");
  }

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      instructions,
      input,
      max_output_tokens: 700
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error?.message || `OpenAI API error: ${response.status}`);
  }

  return extractText(payload);
}
