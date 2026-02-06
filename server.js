import express from "express";
import dotenv from "dotenv";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();
console.log("Starting timetable server...");
app.use(express.json());
const PORT = process.env.PORT || 2000;
const SHEET_ID =
  process.env.GOOGLE_SHEETS_ID ||
  "11W6pJxSS5b0G7Ce3l-JgLpZBqsC14p3hTXtgYuF6oxc";
const CREDENTIALS_PATH = process.env.GOOGLE_SHEETS_CREDENTIALS || "credentials.json";
const SHEETS = ["WTT-UP", "WTT-DOWN"];
const CACHE_TTL_MS = 10 * 1000;
let cache = { timestamp: 0, data: null };
let sheetsClient = null;
let googleApi = null;
let sheetIdCache = null;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function normalizeHeadcode(value) {
  return String(value || "").trim().toUpperCase();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function parseTimeToMinutes(value) {
  const cleaned = String(value || "").replace(/H/gi, "");
  const match = cleaned.match(/(\d{1,2})\s*[.:\/]\s*(\d{2})/);
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return null;
  }
  return (hours % 24) * 60 + (minutes % 60);
}

function formatMinutesToTime(totalMinutes) {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, "0")}.${String(minutes).padStart(2, "0")}`;
}

function buildNoteFromActual(scheduled, actualInput, type) {
  const raw = String(actualInput || "").trim();
  if (!raw) {
    return { error: "Enter an actual value." };
  }

  if (type === "plt") {
    return { note: raw, delta: null };
  }

  if (/^ot$/i.test(raw) || /^on\s*time$/i.test(raw)) {
    return { note: "OT", delta: 0 };
  }

  const actualMinutes = parseTimeToMinutes(raw);
  if (actualMinutes === null) {
    return { error: "Actual time is not valid." };
  }

  const scheduledMinutes = parseTimeToMinutes(scheduled);
  if (scheduledMinutes === null) {
    return { error: "Scheduled time is not valid." };
  }

  const delta = actualMinutes - scheduledMinutes;
  if (delta === 0) {
    return { note: "OT", delta: 0 };
  }

  const actual = formatMinutesToTime(actualMinutes);
  const suffix = delta > 0 ? "L" : "E";
  return { note: `${actual}${suffix}`, delta };
}

function lerpColor(start, end, t) {
  return {
    red: start.red + (end.red - start.red) * t,
    green: start.green + (end.green - start.green) * t,
    blue: start.blue + (end.blue - start.blue) * t,
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getDelayStyle(deltaMinutes) {
  const blue = { red: 0.2, green: 0.45, blue: 0.95 };
  const green = { red: 0.2, green: 0.7, blue: 0.35 };
  const yellow = { red: 0.98, green: 0.85, blue: 0.25 };
  const orange = { red: 0.96, green: 0.55, blue: 0.2 };
  const red = { red: 0.9, green: 0.25, blue: 0.2 };
  const darkRed = { red: 0.55, green: 0.08, blue: 0.08 };

  if (deltaMinutes <= -5) {
    return { background: blue };
  }
  if (deltaMinutes < 0) {
    const t = clamp((deltaMinutes + 5) / 5, 0, 1);
    return { background: lerpColor(blue, green, t) };
  }
  if (deltaMinutes === 0) {
    return { background: green };
  }

  if (deltaMinutes <= 1) {
    const t = clamp(deltaMinutes / 1, 0, 1);
    return { background: lerpColor(green, yellow, t) };
  }
  if (deltaMinutes <= 4) {
    const t = clamp((deltaMinutes - 1) / 3, 0, 1);
    return { background: lerpColor(yellow, orange, t) };
  }
  if (deltaMinutes <= 7) {
    const t = clamp((deltaMinutes - 4) / 3, 0, 1);
    return { background: lerpColor(orange, red, t) };
  }
  if (deltaMinutes < 10) {
    const t = clamp((deltaMinutes - 7) / 3, 0, 1);
    return { background: lerpColor(red, darkRed, t) };
  }

  return { background: darkRed, text: { red: 1, green: 1, blue: 1 } };
}

async function getSheetsClient() {
  if (sheetsClient) {
    return sheetsClient;
  }

  if (!googleApi) {
    const module = await import("googleapis");
    googleApi = module.google;
  }

  const resolvedPath = path.isAbsolute(CREDENTIALS_PATH)
    ? CREDENTIALS_PATH
    : path.join(__dirname, CREDENTIALS_PATH);
  const raw = await fs.readFile(resolvedPath, "utf8");
  const creds = JSON.parse(raw);
  const auth = new googleApi.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  sheetsClient = googleApi.sheets({ version: "v4", auth });
  return sheetsClient;
}

async function fetchSheetGrid(sheetName) {
  const sheets = await getSheetsClient();
  const response = await sheets.spreadsheets.get({
    spreadsheetId: SHEET_ID,
    ranges: [sheetName],
    includeGridData: true,
    fields: "sheets.properties.title,sheets.data.rowData.values(formattedValue,note)",
  });
  return response.data.sheets || [];
}

async function getSheetIdMap() {
  if (sheetIdCache) {
    return sheetIdCache;
  }

  const sheets = await getSheetsClient();
  const response = await sheets.spreadsheets.get({
    spreadsheetId: SHEET_ID,
    fields: "sheets.properties(sheetId,title)",
  });

  const map = {};
  (response.data.sheets || []).forEach((sheet) => {
    const props = sheet.properties || {};
    if (props.title) {
      map[props.title] = props.sheetId;
    }
  });

  sheetIdCache = map;
  return map;
}

function buildSheetLayout(sheets) {
  if (!sheets.length || !sheets[0].data || !sheets[0].data.length) {
    return { headers: [], rowLabels: [], rows: [] };
  }

  const rowData = sheets[0].data[0].rowData || [];
  if (rowData.length === 0) {
    return { headers: [], rowLabels: [], rows: [] };
  }

  const headerRow = rowData[0].values || [];
  const headers = headerRow.map((cell) => String(cell.formattedValue || "").trim());
  const maxCols = headers.length;

  const rows = rowData.slice(1).map((row) => {
    const cells = row.values || [];
    const rowCells = [];
    for (let i = 0; i < maxCols; i += 1) {
      const cell = cells[i] || {};
      rowCells.push({
        value: String(cell.formattedValue || ""),
        note: String(cell.note || ""),
      });
    }
    return rowCells;
  });

  const rowLabels = rows.map((row) => String(row[0]?.value || "").trim());
  return { headers, rowLabels, rows };
}

function findHeadcodeColumn(headers, target) {
  return headers.findIndex((header) => normalizeHeadcode(header) === target);
}

async function loadData() {
  if (cache.data && Date.now() - cache.timestamp < CACHE_TTL_MS) {
    return cache.data;
  }

  try {
    await getSheetsClient();
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Unknown error";
    throw new Error(`Unable to read credentials.json: ${reason}`);
  }

  const data = {};
  for (const sheet of SHEETS) {
    const sheets = await fetchSheetGrid(sheet);
    const layout = buildSheetLayout(sheets);
    data[sheet] = layout;
  }

  cache = { timestamp: Date.now(), data };
  return data;
}

function buildTimingPointsForColumn(info, columnIndex) {
  const points = [];
  let current = null;

  info.rows.forEach((row, idx) => {
    const location = String(info.rowLabels[idx] || "").trim();
    const type = String(row[1]?.value || "").trim().toLowerCase();
    const cell = row[columnIndex] || { value: "", note: "" };
    const value = cell.value ?? "";
    const sheetRowIndex = idx + 1;

    if (location) {
      current = {
        location,
        arrival: "",
        departure: "",
        platform: "",
        arrivalNote: "",
        departureNote: "",
        platformNote: "",
        arrivalRow: null,
        departureRow: null,
        platformRow: null,
      };
      points.push(current);
    }

    if (!current || String(value).trim() === "") {
      return;
    }

    if (type === "arr") {
      current.arrival = value;
      current.arrivalNote = cell.note || "";
      current.arrivalRow = sheetRowIndex;
    } else if (type === "dep") {
      current.departure = value;
      current.departureNote = cell.note || "";
      current.departureRow = sheetRowIndex;
    } else if (type === "plt") {
      current.platform = value;
      current.platformNote = cell.note || "";
      current.platformRow = sheetRowIndex;
    }
  });

  return points.filter(
    (point) =>
      String(point.arrival).trim() !== "" ||
      String(point.departure).trim() !== "" ||
      String(point.platform).trim() !== ""
  );
}

function filterByHeadcode(data, headcode) {
  const target = normalizeHeadcode(headcode);
  if (!target) {
    return [];
  }

  const matches = [];
  for (const [sheet, info] of Object.entries(data)) {
    const columnIndex = findHeadcodeColumn(info.headers, target);
    if (columnIndex < 0) {
      continue;
    }

    const points = buildTimingPointsForColumn(info, columnIndex);
    matches.push({ sheet, points, columnIndex });
  }

  return matches;
}

function renderCellDisplay(scheduledValue, noteValue) {
  const scheduled = String(scheduledValue || "").trim();
  const note = String(noteValue || "").trim();
  if (!note) {
    return `<strong>${escapeHtml(scheduled)}</strong>`;
  }
  if (!scheduled || note === scheduled) {
    return escapeHtml(note);
  }
  return `${escapeHtml(note)} <span class="muted">(${escapeHtml(scheduled)})</span>`;
}

function renderEditableCell(value, note, sheet, rowIndex, columnIndex, type) {
  const display = renderCellDisplay(value, note);
  const safeValue = escapeHtml(value);
  const safeNote = escapeHtml(note);
  if (rowIndex === null || rowIndex === undefined) {
    return `<td>${display}</td>`;
  }
  return `<td class="editable" data-sheet="${escapeHtml(sheet)}" data-row="${rowIndex}" data-col="${columnIndex}" data-type="${type}" data-value="${safeValue}" data-note="${safeNote}">${display}</td>`;
}

function renderRecord(sheet, columnIndex, points) {
  const rows = points
    .map(
      ({
        location,
        platform,
        arrival,
        departure,
        platformNote,
        arrivalNote,
        departureNote,
        platformRow,
        arrivalRow,
        departureRow,
      }) =>
        `<tr>
          <th>${escapeHtml(location)}</th>
          ${renderEditableCell(platform, platformNote, sheet, platformRow, columnIndex, "plt")}
          ${renderEditableCell(arrival, arrivalNote, sheet, arrivalRow, columnIndex, "arr")}
          ${renderEditableCell(departure, departureNote, sheet, departureRow, columnIndex, "dep")}
        </tr>`
    )
    .join("");

  return `
    <table>
      <thead>
        <tr>
          <th>Location</th>
          <th>Platform</th>
          <th>Arrival time</th>
          <th>Departure time</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderPage({ headcode, results, error }) {
  const resultHtml = error
    ? `<div class="alert">${escapeHtml(error)}</div>`
    : results.length
      ? results
          .map(
            (result) =>
                `<section><h2>${escapeHtml(result.sheet)}</h2>${renderRecord(result.sheet, result.columnIndex, result.points)}</section>`
          )
          .join("")
      : headcode
        ? "<p class=\"empty\">No matching headcode found.</p>"
        : "<p class=\"empty\">Enter a headcode to see the timetable.</p>";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Timetable Lookup</title>
    <style>
      :root {
        color-scheme: light;
        font-family: "Helvetica Neue", Arial, sans-serif;
        background: #f5f4f0;
        color: #1c1c1c;
      }
      body {
        margin: 0;
        padding: 32px 20px 60px;
        background: linear-gradient(140deg, #fdf6e3, #f5f4f0 45%, #eef1e8);
      }
      main {
        max-width: 880px;
        margin: 0 auto;
      }
      h1 {
        font-size: 2.3rem;
        margin: 0 0 6px;
      }
      p {
        margin: 0 0 18px;
        color: #454138;
      }
      form {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
        margin-bottom: 28px;
      }
      input[type="text"] {
        flex: 1 1 220px;
        padding: 12px 14px;
        font-size: 1rem;
        border-radius: 12px;
        border: 1px solid #c5bfae;
        background: #fffefb;
      }
      button {
        padding: 12px 18px;
        border-radius: 12px;
        border: none;
        background: #5b6f3b;
        color: white;
        font-size: 1rem;
        cursor: pointer;
      }
      button:hover {
        background: #4c5d33;
      }
      section {
        background: white;
        border-radius: 16px;
        padding: 18px 20px;
        margin-bottom: 18px;
        box-shadow: 0 10px 20px rgba(50, 45, 30, 0.08);
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      th,
      td {
        text-align: left;
        padding: 8px 6px;
        border-bottom: 1px solid #efe9d7;
        vertical-align: top;
      }
      thead th:not(:first-child),
      tbody td:not(:first-child) {
        width: 16%;
      }
      th {
        width: 30%;
        color: #5b5548;
      }
      .editable {
        cursor: pointer;
      }
      .editable:hover {
        background: #f7f2e3;
      }
      .muted {
        color: #8a8272;
        font-weight: 500;
      }
      .alert {
        background: #f7d7d0;
        padding: 12px 16px;
        border-radius: 10px;
        color: #4a1f18;
      }
      .empty {
        color: #6a655a;
        font-style: italic;
      }
      .modal {
        position: fixed;
        inset: 0;
        background: rgba(20, 18, 12, 0.45);
        display: none;
        align-items: center;
        justify-content: center;
        padding: 20px;
      }
      .modal.open {
        display: flex;
      }
      .modal-card {
        background: white;
        border-radius: 16px;
        padding: 20px;
        width: min(420px, 100%);
        box-shadow: 0 20px 40px rgba(50, 45, 30, 0.18);
      }
      .modal-card h3 {
        margin: 0 0 8px;
        font-size: 1.2rem;
      }
      .modal-card label {
        display: block;
        margin-top: 12px;
        font-weight: 600;
      }
      .modal-card input {
        width: 100%;
        margin-top: 6px;
        padding: 10px 12px;
        font-size: 1rem;
        border-radius: 10px;
        border: 1px solid #c5bfae;
        background: #fffefb;
      }
      .modal-actions {
        display: flex;
        gap: 10px;
        margin-top: 16px;
      }
      .modal-actions button {
        flex: 1;
      }
      .status {
        margin-top: 10px;
        font-size: 0.95rem;
        color: #5b5548;
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <h1>Timetable Lookup</h1>
        <p>Search for a headcode across WTT-UP and WTT-DOWN.</p>
        <p class="legend">Click a platform/arrival/departure cell to add an actual time (or OT) or actual platform.</p>
      </header>
      <form method="get" action="/">
        <input
          name="headcode"
          type="text"
          placeholder="Enter headcode"
          value="${escapeHtml(headcode || "")}" />
        <button type="submit">Search</button>
      </form>
      ${resultHtml}
    </main>
    <div id="note-modal" class="modal" aria-hidden="true">
      <div class="modal-card" role="dialog" aria-modal="true">
        <h3>Add delay note</h3>
        <div id="note-meta"></div>
        <form id="note-form">
          <label for="delay-input" id="note-label">Actual time or OT</label>
          <input id="delay-input" type="text" placeholder="e.g. 20.07, OT" />
          <div class="modal-actions">
            <button type="submit">Save</button>
            <button type="button" id="note-cancel">Cancel</button>
          </div>
          <div id="note-status" class="status"></div>
        </form>
      </div>
    </div>
    <script>
      const params = new URLSearchParams(window.location.search);
      if (params.get("headcode")) {
        setInterval(() => {
          window.location.reload();
        }, 10000);
      }
      const modal = document.getElementById("note-modal");
      const form = document.getElementById("note-form");
      const input = document.getElementById("delay-input");
      const meta = document.getElementById("note-meta");
      const status = document.getElementById("note-status");
      const cancel = document.getElementById("note-cancel");
      let activeCell = null;

      const closeModal = () => {
        modal.classList.remove("open");
        modal.setAttribute("aria-hidden", "true");
        status.textContent = "";
        activeCell = null;
      };

      document.addEventListener("click", (event) => {
        const cell = event.target.closest(".editable");
        if (!cell) {
          return;
        }
        activeCell = cell;
        const location = cell.parentElement.querySelector("th")?.textContent || "";
        const scheduled = cell.dataset.value || "";
        const note = cell.dataset.note || "";
        const parts = [];
        if (scheduled) {
          parts.push("scheduled " + scheduled);
        }
        if (note) {
          parts.push("note " + note);
        }
        const details = parts.length ? " (" + parts.join(", ") + ")" : "";
        meta.textContent = location ? location + details : details;
        const type = cell.dataset.type || "";
        const label = document.getElementById("note-label");
        if (type === "plt") {
          label.textContent = "Actual platform";
          input.placeholder = "e.g. 1";
        } else {
          label.textContent = "Actual time or OT";
          input.placeholder = "e.g. 20.07, OT";
        }
        input.value = "";
        modal.classList.add("open");
        modal.setAttribute("aria-hidden", "false");
        input.focus();
      });

      cancel.addEventListener("click", () => {
        closeModal();
      });

      modal.addEventListener("click", (event) => {
        if (event.target === modal) {
          closeModal();
        }
      });

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!activeCell) {
          return;
        }
        status.textContent = "Saving...";
        const payload = {
          sheet: activeCell.dataset.sheet,
          rowIndex: Number(activeCell.dataset.row),
          columnIndex: Number(activeCell.dataset.col),
          scheduled: activeCell.dataset.value || "",
          actual: input.value,
          type: activeCell.dataset.type || "",
        };

        try {
          const response = await fetch("/note", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          const data = await response.json();
          if (!response.ok) {
            status.textContent = data.error || "Failed to save note.";
            return;
          }
          status.textContent = "Saved note: " + data.note;
          setTimeout(() => {
            closeModal();
            window.location.reload();
          }, 400);
        } catch (err) {
          status.textContent = "Failed to save note.";
        }
      });
    </script>
  </body>
</html>`;
}

app.post("/note", async (req, res) => {
  const { sheet, rowIndex, columnIndex, scheduled, actual, type } = req.body || {};
  const row = Number(rowIndex);
  const col = Number(columnIndex);

  console.log("/note request", { sheet, row, col, scheduled, actual, type });

  if (!sheet || Number.isNaN(row) || Number.isNaN(col)) {
    res.status(400).json({ error: "Missing or invalid cell reference." });
    return;
  }

  const noteResult = buildNoteFromActual(scheduled, actual, type);
  if (noteResult.error) {
    res.status(400).json({ error: noteResult.error });
    return;
  }

  try {
    const map = await getSheetIdMap();
    const sheetId = map[sheet];
    if (sheetId === undefined) {
      res.status(400).json({ error: "Unknown sheet name." });
      return;
    }

    const sheets = await getSheetsClient();
    const shouldColor = typeof noteResult.delta === "number";
    const style = shouldColor ? getDelayStyle(noteResult.delta) : null;
    const cellValue = {
      note: noteResult.note,
    };
    if (shouldColor && style) {
      const format = { backgroundColor: style.background };
      if (style.text) {
        format.textFormat = { foregroundColor: style.text };
      }
      cellValue.userEnteredFormat = format;
    }
    const fields = shouldColor
      ? "note,userEnteredFormat.backgroundColor,userEnteredFormat.textFormat.foregroundColor"
      : "note";
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        requests: [
          {
            updateCells: {
              range: {
                sheetId,
                startRowIndex: row,
                endRowIndex: row + 1,
                startColumnIndex: col,
                endColumnIndex: col + 1,
              },
              rows: [
                {
                  values: [
                    cellValue,
                  ],
                },
              ],
              fields,
            },
          },
        ],
      },
    });

    res.json({ note: noteResult.note });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    const details = err && typeof err === "object" ? err : null;
    console.error("/note error", details);
    res.status(500).json({ error: message });
  }
});

app.get("/", async (req, res) => {
  const headcode = typeof req.query.headcode === "string" ? req.query.headcode : "";
  let results = [];
  let error = "";

  if (headcode) {
    try {
      const data = await loadData();
      results = filterByHeadcode(data, headcode);
    } catch (err) {
      error = err instanceof Error ? err.message : "Unexpected error";
    }
  }

  res.type("html").send(renderPage({ headcode, results, error }));
});

app.listen(PORT, () => {
  console.log(`Timetable app running on http://localhost:${PORT}`);
}).on("error", (err) => {
  console.error("Server failed to start:", err.message);
});
