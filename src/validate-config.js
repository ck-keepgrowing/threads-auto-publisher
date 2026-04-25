import { loadDotEnv } from "./load-env.js";
import { getRequiredConfig } from "./config.js";

loadDotEnv();

const config = getRequiredConfig();

console.log("Config OK");
console.log(`THREADS_USER_ID=${config.userId}`);
console.log(`THREADS_API_VERSION=${config.apiVersion}`);
console.log(`DRY_RUN=${config.dryRun}`);
console.log(`POST_DATE=${config.postDate}`);
console.log(`TIME_ZONE=${config.timeZone}`);
