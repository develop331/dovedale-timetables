import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

import { CACHE_TTL_MS, CREDENTIALS_PATH, SHEET_ID, SHEETS } from "./config.js";

let cache = { timestamp: 0, data: null };
let sheetsClient = null;
let googleApi = null;
let sheetIdCache = null;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

export async function getSheetsClient() {
  if (sheetsClient) {
    return sheetsClient;
  }

  if (!googleApi) {
    const module = await import("googleapis");
    googleApi = module.google;
  }

  const resolvedPath = path.isAbsolute(CREDENTIALS_PATH)
    ? CREDENTIALS_PATH
    : path.join(ROOT_DIR, CREDENTIALS_PATH);
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

export async function fetchSheetGrid(sheetName) {
  const sheets = await getSheetsClient();
  const response = await sheets.spreadsheets.get({
    spreadsheetId: SHEET_ID,
    ranges: [sheetName],
    includeGridData: true,
    fields: "sheets.properties.title,sheets.data.rowData.values(formattedValue,note,effectiveFormat.textFormat.strikethrough)",
  });
  return response.data.sheets || [];
}

export async function getSheetIdMap() {
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

function findDataStartIndex(rowData) {
  const validTypes = new Set(["arr", "dep", "plt", "pth", "lne"]);

  for (let rowIndex = 0; rowIndex < rowData.length; rowIndex += 1) {
    const values = rowData[rowIndex]?.values || [];
    const type = String(values[1]?.formattedValue || "").trim().toLowerCase();
    if (validTypes.has(type)) {
      return rowIndex;
    }
  }

  return 1;
}

function extractServiceMeta(rowData, headers, dataStartIndex) {
  const serviceMeta = headers.map(() => ({ source: "", train: "", from: "", direction: "", to: "", description: "" }));

  for (let rowIndex = 1; rowIndex < dataStartIndex && rowIndex < rowData.length; rowIndex += 1) {
    const row = rowData[rowIndex] || {};
    const values = row.values || [];
    const label = String(values[0]?.formattedValue || "").trim().toLowerCase();
    if (!label) {
      continue;
    }

    if (label === "up" || label === "down") {
      headers.forEach((_, columnIndex) => {
        if (columnIndex >= 2) {
          serviceMeta[columnIndex].direction = label.toUpperCase();
        }
      });
      continue;
    }

    const keyMap = {
      source: "source",
      train: "train",
      from: "from",
      to: "to",
      description: "description",
    };
    const key = keyMap[label];
    if (!key) {
      continue;
    }

    for (let columnIndex = 2; columnIndex < headers.length; columnIndex += 1) {
      const value = String(values[columnIndex]?.formattedValue || "").trim();
      if (value) {
        serviceMeta[columnIndex][key] = value;
      }
    }
  }

  return serviceMeta;
}

export function buildSheetLayout(sheets) {
  if (!sheets.length || !sheets[0].data || !sheets[0].data.length) {
    return { headers: [], headerNotes: [], rowLabels: [], rows: [], dataStartIndex: 0, serviceMeta: [] };
  }

  const rowData = sheets[0].data[0].rowData || [];
  if (rowData.length === 0) {
    return { headers: [], headerNotes: [], rowLabels: [], rows: [], dataStartIndex: 0, serviceMeta: [] };
  }

  const headerRow = rowData[0].values || [];
  const headers = headerRow.map((cell) => String(cell.formattedValue || "").trim());
  const headerNotes = headerRow.map((cell) => String(cell.note || "").trim());
  const maxCols = headers.length;
  const dataStartIndex = findDataStartIndex(rowData);
  const serviceMeta = extractServiceMeta(rowData, headers, dataStartIndex);

  const rows = rowData.slice(dataStartIndex).map((row) => {
    const cells = row.values || [];
    const rowCells = [];
    for (let i = 0; i < maxCols; i += 1) {
      const cell = cells[i] || {};
      const strikethrough = cell.effectiveFormat?.textFormat?.strikethrough || false;
      rowCells.push({
        value: String(cell.formattedValue || ""),
        note: String(cell.note || ""),
        strikethrough: strikethrough,
      });
    }
    return rowCells;
  });

  const rowLabels = rows.map((row) => String(row[0]?.value || "").trim());
  return { headers, headerNotes, rowLabels, rows, dataStartIndex, serviceMeta };
}

export async function loadData() {
  if (cache.data && Date.now() - cache.timestamp < CACHE_TTL_MS) {
    return cache.data;
  }

  try {
    await getSheetsClient();
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Unknown error";
    throw new Error(`Unable to read credentials.json: ${reason}`);
  }

  const sheetGrids = await Promise.all(SHEETS.map((sheet) => fetchSheetGrid(sheet)));
  const data = {};
  SHEETS.forEach((sheet, index) => {
    data[sheet] = buildSheetLayout(sheetGrids[index]);
  });

  cache = { timestamp: Date.now(), data };
  return data;
}

export function resetCache() {
  cache = { timestamp: 0, data: null };
}
