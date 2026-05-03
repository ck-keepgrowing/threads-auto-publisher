import { checkDuplicate } from "./duplicateChecker.js";
import { callPrompt } from "./openrouter.js";
import { COACH_SCHEDULE, getHongKongTimeParts, getSlotForReview, hasDraftForSlot } from "./schedule.js";
import { sendDraftForReview } from "./telegram.js";
import { isMainModule, logError, makeDraftId, nowIso, readJson, writeJson } from "./utils.js";

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

function minPostLength() {
  return Number(process.env.COACH_MIN_POST_CHARS || "800");
}

function postLength(text) {
  return String(text || "").replace(/\s/g, "").length;
}

function fallbackTopics() {
  return {
    topics: [
      {
        topic: "好多保險新人唔係唔努力，而係每日都分唔清咩先係真正推動業績嘅事",
        category: "System thinking",
        core_pain_point: "每日好忙但無穩定成果，開始懷疑自己係咪唔適合做保險。",
        hidden_psychology: "用低風險的準備工作避開高壓但重要的銷售行動。",
        coaching_value: "教讀者分辨生產力活動同非生產力活動，重新安排每日工作重心。",
        why_reader_cares: "好多 agent 都有忙到攰但無單的痛感，呢個題目容易令佢哋覺得被理解。",
        freshness_score: 8,
        shareability_score: 8,
        practical_value_score: 9
      }
    ]
  };
}

function fallbackScored(topics) {
  const topic = topics.topics?.[0] || fallbackTopics().topics[0];
  return {
    selected_topics: [
      {
        topic: topic.topic,
        score: 8,
        reason: "具體指出保險 agent 忙但無成果的常見困局，適合教練式拆解。",
        suggested_angle: "由忙碌感切入，拆解逃避高壓銷售行動的心理，再給時間審計練習。",
        suggested_advice_type: "daily activity audit"
      }
    ]
  };
}

function fallbackAngle(selectedTopic) {
  return {
    topic: selectedTopic.topic,
    surface_problem: "每日 schedule 好滿，但月尾檢視時發現真正推進機會的行動很少。",
    hidden_pain: selectedTopic.core_pain_point || "努力很多但收入和機會不穩，內心開始自我懷疑。",
    why_it_happens: "人會自然避開容易被拒絕的行動，轉去做較安全、較似有進度的準備工作。",
    common_misunderstanding: "以為只要夠忙就等於夠勤力，卻沒有分辨行動是否真的推動業績。",
    coaching_reframe: "問題未必是你不夠努力，而是你的努力沒有被系統分配到最有產出的地方。",
    practical_advice: [
      "每日先完成一個直接推動機會的生產力活動，例如約見、跟進、轉介紹。",
      "把資料搜集、排版、內部討論設時限，避免變成拖延。",
      "每晚用五分鐘檢視今日有幾多時間真正放在客戶行動。"
    ],
    small_action_today: "今晚寫低今日所有工作，分成生產力活動同非生產力活動。",
    possible_hooks: [
      "好多保險新人最危險嘅唔係懶，而係忙錯方向。",
      "你以為自己好勤力，其實可能只係好擅長避開最重要嗰件事。",
      "如果你日日好忙但月月無單，問題可能唔係努力，而係分類錯。"
    ]
  };
}

function fallbackWriter(selectedTopic, angle) {
  const hook = angle.possible_hooks?.[0] || "好多保險新人最危險嘅唔係懶，而係忙錯方向。";
  return {
    hook,
    post: [
      hook,
      "",
      "你可能朝早一起身已經開始覆訊息、睇產品資料、整理 proposal、開會、聽 training。成日忙到連食飯都急，但去到夜晚一靜落嚟，又會有一種好空嘅感覺：今日到底有冇真正推前過任何一個機會？",
      "",
      "呢種辛苦最磨人，因為你唔係無做嘢。你甚至比身邊好多人更勤力。但如果每日大部分時間都放喺低風險、低拒絕感嘅工作，例如準備、整理、研究、諗 caption、改 proposal，個人會好容易有一種錯覺：我已經好努力，點解仲未有成果？",
      "",
      "問題可能唔係你唔夠搏，而係你無清楚分開「生產力活動」同「非生產力活動」。生產力活動係會直接推動客戶關係、約見、跟進、轉介紹、成交機會嘅行動。非生產力活動唔係無用，但如果佢哋霸佔晒你最清醒、最有能量嘅時間，你就會變成每日好忙，但真正影響收入嘅動作反而少。",
      "",
      "背後其實有人性。主動跟進會驚被拒絕，約人見面會驚尷尬，問轉介紹會驚被覺得功利。相比之下，準備工作安全好多。你可以覺得自己有進度，又暫時唔需要面對別人反應。所以大腦會自然拉你去做舒服啲嘅事，然後包裝成「我仲準備緊」。",
      "",
      "你可以試一個好簡單嘅練習：今晚攞張紙，寫低今日做過嘅所有工作。然後分兩欄，一欄係生產力活動，一欄係非生產力活動。唔需要怪自己，先誠實睇清楚比例。明日起身，先安排一個不能逃避嘅生產力活動，例如跟進三個人、約一個見面、問一個轉介紹。其他準備工作可以做，但要放喺後面同設時限。",
      "",
      "做保險唔係叫你每日逼自己硬衝，而係要建立一套方法，令你唔使每日靠情緒決定做唔做重要嘅事。你而家最需要嘅，可能唔係再忙啲，而係先分清楚：你今日嘅努力，有幾多真係會帶你行近下一張單？"
    ].join("\n"),
    core_pain_point: selectedTopic.core_pain_point || angle.hidden_pain,
    coaching_advice_summary: "用時間審計分清生產力活動同非生產力活動，先做真正推動客戶機會的行動。",
    estimated_reader_emotion: "被理解、放鬆少少，同時願意檢視自己每日行動。",
    save_share_reason: "讀者可以即日用兩欄時間審計改善工作安排。",
    labels: {
      hook_type: "pain diagnosis",
      content_type: "System thinking",
      target_reader: "保險新人及卡住的 agent",
      emotional_trigger: "忙但無成果的自我懷疑",
      practical_advice_type: "time audit"
    }
  };
}

