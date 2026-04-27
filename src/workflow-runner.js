import { loadDotEnv } from "./load-env.js";
import { resolveWorkflowAction } from "./slot.js";

loadDotEnv();

const action = resolveWorkflowAction({
  mode: process.env.ACTION_MODE,
  slot: process.env.TARGET_SLOT,
  scheduleCron: process.env.SCHEDULE_CRON
});

if (action.slot) {
  process.env.TARGET_SLOT = action.slot;
}

if (action.mode === "approval") {
  await import("./send-approval.js");
} else if (action.mode === "publish") {
  await import("./publish-approved.js");
} else {
  console.log(`No workflow action for current slot (${action.slot}).`);
}
