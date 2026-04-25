const BASE_URL = "https://graph.threads.net";

async function postForm(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams(body)
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = payload.error?.message || response.statusText;
    throw new Error(`Threads API error ${response.status}: ${message}`);
  }

  return payload;
}

export async function publishTextPost({ apiVersion, userId, accessToken, text }) {
  const createUrl = `${BASE_URL}/${apiVersion}/${userId}/threads`;
  const publishUrl = `${BASE_URL}/${apiVersion}/${userId}/threads_publish`;

  const creation = await postForm(createUrl, {
    media_type: "TEXT",
    text,
    access_token: accessToken
  });

  const creationId = creation.id || creation.creation_id;
  if (!creationId) {
    throw new Error("Threads API did not return a creation id.");
  }

  return postForm(publishUrl, {
    creation_id: creationId,
    access_token: accessToken
  });
}
