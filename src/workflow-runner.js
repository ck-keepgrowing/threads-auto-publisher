import { loadDotEnv } from "./load-env.js";
import { resolveAutoWorkflowActions, resolveWorkflowAction } from "./slot.js";

loadDotEnv();

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
  const actions = resolveAutoWorkflowActions();
  for (const action of actions) {
    await runAction(action);
  }
} else {
  const action = resolveWorkflowAction({
    mode: process.env.ACTION_MODE,
    slot: process.env.TARGET_SLOT,
    scheduleCron: process.env.SCHEDULE_CRON
  });
  await runAction(action);
}
