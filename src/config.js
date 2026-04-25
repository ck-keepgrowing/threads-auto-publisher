export function getConfig() {
  const timeZone = process.env.TIME_ZONE || "Asia/Hong_Kong";
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  return {
    accessToken: process.env.THREADS_ACCESS_TOKEN,
    userId: process.env.THREADS_USER_ID || "me",
    apiVersion: process.env.THREADS_API_VERSION || "v1.0",
    dryRun: String(process.env.DRY_RUN || "false").toLowerCase() === "true",
    postDate: process.env.POST_DATE || formatter.format(new Date()),
    timeZone
  };
}

export function getRequiredConfig() {
  const config = getConfig();

  if (!config.dryRun && !config.accessToken) {
    throw new Error("THREADS_ACCESS_TOKEN is required when DRY_RUN is not true.");
  }

  return config;
}
