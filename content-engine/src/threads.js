import { logError, requireEnv } from "./utils.js";

const BASE_URL = "https://graph.threads.net";

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

export async function publishTextToThreads(text) {
  try {
    const accessToken = requireEnv("THREADS_ACCESS_TOKEN");
    const userId = process.env.THREADS_USER_ID || "me";
    const apiVersion = process.env.THREADS_API_VERSION || "v1.0";
    const createUrl = `${BASE_URL}/${apiVersion}/${userId}/threads`;
    const publishUrl = `${BASE_URL}/${apiVersion}/${userId}/threads_publish`;

    const creation = await postForm(createUrl, {
      media_type: "TEXT",
      text,
      access_token: accessToken
    });
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
