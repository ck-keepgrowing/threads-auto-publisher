import { readJson } from "./storage.js";
import { parseCsv } from "./csv.js";

const POSTS_PATH = "data/posts.json";

export async function loadPosts() {
  const source = process.env.CONTENT_SOURCE || "local";

  if (source === "local") {
    return readJson(POSTS_PATH, []);
  }

  if (source === "google_sheet_csv") {
    if (!process.env.GOOGLE_SHEET_CSV_URL) {
      throw new Error("GOOGLE_SHEET_CSV_URL is required when CONTENT_SOURCE=google_sheet_csv.");
    }

    const response = await fetch(process.env.GOOGLE_SHEET_CSV_URL);
    if (!response.ok) {
      throw new Error(`Could not fetch Google Sheet CSV: ${response.status} ${response.statusText}`);
    }

    const csv = await response.text();
    return parseCsv(csv);
  }

  throw new Error(`Unsupported CONTENT_SOURCE: ${source}`);
}
