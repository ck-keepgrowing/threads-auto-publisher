export const APPROVAL_TO_PUBLISH_SLOT = {
  "09": "12:00",
  "17": "20:00"
};

export const PUBLISH_HOUR_TO_SLOT = {
  "12": "12:00",
  "20": "20:00"
};

export const SCHEDULE_CRON_TO_ACTION = {
  "0 1 * * *": { mode: "approval", slot: "12:00" },
  "0,15,30,45 1 * * *": { mode: "approval", slot: "12:00" },
  "0 9 * * *": { mode: "approval", slot: "20:00" },
  "0,15,30,45 9 * * *": { mode: "approval", slot: "20:00" },
  "0 4 * * *": { mode: "publish", slot: "12:00" },
  "0,15,30,45 4 * * *": { mode: "publish", slot: "12:00" },
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
    time: `${values.hour}:${values.minute}`
  };
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
