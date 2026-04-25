import { loadDotEnv } from "./load-env.js";

loadDotEnv();

const botToken = process.env.TELEGRAM_BOT_TOKEN;

if (!botToken) {
  console.error("TELEGRAM_BOT_TOKEN is required in .env.");
  process.exitCode = 1;
} else {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates`);
  const payload = await response.json();

  if (!response.ok || payload.ok === false) {
    console.error(payload.description || `Telegram API error: ${response.status}`);
    process.exitCode = 1;
  } else {
    const chats = payload.result
      .map((update) => update.message?.chat)
      .filter(Boolean)
      .map((chat) => ({
        id: chat.id,
        type: chat.type,
        title: chat.title,
        username: chat.username,
        first_name: chat.first_name,
        last_name: chat.last_name
      }));

    if (chats.length === 0) {
      console.log("No chats found. Send /start to your bot in Telegram, then run this command again.");
    } else {
      console.log(JSON.stringify(chats, null, 2));
    }
  }
}