function fallbackCritic() {
  return {
    score: 8,
    problems: [],
    must_fix: [],
    rewrite_direction: "",
    is_publishable_after_review: true
  };
}

async function callPromptWithFallback(options, fallbackValue) {
  try {
    return await callPrompt(options);
  } catch (error) {
    await logError(`fallback:${options.promptName}`, error);
    return typeof fallbackValue === "function" ? fallbackValue() : fallbackValue;
  }
}

async function generateDraftAttempt(context, previousDuplicate = null) {
  const topics = await callPromptWithFallback({
    promptName: "01_topic_generator",
    promptPath: "prompts/01_topic_generator.md",
    input: { ...context, previous_duplicate: previousDuplicate }
  }, fallbackTopics);

  const scored = await callPromptWithFallback({
    promptName: "02_topic_scorer",
    promptPath: "prompts/02_topic_scorer.md",
    input: { ...context, generated_topics: topics }
  }, () => fallbackScored(topics));

  const selectedTopic = scored.selected_topics?.[0] || topics.topics?.[0];
  if (!selectedTopic) {
    throw new Error("No topic was generated.");
  }

  const angle = await callPromptWithFallback({
    promptName: "03_angle_expander",
    promptPath: "prompts/03_angle_expander.md",
    input: { ...context, selected_topic: selectedTopic }
  }, () => fallbackAngle(selectedTopic));

  const writer = await callPromptWithFallback({
    promptName: "04_coach_writer",
    promptPath: "prompts/04_coach_writer.md",
    input: { ...context, selected_topic: selectedTopic, angle }
  }, () => fallbackWriter(selectedTopic, angle));

  const critic = await callPromptWithFallback({
    promptName: "05_critic",
    promptPath: "prompts/05_critic.md",
    input: { ...context, selected_topic: selectedTopic, angle, draft: writer }
  }, fallbackCritic);

  let finalHook = writer.hook;
  let finalPost = writer.post;
  let finalAdvice = writer.coaching_advice_summary;
  let rewrite = null;

  if (Number(critic.score || 0) < 8) {
    rewrite = await callPromptWithFallback({
      promptName: "06_rewriter",
      promptPath: "prompts/06_rewriter.md",
      input: { ...context, selected_topic: selectedTopic, angle, draft: writer, critic }
    }, null);
    if (rewrite) {
      finalHook = rewrite.final_hook || finalHook;
      finalPost = rewrite.final_post || finalPost;
      finalAdvice = rewrite.final_coaching_advice || finalAdvice;
    }
  }

  if (postLength(finalPost) < minPostLength()) {
    rewrite = await callPromptWithFallback({
      promptName: "06_rewriter_length_expansion",
      promptPath: "prompts/06_rewriter.md",
      input: {
        ...context,
        selected_topic: selectedTopic,
        angle,
        draft: {
          ...writer,
          hook: finalHook,
          post: finalPost,
          coaching_advice_summary: finalAdvice
        },
        critic,
        length_feedback: `The post is too short (${postLength(finalPost)} non-space characters). Expand it to at least ${minPostLength()} non-space Chinese characters while keeping it natural, practical, and complete.`
      }
    }, null);
    if (rewrite) {
      finalHook = rewrite.final_hook || finalHook;
      finalPost = rewrite.final_post || finalPost;
      finalAdvice = rewrite.final_coaching_advice || finalAdvice;
    }
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
      final_post_chars: postLength(finalPost),
      min_post_chars: minPostLength(),
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
