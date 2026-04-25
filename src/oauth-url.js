import { loadDotEnv } from "./load-env.js";

loadDotEnv();

const appId = process.env.THREADS_APP_ID;
const redirectUri = process.env.THREADS_REDIRECT_URI || "https://localhost/callback";
const scopes = ["threads_basic", "threads_content_publish"];

if (!appId) {
  console.error("THREADS_APP_ID is required. Add it to .env first.");
  process.exitCode = 1;
} else {
  const url = new URL("https://threads.net/oauth/authorize");
  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", scopes.join(","));
  url.searchParams.set("response_type", "code");

  console.log(url.toString());
}
