export const APPROVAL_TO_PUBLISH_SLOT = {
  "12": "15:00",
  "14": "17:00",
  "16": "19:00",
  "18": "21:00"
};

export const PUBLISH_HOUR_TO_SLOT = {
  "15": "15:00",
  "17": "17:00",
  "19": "19:00",
  "21": "21:00"
};

export const PUBLISH_SLOTS = ["15:00", "17:00", "19:00", "21:00"];

export const SCHEDULE_CRON_TO_ACTION = {
  "0 23 * * *": { mode: "approval", slot: "10:00" },
  "0,15,30,45 23 * * *": { mode: "approval", slot: "10:00" },
  "0 1 * * *": { mode: "approval", slot: "12:00" },
  "0,15,30,45 1 * * *": { mode: "approval", slot: "12:00" },
  "0 5 * * *": { mode: "approval", slot: "16:00" },
  "0,15,30,45 5 * * *": { mode: "approval", slot: "16:00" },
  "0 9 * * *": { mode: "approval", slot: "20:00" },
  "0,15,30,45 9 * * *": { mode: "approval", slot: "20:00" },
  "0 2 * * *": { mode: "publish", slot: "10:00" },
  "0,15,30,45 2 * * *": { mode: "publish", slot: "10:00" },
  "0 4 * * *": { mode: "publish", slot: "12:00" },
  "0,15,30,45 4 * * *": { mode: "publish", slot: "12:00" },
  "0 8 * * *": { mode: "publish", slot: "16:00" },
  "0,15,30,45 8 * * *": { mode: "publish", slot: "16:00" },
  "0 12 * * *": { mode: "publish", slot: "20:00" },
  "0,15,30,45 12 * * *": { mode: "publish", slot: "20:00" }
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
  const actions = [];

  if (APPROVAL_TO_PUBLISH_SLOT[current.hour]) {
    actions.push({
      mode: "approval",
      slot: APPROVAL_TO_PUBLISH_SLOT[current.hour]
    });
  }

  const currentMinutes = minutesSinceMidnight(current.time);
  for (const slot of PUBLISH_SLOTS) {
    if (minutesSinceMidnight(slot) <= currentMinutes) {
      actions.push({
        mode: "publish",
        slot,
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

  const current = getHongKongTimeParts();

  if (APPROVAL_TO_PUBLISH_SLOT[current.hour]) {
    return {
      mode: "approval",
      slot: APPROVAL_TO_PUBLISH_SLOT[current.hour]
    };
  }

  if (PUBLISH_HOUR_TO_SLOT[current.hour]) {
    return {
      mode: "publish",
      slot: PUBLISH_HOUR_TO_SLOT[current.hour]
    };
  }

  return {
    mode: "noop",
    slot: current.time
  };
}
