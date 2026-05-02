import { overlapScore, readJson } from "./utils.js";

function scoreAgainstPost(draft, post) {
  const topicScore = overlapScore(draft.topic, post.topic);
  const hookScore = overlapScore(draft.hook, post.hook);
  const postScore = overlapScore(draft.post, post.post || post.text);
  const painScore = overlapScore(draft.core_pain_point, post.core_pain_point);
  return Math.max(topicScore, hookScore, painScore, postScore * 0.8);
}

export async function checkDuplicate(draft) {
  const published = await readJson("data/published_posts.json", []);
  const recent = published.slice(-50);
  const matches = recent
    .map((post) => ({
      id: post.id,
      topic: post.topic,
      score: scoreAgainstPost(draft, post)
    }))
    .filter((match) => match.score >= 0.55)
    .sort((a, b) => b.score - a.score);

  return {
    isDuplicate: matches.length > 0,
    matches
  };
}
