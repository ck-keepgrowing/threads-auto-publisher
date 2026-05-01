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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function publishTextPost({ apiVersion, userId, accessToken, text, replyToId }) {
  const createUrl = `${BASE_URL}/${apiVersion}/${userId}/threads`;
  const publishUrl = `${BASE_URL}/${apiVersion}/${userId}/threads_publish`;

  const createBody = {
    media_type: "TEXT",
    text,
    access_token: accessToken
  };

  if (replyToId) {
    createBody.reply_to_id = replyToId;
  }

  let creation;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      creation = await postForm(createUrl, createBody);
      break;
    } catch (error) {
      const canRetryReply = replyToId && /requested resource does not exist/i.test(error.message);
      if (!canRetryReply || attempt === 3) {
        throw error;
      }
      await sleep(5000 * attempt);
    }
  }

  const creationId = creation.id || creation.creation_id;
  if (!creationId) {
    throw new Error("Threads API did not return a creation id.");
  }

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await postForm(publishUrl, {
        creation_id: creationId,
        access_token: accessToken
      });
    } catch (error) {
      const canRetryReply = replyToId && /requested resource does not exist/i.test(error.message);
      if (!canRetryReply || attempt === 3) {
        throw error;
      }
      await sleep(5000 * attempt);
    }
  }
}
