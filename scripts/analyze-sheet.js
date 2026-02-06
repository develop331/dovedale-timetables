import { google } from "googleapis";
import fs from "fs/promises";

const SHEET_ID = "11W6pJxSS5b0G7Ce3l-JgLpZBqsC14p3hTXtgYuF6oxc";
const SHEETS = ["WTT-UP", "WTT-DOWN"];

const run = async () => {
  const raw = await fs.readFile("credentials.json", "utf8");
  const creds = JSON.parse(raw);
  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const sheets = google.sheets({ version: "v4", auth });

  for (const sheet of SHEETS) {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: sheet,
    });
    const values = res.data.values || [];
    const headers = values[0] || [];
    const rows = values.slice(1);
    console.log("\n" + sheet);
    console.log("Rows: " + rows.length + ", Cols: " + headers.length);
    console.log("Headers:", headers.join(" | "));
    const sample = rows.slice(0, 3);
    sample.forEach((row, i) => {
      console.log("Row " + (i + 1) + ":", row.join(" | "));
    });
    console.log("Row labels:");
    rows.forEach((row, index) => {
      const label = row[0] || "";
      console.log("  " + (index + 1) + ". " + label);
    });
  }
};

run().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
