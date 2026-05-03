import { listDrafts } from "./utils.js";

export const COACH_SCHEDULE = [
  { slot: "10:00", reviewTime: "07:00" },
  { slot: "15:00", reviewTime: "12:00" },
  { slot: "21:00", reviewTime: "18:00" }
];

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

export function minutesSinceMidnight(time) {
  const [hour, minute] = String(time).split(":").map(Number);
  return hour * 60 + minute;
}

export function getSlotForReview(date = new Date()) {
  const current = getHongKongTimeParts(date);
  const currentMinutes = minutesSinceMidnight(current.time);
  return COACH_SCHEDULE.find((item) => {
    const reviewMinutes = minutesSinceMidnight(item.reviewTime);
    const publishMinutes = minutesSinceMidnight(item.slot);
    return reviewMinutes <= currentMinutes && currentMinutes < publishMinutes;
  }) || null;
}

export function isPublishDue(draft, date = new Date()) {
  if (!draft?.scheduled_date || !draft?.scheduled_slot) {
    return true;
  }
  const current = getHongKongTimeParts(date);
  if (draft.scheduled_date < current.date) {
    return true;
  }
  if (draft.scheduled_date > current.date) {
    return false;
  }
  return minutesSinceMidnight(current.time) >= minutesSinceMidnight(draft.scheduled_slot);
}

export async function hasDraftForSlot(date, slot) {
  const folders = ["pending_review", "approved", "rejected"];
  for (const folder of folders) {
    const drafts = await listDrafts(folder);
    if (drafts.some(({ draft }) => draft.scheduled_date === date && draft.scheduled_slot === slot)) {
      return true;
    }
  }
  const published = await listDrafts("../published");
  return published.some(({ draft }) => draft.scheduled_date === date && draft.scheduled_slot === slot);
}

export async function getPendingReviewDrafts() {
  return listDrafts("pending_review");
}
