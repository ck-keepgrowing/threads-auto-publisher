import { checkDuplicate } from "./duplicateChecker.js";
import { callPrompt } from "./openrouter.js";
import { COACH_SCHEDULE, getHongKongTimeParts, getSlotForReview, hasDraftForSlot } from "./schedule.js";
import { sendDraftForReview } from "./telegram.js";
import { isMainModule, makeDraftId, nowIso, readJson, writeJson } from "./utils.js";

async function loadContext() {
  return {
    brand_profile: await readJson("data/brand_profile.json", {}),
    audience_profile: await readJson("data/audience_profile.json", {}),
    content_dna: await readJson("data/content_dna.json", {}),
    coaching_principles: await readJson("data/coaching_principles.json", {}),
    forbidden_topics: await readJson("data/forbidden_topics.json", {}),
    published_posts: await readJson("data/published_posts.json", []),
    performance_log: await readJson("data/performance_log.json", [])
  };
}

function labelsFrom(writer, rewrite) {
  return {
    hook_type: rewrite?.labels?.hook_type || writer?.labels?.hook_type || "",
    content_type: rewrite?.labels?.content_type || writer?.labels?.content_type || "",
    target_reader: rewrite?.labels?.target_reader || writer?.labels?.target_reader || "",
    emotional_trigger: rewrite?.labels?.emotional_trigger || writer?.labels?.emotional_trigger || "",
    practical_advice_type: rewrite?.labels?.practical_advice_type || writer?.labels?.practical_advice_type || ""
  };
}

async function generateDraftAttempt(context, previousDuplicate = null) {
  const topics = await callPrompt({
    promptName: "01_topic_generator",
    promptPath: "prompts/01_topic_generator.md",
    input: { ...context, previous_duplicate: previousDuplicate }
  });

  const scored = await callPrompt({
    promptName: "02_topic_scorer",
    promptPath: "prompts/02_topic_scorer.md",
    input: { ...context, generated_topics: topics }
  });

  const selectedTopic = scored.selected_topics?.[0] || topics.topics?.[0];
  if (!selectedTopic) {
    throw new Error("No topic was generated.");
  }

  const angle = await callPrompt({
    promptName: "03_angle_expander",
    promptPath: "prompts/03_angle_expander.md",
    input: { ...context, selected_topic: selectedTopic }
  });

  const writer = await callPrompt({
    promptName: "04_coach_writer",
    promptPath: "prompts/04_coach_writer.md",
    input: { ...context, selected_topic: selectedTopic, angle }
  });

  const critic = await callPrompt({
    promptName: "05_critic",
    promptPath: "prompts/05_critic.md",
    input: { ...context, selected_topic: selectedTopic, angle, draft: writer }
  });

  let finalHook = writer.hook;
  let finalPost = writer.post;
  let finalAdvice = writer.coaching_advice_summary;
  let rewrite = null;

  if (Number(critic.score || 0) < 8) {
    rewrite = await callPrompt({
      promptName: "06_rewriter",
      promptPath: "prompts/06_rewriter.md",
      input: { ...context, selected_topic: selectedTopic, angle, draft: writer, critic }
    });
    finalHook = rewrite.final_hook || finalHook;
    finalPost = rewrite.final_post || finalPost;
    finalAdvice = rewrite.final_coaching_advice || finalAdvice;
  }

  const draft = {
    id: makeDraftId(selectedTopic.topic || angle.topic),
    topic: selectedTopic.topic || angle.topic || "",
    category: selectedTopic.category || "",
    core_pain_point: writer.core_pain_point || selectedTopic.core_pain_point || angle.hidden_pain || "",
    hidden_psychology: selectedTopic.hidden_psychology || angle.why_it_happens || "",
    coaching_advice_summary: finalAdvice || "",
    hook: finalHook || "",
    post: finalPost || "",
    critic_score: Number(critic.score || 0),
    status: "pending_review",
    created_at: nowIso(),
    telegram_message_id: null,
    review_notes: [],
    labels: labelsFrom(writer, rewrite),
    hook_type: labelsFrom(writer, rewrite).hook_type,
    content_type: labelsFrom(writer, rewrite).content_type || selectedTopic.category || "",
    target_reader: labelsFrom(writer, rewrite).target_reader,
    emotional_trigger: labelsFrom(writer, rewrite).emotional_trigger,
    practical_advice_type: labelsFrom(writer, rewrite).practical_advice_type,
    ai_metadata: {
      selected_topic: selectedTopic,
      angle,
      critic,
      rewrite_applied: Boolean(rewrite)
    }
  };

  return draft;
}

function resolveGenerationSlot() {
  const current = getHongKongTimeParts();
  const requestedSlot = process.env.TARGET_SLOT;
  if (requestedSlot) {
    const scheduleItem = COACH_SCHEDULE.find((item) => item.slot === requestedSlot);
    if (!scheduleItem) {
      throw new Error(`Unknown TARGET_SLOT: ${requestedSlot}`);
    }
    return { date: process.env.TARGET_DATE || current.date, ...scheduleItem };
  }

  const reviewSlot = getSlotForReview();
  if (!reviewSlot) {
    return null;
  }
  return { date: current.date, ...reviewSlot };
}

export async function generateDraft() {
  const slotInfo = resolveGenerationSlot();
  if (!slotInfo) {
    console.log("No coach draft is due for review now.");
    return null;
  }

  if (await hasDraftForSlot(slotInfo.date, slotInfo.slot)) {
    console.log(`Draft already exists for ${slotInfo.date} ${slotInfo.slot}.`);
    return null;
  }

  const context = await loadContext();
  let draft = await generateDraftAttempt(context);
  let duplicate = await checkDuplicate(draft);

  if (duplicate.isDuplicate) {
    const secondDraft = await generateDraftAttempt(context, duplicate.matches);
    const secondDuplicate = await checkDuplicate(secondDraft);
    draft = {
      ...secondDraft,
      potential_duplicate: secondDuplicate.isDuplicate,
      duplicate_matches: secondDuplicate.matches
    };
  }

  const draftPath = `drafts/pending_review/${draft.id}.json`;
  draft.scheduled_date = slotInfo.date;
  draft.scheduled_slot = slotInfo.slot;
  draft.review_due_at_hkt = `${slotInfo.date} ${slotInfo.reviewTime}`;
  draft.publish_due_at_hkt = `${slotInfo.date} ${slotInfo.slot}`;
  await writeJson(draftPath, draft);

  const telegramResult = await sendDraftForReview(draft);
  draft.telegram_message_id = telegramResult?.message_id || null;
  await writeJson(draftPath, draft);

  console.log(`Generated draft ${draft.id} and sent it for Telegram review.`);
  return draft;
}

if (isMainModule(import.meta.url)) {
  generateDraft().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
