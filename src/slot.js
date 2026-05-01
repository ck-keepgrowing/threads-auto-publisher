export const APPROVAL_TO_PUBLISH_SLOT = {
  "09": "11:00",
  "12": "14:00",
  "16": "18:00",
  "19": "21:00"
};

export const PUBLISH_HOUR_TO_SLOT = {
  "11": "11:00",
  "14": "14:00",
  "18": "18:00",
  "21": "21:00"
};

export const PUBLISH_SCHEDULE = [
  { slot: "11:00", approvalTime: "09:00" },
  { slot: "14:00", approvalTime: "12:00" },
  { slot: "18:00", approvalTime: "16:00" },
  { slot: "21:00", approvalTime: "19:00" }
];

export const PUBLISH_SLOTS = PUBLISH_SCHEDULE.map((item) => item.slot);

export const SCHEDULE_CRON_TO_ACTION = {
  "0 1 * * *": { mode: "approval", slot: "11:00" },
  "0,15,30,45 1 * * *": { mode: "approval", slot: "11:00" },
  "0 4 * * *": { mode: "approval", slot: "14:00" },
  "0,15,30,45 4 * * *": { mode: "approval", slot: "14:00" },
  "0 8 * * *": { mode: "approval", slot: "18:00" },
  "0,15,30,45 8 * * *": { mode: "approval", slot: "18:00" },
  "0 11 * * *": { mode: "approval", slot: "21:00" },
  "0,15,30,45 11 * * *": { mode: "approval", slot: "21:00" },
  "0 3 * * *": { mode: "publish", slot: "11:00" },
  "0,15,30,45 3 * * *": { mode: "publish", slot: "11:00" },
  "0 6 * * *": { mode: "publish", slot: "14:00" },
  "0,15,30,45 6 * * *": { mode: "publish", slot: "14:00" },
  "0 10 * * *": { mode: "publish", slot: "18:00" },
  "0,15,30,45 10 * * *": { mode: "publish", slot: "18:00" },
  "0 13 * * *": { mode: "publish", slot: "21:00" },
  "0,15,30,45 13 * * *": { mode: "publish", slot: "21:00" }
};

export function getHongKongTimeParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    hour: values.hour,
    minute: values.minute,
    time: `${values.hour}:${values.minute}`
  };
}

function minutesSinceMidnight(time) {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

export function resolveAutoWorkflowActions(date = new Date()) {
  const current = getHongKongTimeParts(date);
  const currentMinutes = minutesSinceMidnight(current.time);
  const actions = [];

  for (const item of PUBLISH_SCHEDULE) {
    const approvalMinutes = minutesSinceMidnight(item.approvalTime);
    const publishMinutes = minutesSinceMidnight(item.slot);

    if (approvalMinutes <= currentMinutes && currentMinutes < publishMinutes) {
      actions.push({
        mode: "approval",
        slot: item.slot
      });
    }

    if (publishMinutes <= currentMinutes) {
      actions.push({
        mode: "publish",
        slot: item.slot,
        recordPendingError: false
      });
    }
  }

  return actions.length > 0
    ? actions
    : [{ mode: "noop", slot: current.time }];
}

export function resolveWorkflowAction({ mode, slot, scheduleCron }) {
  if (mode && mode !== "auto") {
    return { mode, slot };
  }

  if (scheduleCron && SCHEDULE_CRON_TO_ACTION[scheduleCron]) {
    return SCHEDULE_CRON_TO_ACTION[scheduleCron];
  }

  return resolveAutoWorkflowActions()[0];
}
