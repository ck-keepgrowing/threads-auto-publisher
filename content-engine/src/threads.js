import { logError, requireEnv } from "./utils.js";

const BASE_URL = "https://graph.threads.net";
const MAX_THREADS_TEXT_LENGTH = 480;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function replyWaitMs() {
  return Number(process.env.THREADS_REPLY_WAIT_MS || "10000");
}

function maxReplyAttempts() {
  return Number(process.env.THREADS_REPLY_ATTEMPTS || "3");
}

async function postForm(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Threads API error ${response.status}: ${payload.error?.message || response.statusText}`);
  }
  return payload;
}

async function getJson(url) {
  const response = await fetch(url);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Threads API error ${response.status}: ${payload.error?.message || response.statusText}`);
  }
  return payload;
}

export function splitThreadText(text, maxLength = MAX_THREADS_TEXT_LENGTH) {
  const normalized = String(text || "").trim();
  if (normalized.length <= maxLength) {
    return [normalized];
  }

  const paragraphs = normalized.split(/\n{2,}/);
  const parts = [];
  let current = "";

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length <= maxLength) {
      current = candidate;
      continue;
    }

    if (current) {
      parts.push(current);
      current = "";
    }

    if (paragraph.length <= maxLength) {
      current = paragraph;
      continue;
    }

    const sentences = paragraph.split(/(?<=[。！？.!?])\s*/u).filter(Boolean);
    for (const sentence of sentences) {
      if (sentence.length > maxLength) {
        for (let index = 0; index < sentence.length; index += maxLength) {
          parts.push(sentence.slice(index, index + maxLength));
        }
        continue;
      }

      const sentenceCandidate = current ? `${current}${sentence}` : sentence;
      if (sentenceCandidate.length <= maxLength) {
        current = sentenceCandidate;
      } else {
        if (current) {
          parts.push(current);
        }
        current = sentence;
      }
    }
  }

  if (current) {
    parts.push(current);
  }

  return parts.filter(Boolean);
}

export async function publishTextToThreads(text, { replyToId } = {}) {
  try {
    const accessToken = requireEnv("THREADS_ACCESS_TOKEN");
    const userId = process.env.THREADS_USER_ID || "me";
    const apiVersion = process.env.THREADS_API_VERSION || "v1.0";
    const createUrl = `${BASE_URL}/${apiVersion}/${userId}/threads`;
    const publishUrl = `${BASE_URL}/${apiVersion}/${userId}/threads_publish`;

    const createBody = {
      media_type: "TEXT",
      text,
      access_token: accessToken
    };

    if (replyToId) {
      createBody.reply_to_id = replyToId;
    }

    const creation = await postForm(createUrl, createBody);
    const creationId = creation.id || creation.creation_id;
    if (!creationId) {
      throw new Error("Threads API did not return a creation id.");
    }

    const result = await postForm(publishUrl, {
      creation_id: creationId,
      access_token: accessToken
    });
    return result;
  } catch (error) {
    await logError("threads:publish", error);
    throw error;
  }
}

export async function publishThreadToThreads(text) {
  const parts = splitThreadText(text);
  const results = [];
  let replyToId = null;
  let replyModeAvailable = true;

  for (const [index, part] of parts.entries()) {
    if (replyToId && replyModeAvailable) {
      await sleep(replyWaitMs());
    }

    let result;
    let fallbackStandalone = false;
    let fallbackReason = "";
    const shouldReply = Boolean(replyToId && replyModeAvailable);

    if (shouldReply) {
      for (let attempt = 1; attempt <= maxReplyAttempts(); attempt += 1) {
        try {
          result = await publishTextToThreads(part, { replyToId });
          break;
        } catch (error) {
          const canRetryReply = /requested resource does not exist/i.test(error.message);
          if (!canRetryReply || attempt === maxReplyAttempts()) {
            fallbackReason = error.message;
            await logError("threads:reply_fallback", error, {
              part_index: index + 1,
              reply_to_id: replyToId,
              attempts: attempt
            });
            break;
          }
          await sleep(replyWaitMs() * attempt);
        }
      }
    }

    if (!result) {
      fallbackStandalone = shouldReply;
      if (fallbackStandalone) {
        replyModeAvailable = false;
      }
      result = await publishTextToThreads(part);
    }

    const postId = result.id || result.post_id || result.thread_id || result.media_id;
    results.push({
      index: index + 1,
      text: part,
      threads_response: result,
      threads_post_id: postId || null,
      fallback_standalone: fallbackStandalone,
      fallback_reason: fallbackReason
    });

    if (!replyToId) {
      replyToId = postId;
    }

    if (index < parts.length - 1 && !replyToId) {
      throw new Error(`Threads API did not return a post id for thread part ${index + 1}. Cannot publish continuation replies.`);
    }
  }

  return results;
}

export async function fetchThreadsMetrics(postId) {
  if (!postId) {
    return {};
  }
  const accessToken = requireEnv("THREADS_ACCESS_TOKEN");
  const apiVersion = process.env.THREADS_API_VERSION || "v1.0";
  const metricNames = process.env.THREADS_METRIC_NAMES || "views,likes,replies,reposts,quotes,shares";
  try {
    return await getJson(`${BASE_URL}/${apiVersion}/${postId}/insights?metric=${encodeURIComponent(metricNames)}&access_token=${encodeURIComponent(accessToken)}`);
  } catch (error) {
    await logError("threads:metrics", error, { postId });
    return { error: error.message };
  }
}
