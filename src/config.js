import "dotenv/config";
import fs from "fs";

export const PORT = process.env.PORT || 3000;
export const SHEET_ID =
  process.env.GOOGLE_SHEETS_ID ||
  "1nsTwZfJ18PfChgQuAfGved79bJHxemT0vkS8M3AkDks";
export const CREDENTIALS_PATH =
  process.env.GOOGLE_SHEETS_CREDENTIALS || "credentials.json";
export const SHEETS = ["WTT-UP", "WTT-DOWN"];
export const CACHE_TTL_MS = 10 * 1000;

// Load HTTPS configuration from credentials.json
let HTTPS_CONFIG = null;
try {
  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf8"));
  if (credentials.https) {
    HTTPS_CONFIG = credentials.https;
  }
} catch (err) {
  console.warn("Could not load HTTPS config from credentials.json:", err.message);
}

export { HTTPS_CONFIG };
