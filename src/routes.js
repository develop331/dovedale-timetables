import { SHEET_ID } from "./config.js";
import { buildLineups } from "./lineups.js";
import { renderDutyPage, renderLineupPage, renderLineupsIndex, renderPage } from "./render.js";
import { getSheetIdMap, getSheetsClient, loadData, resetCache } from "./sheets.js";
import { filterByDuty, filterByHeadcode } from "./timetable.js";
import { buildNoteFromActual, getDelayStyle } from "./utils.js";

export function registerRoutes(app) {
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

      resetCache();

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

  app.get("/lineups", async (_req, res) => {
    try {
      const data = await loadData();
      const lineups = buildLineups(data);
      res.type("html").send(renderLineupsIndex({ locations: lineups.locations, error: "" }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected error";
      res.type("html").send(renderLineupsIndex({ locations: [], error: message }));
    }
  });

  app.get("/lineups/:location", async (req, res) => {
    const location = typeof req.params.location === "string" ? req.params.location : "";
    const considerDelays = req.query.consider !== "no-delays";

    try {
      const data = await loadData();
      const lineups = buildLineups(data, considerDelays);
      if (!lineups.locations.includes(location)) {
        res
          .status(404)
          .type("html")
          .send(
            renderLineupPage({
              location: "",
              combined: {},
              considerDelays,
              error: "Timing point not found.",
            })
          );
        return;
      }
      res
        .type("html")
        .send(renderLineupPage({ location, combined: lineups.combined, considerDelays, error: "" }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected error";
      res
        .type("html")
        .send(renderLineupPage({ location, combined: {}, considerDelays, error: message }));
    }
  });

  app.get("/duties", async (req, res) => {
    const duty = typeof req.query.duty === "string" ? req.query.duty : "";
    let results = [];
    let error = "";

    if (duty) {
      try {
        const data = await loadData();
        results = filterByDuty(data, duty);
      } catch (err) {
        error = err instanceof Error ? err.message : "Unexpected error";
      }
    }

    res.type("html").send(renderDutyPage({ duty, results, error }));
  });

  app.get("/duties/:duty", async (req, res) => {
    const duty = typeof req.params.duty === "string" ? req.params.duty : "";

    try {
      const data = await loadData();
      const results = filterByDuty(data, duty);
      res.type("html").send(renderDutyPage({ duty, results, error: "" }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected error";
      res.type("html").send(renderDutyPage({ duty, results: [], error: message }));
    }
  });
}
