const DEFAULT_TRENDS_RSS_URL = "https://trends.google.com/trending/rss?geo=HK";

function decodeXml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function matchTag(content, tagName) {
  const match = content.match(new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`));
  return match ? decodeXml(match[1].trim()) : "";
}

export async function fetchHongKongTrends({ limit = 10 } = {}) {
  const enabled = String(process.env.ENABLE_TRENDS_CONTEXT || "true").toLowerCase() !== "false";
  if (!enabled) {
    return [];
  }

  const url = process.env.GOOGLE_TRENDS_RSS_URL || DEFAULT_TRENDS_RSS_URL;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Google Trends RSS error: ${response.status}`);
  }

  const xml = await response.text();
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]
    .slice(0, limit)
    .map(([, item]) => ({
      title: matchTag(item, "title"),
      traffic: matchTag(item, "ht:approx_traffic"),
      pubDate: matchTag(item, "pubDate"),
      newsTitle: matchTag(item, "ht:news_item_title"),
      newsSource: matchTag(item, "ht:news_item_source")
    }))
    .filter((trend) => trend.title);
}
