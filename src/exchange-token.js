import { loadDotEnv } from "./load-env.js";

loadDotEnv();

const appId = process.env.THREADS_APP_ID;
const appSecret = process.env.THREADS_APP_SECRET;
const redirectUri = process.env.THREADS_REDIRECT_URI || "https://localhost/callback";
const code = process.env.THREADS_AUTH_CODE || process.argv[2];

function requireValue(name, value) {
  if (!value) {
    throw new Error(`${name} is required.`);
  }
}

async function exchangeCodeForShortToken() {
  const body = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri
  });

  const response = await fetch("https://graph.threads.net/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error?.message || `Short-lived token exchange failed: ${response.status}`);
  }

  return payload;
}

async function exchangeShortForLongToken(shortToken) {
  const url = new URL("https://graph.threads.net/access_token");
  url.searchParams.set("grant_type", "th_exchange_token");
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("access_token", shortToken);

  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error?.message || `Long-lived token exchange failed: ${response.status}`);
  }

  return payload;
}

async function main() {
  requireValue("THREADS_APP_ID", appId);
  requireValue("THREADS_APP_SECRET", appSecret);
  requireValue("THREADS_AUTH_CODE or first CLI argument", code);

  const shortToken = await exchangeCodeForShortToken();
  const longToken = await exchangeShortForLongToken(shortToken.access_token);

  console.log("Add this value to GitHub Secrets as THREADS_ACCESS_TOKEN:");
  console.log(longToken.access_token);
  console.log("");
  console.log("Token metadata:");
  console.log(JSON.stringify({
    token_type: longToken.token_type,
    expires_in: longToken.expires_in,
    user_id: shortToken.user_id
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
