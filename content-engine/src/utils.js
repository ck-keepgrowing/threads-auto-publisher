import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ENGINE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function isMainModule(importMetaUrl) {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(importMetaUrl);
}

export function resolveEnginePath(...parts) {
  return path.join(ENGINE_ROOT, ...parts);
}

export async function readText(relativePath) {
  return fs.readFile(resolveEnginePath(relativePath), "utf8");
}

export async function writeText(relativePath, value) {
  const fullPath = resolveEnginePath(relativePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, value, "utf8");
}

export async function readJson(relativePath, fallback) {
  try {
    const text = await readText(relativePath);
    return JSON.parse(text);
  } catch (error) {
    if (error.code === "ENOENT" && fallback !== undefined) {
      return fallback;
    }
    throw error;
  }
}

export async function writeJson(relativePath, value) {
  await writeText(relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function appendJsonArray(relativePath, item) {
  const current = await readJson(relativePath, []);
  current.push(item);
  await writeJson(relativePath, current);
  return current;
}

export async function fileExists(relativePath) {
  try {
    await fs.access(resolveEnginePath(relativePath));
    return true;
  } catch {
    return false;
  }
}

export async function moveFile(fromRelativePath, toRelativePath) {
  const from = resolveEnginePath(fromRelativePath);
  const to = resolveEnginePath(toRelativePath);
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.rename(from, to);
}

export function nowIso() {
  return new Date().toISOString();
}

export function todayHongKong() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function makeDraftId(topic = "draft") {
  const date = todayHongKong();
  const slug = String(topic)
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36)
    .toLowerCase() || "draft";
  const random = Math.random().toString(36).slice(2, 8);
  return `${date}-${slug}-${random}`;
}

export function summarize(value, maxLength = 500) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

export function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function keywordSet(value) {
  return new Set(
    normalizeText(value)
      .split(" ")
      .filter((word) => word.length >= 2)
  );
}

export function overlapScore(left, right) {
  const a = keywordSet(left);
  const b = keywordSet(right);
  if (a.size === 0 || b.size === 0) {
    return 0;
  }
  let shared = 0;
  for (const word of a) {
    if (b.has(word)) {
      shared += 1;
    }
  }
  return shared / Math.min(a.size, b.size);
}

export async function findDraftPath(draftId, folders = ["pending_review", "approved", "rejected"]) {
  for (const folder of folders) {
    const relativePath = `drafts/${folder}/${draftId}.json`;
    if (await fileExists(relativePath)) {
      return relativePath;
    }
  }
  return null;
}

export async function listDrafts(folder = "pending_review") {
  const dir = resolveEnginePath("drafts", folder);
  let entries = [];
  try {
    entries = await fs.readdir(dir);
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const drafts = [];
  for (const entry of entries.filter((name) => name.endsWith(".json"))) {
    const relativePath = `drafts/${folder}/${entry}`;
    drafts.push({
      path: relativePath,
      draft: await readJson(relativePath)
    });
  }
  return drafts;
}

export async function logError(context, error, extra = {}) {
  await appendJsonArray("logs/errors.json", {
    timestamp: nowIso(),
    context,
    message: error?.message || String(error),
    stack: error?.stack,
    ...extra
  });
}

export function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function stripCodeFence(text) {
  return String(text || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}
