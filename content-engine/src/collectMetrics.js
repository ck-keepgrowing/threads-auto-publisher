import { fetchThreadsMetrics } from "./threads.js";
import { isMainModule, nowIso, readJson, writeJson } from "./utils.js";

function metricValue(payload, name) {
  if (!payload) {
    return 0;
  }
  if (typeof payload[name] === "number") {
    return payload[name];
  }
  const item = payload.data?.find((entry) => entry.name === name);
  const value = item?.values?.[0]?.value ?? item?.value;
  return Number(value || 0);
}

function engagementScore(metrics) {
  return Number((
    metricValue(metrics, "views") * 0.01 +
    metricValue(metrics, "likes") * 1 +
    metricValue(metrics, "replies") * 4 +
    metricValue(metrics, "reposts") * 6 +
    metricValue(metrics, "quotes") * 6 +
    metricValue(metrics, "shares") * 7
  ).toFixed(2));
}

export async function collectMetrics() {
  const published = await readJson("data/published_posts.json", []);
  const performance = await readJson("data/performance_log.json", []);
  const byId = new Map(performance.map((item) => [item.id, item]));

  for (const post of published) {
    const metrics = await fetchThreadsMetrics(post.threads_post_id);
    byId.set(post.id, {
      id: post.id,
      collected_at: nowIso(),
      threads_post_id: post.threads_post_id,
      topic: post.topic,
      category: post.category,
      core_pain_point: post.core_pain_point,
      hidden_psychology: post.hidden_psychology,
      coaching_advice_summary: post.coaching_advice_summary,
      hook: post.hook,
      hook_type: post.hook_type || "",
      content_type: post.content_type || post.category || "",
      target_reader: post.target_reader || "",
      emotional_trigger: post.emotional_trigger || "",
      practical_advice_type: post.practical_advice_type || "",
      metrics,
      engagement_score: engagementScore(metrics)
    });
  }

  await writeJson("data/performance_log.json", Array.from(byId.values()));
  console.log(`Collected metrics for ${published.length} published posts.`);
}

if (isMainModule(import.meta.url)) {
  collectMetrics().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
