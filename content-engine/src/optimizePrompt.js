import { callPrompt } from "./openrouter.js";
import { appendJsonArray, isMainModule, nowIso, readJson, readText, writeJson, writeText } from "./utils.js";

function percentileSlice(items, top = true) {
  if (items.length === 0) {
    return [];
  }
  const sorted = [...items].sort((a, b) => Number(b.engagement_score || 0) - Number(a.engagement_score || 0));
  const count = Math.max(1, Math.ceil(sorted.length * 0.2));
  return top ? sorted.slice(0, count) : sorted.slice(-count);
}

function mergeUniqueList(existing, additions) {
  const set = new Set(existing);
  for (const item of additions || []) {
    if (item && !set.has(item)) {
      set.add(item);
    }
  }
  return Array.from(set);
}

async function appendLearningRules(promptPath, title, rules) {
  if (!rules?.length) {
    return;
  }
  const current = await readText(promptPath);
  const block = [
    "",
    `<!-- learning-rules:${new Date().toISOString()} -->`,
    title,
    ...rules.map((rule) => `- ${rule}`)
  ].join("\n");
  await writeText(promptPath, `${current.trim()}\n${block}\n`);
}

export async function optimizePrompt() {
  const performance = await readJson("data/performance_log.json", []);
  const telegramState = await readJson("data/telegram_state.json", { review_decisions: [] });
  const humanFeedback = await readJson("data/human_feedback.json", []);
  const contentDna = await readJson("data/content_dna.json", {});
  const coachingPrinciples = await readJson("data/coaching_principles.json", {});
  const topPosts = percentileSlice(performance, true);
  const bottomPosts = percentileSlice(performance, false);

  const optimization = await callPrompt({
    promptName: "07_prompt_optimizer",
    promptPath: "prompts/07_prompt_optimizer.md",
    input: {
      performance_log: performance,
      top_20_percent_posts: topPosts,
      bottom_20_percent_posts: bottomPosts,
      telegram_review_decisions: telegramState.review_decisions || [],
      human_feedback: humanFeedback,
      current_content_dna: contentDna,
      current_coaching_principles: coachingPrinciples,
      safety_rules: [
        "Preserve Hong Kong Cantonese",
        "Preserve no emoji",
        "Preserve no hard sell",
        "Preserve coach positioning",
        "Preserve pain point + advice structure",
        "Preserve open-ended reflection",
        "Preserve no fake success guru tone"
      ]
    }
  });

  const version = {
    timestamp: nowIso(),
    model: process.env.OPENROUTER_MODEL || "openai/gpt-5.4-mini",
    optimization
  };
  await appendJsonArray("data/prompt_versions.json", version);

  const learningReport = optimization.learning_report || {};
  contentDna.coaching_angles = mergeUniqueList(contentDna.coaching_angles || [], learningReport.top_coaching_angles);
  contentDna.avoid_topics = mergeUniqueList(contentDna.avoid_topics || [], learningReport.content_to_avoid);
  await writeJson("data/content_dna.json", contentDna);

  coachingPrinciples.learned_rules = mergeUniqueList(coachingPrinciples.learned_rules || [], optimization.new_critic_rules || optimization.new_writer_rules);
  coachingPrinciples.human_editorial_preferences = mergeUniqueList(
    coachingPrinciples.human_editorial_preferences || [],
    [
      ...(optimization.human_editorial_insights || []),
      ...(optimization.preferred_wording || []),
      ...(optimization.wording_to_avoid || []),
      ...(optimization.repeated_rewrite_patterns || []),
      ...(optimization.brand_taste_rules || [])
    ]
  );
  await writeJson("data/coaching_principles.json", coachingPrinciples);

  await appendLearningRules("prompts/01_topic_generator.md", "Learned topic rules:", optimization.new_topic_rules);
  await appendLearningRules("prompts/04_coach_writer.md", "Learned writer rules:", optimization.new_writer_rules);
  await appendLearningRules("prompts/05_critic.md", "Learned critic rules:", optimization.new_critic_rules);
  await appendLearningRules("prompts/04_coach_writer.md", "Human editorial preferences:", optimization.human_editorial_insights);
  await appendLearningRules("prompts/04_coach_writer.md", "Preferred wording:", optimization.preferred_wording);
  await appendLearningRules("prompts/04_coach_writer.md", "Wording to avoid:", optimization.wording_to_avoid);
  await appendLearningRules("prompts/04_coach_writer.md", "Brand taste rules:", optimization.brand_taste_rules);
  await appendLearningRules("prompts/06_rewriter.md", "Human editorial preferences:", optimization.human_editorial_insights);
  await appendLearningRules("prompts/06_rewriter.md", "Preferred wording:", optimization.preferred_wording);
  await appendLearningRules("prompts/06_rewriter.md", "Wording to avoid:", optimization.wording_to_avoid);
  await appendLearningRules("prompts/05_critic.md", "Brand taste rules:", optimization.brand_taste_rules);

  await writeJson(`logs/learning-report-${nowIso().slice(0, 10)}.json`, learningReport);
  console.log("Prompt optimization completed and learning report saved.");
}

if (isMainModule(import.meta.url)) {
  optimizePrompt().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
