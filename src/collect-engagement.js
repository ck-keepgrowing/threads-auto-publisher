import { loadDotEnv } from "./load-env.js";
import { readJson, writeJson } from "./storage.js";

loadDotEnv();

const PUBLISHED_PATH = "data/published.json";
const POSTS_PATH = "data/posts.json";
const PERFORMANCE_PATH = "data/performance.json";
const TOPIC_MEMORY_PATH = "data/topic-memory.json";

const THREADS_BASE = "https://graph.threads.net";
const MIN_AGE_HOURS = 48;
const MAX_AGE_HOURS = 120;

async function fetchInsights(mediaId, accessToken, apiVersion = "v1.0") {
  const url = new URL(`${THREADS_BASE}/${apiVersion}/${mediaId}/insights`);
  url.searchParams.set("metric", "likes,replies,reposts,quotes,views");
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url.toString());
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error?.message || `Threads API error: ${response.status}`);
  }

  const metrics = {};
  for (const item of payload.data || []) {
    metrics[item.name] = item.values?.[0]?.value ?? 0;
  }
  return metrics;
}

function computeEngagementScore(metrics) {
  return (
    (metrics.likes || 0) +
    (metrics.replies || 0) * 3 +
    (metrics.reposts || 0) * 2 +
    (metrics.quotes || 0) * 2
  );
}

function rebuildTopicMemory(publishedWithPillar, performance) {
  const perfMap = new Map(performance.map((p) => [p.id, p]));

  const recentUsage = publishedWithPillar
    .filter((p) => p.pillar)
    .map((p) => ({ pillar: p.pillar, date: p.date, postId: p.id }))
    .sort((a, b) => b.date.localeCompare(a.date));

  const pillarStats = {};
  for (const post of publishedWithPillar) {
    if (!post.pillar) continue;
    if (!pillarStats[post.pillar]) {
      pillarStats[post.pillar] = { useCount: 0, totalScore: 0, scoredCount: 0, avgEngagement: null, lastUsed: null };
    }
    const stats = pillarStats[post.pillar];
    stats.useCount++;
    if (!stats.lastUsed || post.date > stats.lastUsed) stats.lastUsed = post.date;
    const perf = perfMap.get(post.id);
    if (perf?.engagementScore != null) {
      stats.totalScore += perf.engagementScore;
      stats.scoredCount++;
      stats.avgEngagement = stats.totalScore / stats.scoredCount;
    }
  }

  return { recentUsage, pillarStats };
}

async function main() {
  const accessToken = process.env.THREADS_ACCESS_TOKEN;
  const apiVersion = process.env.THREADS_API_VERSION || "v1.0";

  if (!accessToken) throw new Error("THREADS_ACCESS_TOKEN is required.");

  const [published, posts, performance] = await Promise.all([
    readJson(PUBLISHED_PATH, []),
    readJson(POSTS_PATH, []),
    readJson(PERFORMANCE_PATH, []),
  ]);

  const pillarMap = new Map(posts.filter((p) => p.pillar).map((p) => [p.id, p.pillar]));
  const collectedIds = new Set(performance.map((p) => p.id));
  const now = Date.now();

  const eligible = published.filter((post) => {
    if (collectedIds.has(post.id)) return false;
    if (!post.publishedAt || !post.threadsResponse?.id) return false;
    const ageHours = (now - new Date(post.publishedAt).getTime()) / 3_600_000;
    return ageHours >= MIN_AGE_HOURS && ageHours <= MAX_AGE_HOURS;
  });

  console.log(`${eligible.length} posts eligible for engagement collection.`);

  for (const post of eligible) {
    try {
      const metrics = await fetchInsights(post.threadsResponse.id, accessToken, apiVersion);
      const engagementScore = computeEngagementScore(metrics);
      const pillar = post.pillar || pillarMap.get(post.id) || null;

      performance.push({
        id: post.id,
        date: post.date,
        pillar,
        publishedAt: post.publishedAt,
        collectedAt: new Date().toISOString(),
        metrics,
        engagementScore,
      });
      console.log(`  ${post.id}: score=${engagementScore} (likes=${metrics.likes ?? 0} replies=${metrics.replies ?? 0} reposts=${metrics.reposts ?? 0})`);
    } catch (error) {
      console.warn(`  ${post.id}: failed — ${error.message}`);
    }
  }

  await writeJson(PERFORMANCE_PATH, performance);

  const publishedWithPillar = published.map((p) => ({
    ...p,
    pillar: p.pillar || pillarMap.get(p.id) || null,
  }));

  const topicMemory = rebuildTopicMemory(publishedWithPillar, performance);
  await writeJson(TOPIC_MEMORY_PATH, topicMemory);

  const pillarCount = Object.keys(topicMemory.pillarStats).length;
  console.log(`Topic memory updated. ${pillarCount} pillars tracked.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
