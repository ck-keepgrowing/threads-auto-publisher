import { loadDotEnv } from "./load-env.js";
import { getConfig } from "./config.js";
import { generateDraftPost, upsertPost } from "./editor-generator.js";
import { loadPosts } from "./posts-source.js";
import { recordError } from "./post-utils.js";
import { PUBLISH_SLOTS, resolveAutoWorkflowActions, resolveWorkflowAction } from "./slot.js";

loadDotEnv();

async function ensureTodayPostsForSlots() {
  if ((process.env.CONTENT_SOURCE || "local") !== "local") {
    return;
  }

  const config = getConfig();
  const posts = await loadPosts();
  const { readJson } = await import("./storage.js");
  const published = await readJson("data/published.json", []);
  const existingSlots = new Set(
    [
      ...posts.filter((post) => post.date === config.postDate),
      ...published.filter((post) => post.date === config.postDate)
    ].map((post) => post.slot)
  );

  for (const slot of PUBLISH_SLOTS) {
    if (existingSlots.has(slot)) {
      continue;
    }
    const post = await generateDraftPost({
      date: config.postDate,
      slot
    });
    await upsertPost({
      ...post,
      autoPublish: String(process.env.AUTO_PUBLISH_DRAFTS || "false").toLowerCase() === "true"
    });
    console.log(`Generated draft ${post.id}.`);
  }
}

async function runAction(action) {
  if (action.slot) {
    process.env.TARGET_SLOT = action.slot;
  }

  if (action.mode === "approval") {
    const { sendApprovalForSlot } = await import("./send-approval.js");
    await sendApprovalForSlot({ slot: action.slot });
  } else if (action.mode === "publish") {
    const { publishApprovedForSlot } = await import("./publish-approved.js");
    await publishApprovedForSlot({
      slot: action.slot,
      recordPendingError: action.recordPendingError
    });
  } else {
    console.log(`No workflow action for current slot (${action.slot}).`);
  }
}

if (!process.env.ACTION_MODE || process.env.ACTION_MODE === "auto") {
  await ensureTodayPostsForSlots();

  for (const action of resolveAutoWorkflowActions()) {
    try {
      await runAction(action);
    } catch (error) {
      await recordError({
        id: `${getConfig().postDate}-${action.slot.replace(":", "")}`,
        date: getConfig().postDate,
        slot: action.slot,
        message: `${action.mode} action failed: ${error.message}`
      });
      console.error(`${action.mode} action failed for ${action.slot}: ${error.message}`);
    }
  }
} else {
  const action = resolveWorkflowAction({
    mode: process.env.ACTION_MODE,
    slot: process.env.TARGET_SLOT,
    scheduleCron: process.env.SCHEDULE_CRON
  });
  await runAction(action);
}
