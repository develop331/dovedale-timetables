import "dotenv/config";

export const PORT = process.env.PORT || 3000;
export const SHEET_ID =
  process.env.GOOGLE_SHEETS_ID ||
  "11W6pJxSS5b0G7Ce3l-JgLpZBqsC14p3hTXtgYuF6oxc";
export const CREDENTIALS_PATH =
  process.env.GOOGLE_SHEETS_CREDENTIALS || "credentials.json";
export const SHEETS = ["WTT-UP", "WTT-DOWN"];
export const CACHE_TTL_MS = 10 * 1000;
