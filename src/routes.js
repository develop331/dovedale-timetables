import { SHEET_ID } from "./config.js";
import { buildLineups, buildDelayHistory } from "./lineups.js";
import { renderLineupPage, renderLineupsIndex, renderPage } from "./render.js";
import { getSheetIdMap, getSheetsClient, loadData, resetCache } from "./sheets.js";
import { filterByHeadcode } from "./timetable.js";
import { buildNoteFromActual, getDelayStyle, escapeHtml, normalizeHeadcode } from "./utils.js";

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

  app.get("/debug/chains", async (req, res) => {
    try {
      const data = await loadData();
      const chains = {};
      
      // Build delay history/chains for each sheet
      for (const [sheet, info] of Object.entries(data)) {
        chains[sheet] = buildDelayHistory(info);
        console.log(`[DEBUG] Sheet ${sheet}: Found ${Object.keys(chains[sheet].headcodeChain).length} chain entries`);
      }

      // Build HTML response
      let html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Debug - Train Chains</title>
    <style>
      :root {
        color-scheme: light;
        font-family: "Helvetica Neue", Arial, sans-serif;
        background: #f5f4f0;
        color: #1c1c1c;
      }
      body {
        margin: 0;
        padding: 32px 20px;
        background: linear-gradient(140deg, #fdf6e3, #f5f4f0 45%, #eef1e8);
      }
      main {
        max-width: 1000px;
        margin: 0 auto;
      }
      h1 {
        font-size: 2rem;
        margin: 0 0 6px;
      }
      h2 {
        font-size: 1.4rem;
        margin: 24px 0 12px;
        border-bottom: 2px solid #5b6f3b;
        padding-bottom: 8px;
      }
      h3 {
        font-size: 1.1rem;
        margin: 16px 0 8px;
        color: #5b6f3b;
      }
      .chain-item {
        background: white;
        border-radius: 8px;
        padding: 12px;
        margin-bottom: 8px;
        border-left: 4px solid #5b6f3b;
        font-family: monospace;
      }
      .headcode {
        font-weight: bold;
        color: #355930;
      }
      .location {
        color: #666;
        font-size: 0.9em;
      }
      .arrow {
        margin: 0 8px;
        color: #999;
      }
      .delay-info {
        color: #c55;
        font-weight: bold;
      }
      .no-chains {
        padding: 12px;
        background: #f9f9f9;
        border-radius: 8px;
        color: #999;
      }
      a {
        color: #355930;
        text-decoration: none;
      }
      a:hover {
        text-decoration: underline;
      }
      .back-link {
        display: inline-block;
        margin-bottom: 20px;
        padding: 8px 12px;
        background: #e8e3d4;
        border-radius: 6px;
      }
    </style>
  </head>
  <body>
    <main>
      <div style="display: flex; gap: 14px; margin-bottom: 18px; flex-wrap: wrap;">
        <a href="/" style="padding: 6px 12px; border-radius: 999px; background: #ece6d8; color: #4b4435; font-weight: 600; text-decoration: none;">Lookup</a>
        <a href="/lineups" style="padding: 6px 12px; border-radius: 999px; background: #ece6d8; color: #4b4435; font-weight: 600; text-decoration: none;">Lineups</a>
        <a href="/debug/chains" style="padding: 6px 12px; border-radius: 999px; background: #5b6f3b; color: white; font-weight: 600; text-decoration: none;">Chains</a>
      </div>
      <h1>Debug: Train Service Chains</h1>
      <p>Shows how services are linked together via the "Next" rows.</p>`;

      // Process each sheet
      for (const [sheet, chainData] of Object.entries(chains)) {
        html += `<h2>Sheet: ${escapeHtml(sheet)}</h2>`;
        
        // Debug: Show row types found
        const sheetInfo = data[sheet];
        if (sheetInfo) {
          const rowTypes = new Set();
          sheetInfo.rows.forEach((row) => {
            const type = String(row[1]?.value || "").trim().toLowerCase();
            if (type) rowTypes.add(type);
          });
          html += `<div style="background: #f0f0f0; padding: 8px; margin-bottom: 12px; border-radius: 4px; font-size: 0.85em;">
            <strong>Row types found:</strong> ${Array.from(rowTypes).map(t => escapeHtml(t)).join(', ') || 'none'}
          </div>`;
        }
        
        if (Object.keys(chainData.headcodeChain).length === 0) {
          html += `<div class="no-chains">No service chains found. Make sure you have rows with "Next" in column A (the location column).</div>`;
          continue;
        }

        // Build chain display
        for (const [headcode, transitions] of Object.entries(chainData.headcodeChain)) {
          if (transitions.length === 0) continue;
          
          html += `<h3>Service <span class="headcode">${escapeHtml(headcode)}</span></h3>`;
          
          for (const { location, nextHeadcode } of transitions) {
            const delay = chainData.history[headcode]?.[location];
            const delayDisplay = delay !== undefined && delay !== 0 
              ? ` <span class="delay-info">[${delay > 0 ? '+' : ''}${delay} min]</span>`
              : '';
            
            html += `<div class="chain-item">
              <span class="location">${escapeHtml(location)}:</span>
              <span class="headcode">${escapeHtml(headcode)}</span>
              <span class="arrow">→</span>
              <span class="headcode">${escapeHtml(nextHeadcode)}</span>
              ${delayDisplay}
            </div>`;
          }
        }

        // Display delay history
        if (Object.keys(chainData.history).length > 0) {
          html += `<h3>Recorded Delays</h3>`;
          for (const [headcode, locations] of Object.entries(chainData.history)) {
            for (const [location, delay] of Object.entries(locations)) {
              const sign = delay > 0 ? '+ ' : '';
              html += `<div class="chain-item">
                <span class="headcode">${escapeHtml(headcode)}</span>
                at <span class="location">${escapeHtml(location)}</span>:
                <span class="delay-info">${sign}${delay} minute${Math.abs(delay) === 1 ? '' : 's'}</span>
              </div>`;
            }
          }
        }
      }

      html += `
    </main>
  </body>
</html>`;

      res.type("html").send(html);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected error";
      res.type("html").send(`
        <!doctype html>
        <html>
          <head><title>Debug Error</title></head>
          <body>
            <h1>Debug Error</h1>
            <p>${escapeHtml(message)}</p>
            <a href="/">Back</a>
          </body>
        </html>
      `);
    }
  });

  app.get("/debug/chains/:headcode", async (req, res) => {
    const targetHeadcode = normalizeHeadcode(req.params.headcode);
    
    try {
      const data = await loadData();
      const chains = {};
      
      for (const [sheet, info] of Object.entries(data)) {
        chains[sheet] = buildDelayHistory(info);
      }

      // Build chain for specific headcode
      let html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Debug - Chain for ${escapeHtml(targetHeadcode)}</title>
    <style>
      :root {
        color-scheme: light;
        font-family: "Helvetica Neue", Arial, sans-serif;
        background: #f5f4f0;
        color: #1c1c1c;
      }
      body {
        margin: 0;
        padding: 32px 20px;
        background: linear-gradient(140deg, #fdf6e3, #f5f4f0 45%, #eef1e8);
      }
      main {
        max-width: 900px;
        margin: 0 auto;
      }
      h1 {
        font-size: 2rem;
        margin: 0 0 6px;
      }
      .chain-entry {
        background: white;
        border-radius: 8px;
        padding: 16px;
        margin-bottom: 12px;
        border-left: 4px solid #5b6f3b;
      }
      .location-name {
        font-weight: 600;
        color: #5b6f3b;
        font-size: 1.1em;
        margin-bottom: 8px;
      }
      .time-info {
        display: flex;
        gap: 16px;
        margin-bottom: 8px;
      }
      .time-item {
        flex: 1;
      }
      .time-label {
        color: #666;
        font-size: 0.9em;
      }
      .time-value {
        font-family: monospace;
        font-weight: bold;
        color: #333;
        margin-top: 4px;
      }
      .next-service {
        margin-top: 12px;
        padding: 8px;
        background: #f5f4f0;
        border-radius: 4px;
        border-left: 2px solid #999;
      }
      .next-label {
        color: #888;
        font-size: 0.9em;
      }
      .next-headcode {
        font-family: monospace;
        font-weight: bold;
        margin-top: 4px;
      }
      .delay {
        color: #c55;
        font-weight: bold;
      }
      .back-link {
        display: inline-block;
        margin-bottom: 20px;
        padding: 8px 12px;
        background: #e8e3d4;
        border-radius: 6px;
      }
      .no-data {
        padding: 20px;
        background: white;
        border-radius: 8px;
        color: #999;
        text-align: center;
      }
    </style>
  </head>
  <body>
    <main>
      <a href="/debug/chains" class="back-link">← Back to All Chains</a>
      <h1>Service Chain: <code>${escapeHtml(targetHeadcode)}</code></h1>`;

      let found = false;

      for (const [sheet, chainData] of Object.entries(chains)) {
        const transitions = chainData.headcodeChain[targetHeadcode] || [];
        
        if (transitions.length === 0) continue;
        
        found = true;
        html += `<h2>${escapeHtml(sheet)}</h2>`;

        for (const { location, nextHeadcode } of transitions) {
          const delay = chainData.history[targetHeadcode]?.[location];
          const delayDisplay = delay !== undefined && delay !== 0
            ? `<div class="delay">Delay: ${delay > 0 ? '+' : ''}${delay} minute${Math.abs(delay) === 1 ? '' : 's'}</div>`
            : '';

          html += `
            <div class="chain-entry">
              <div class="location-name">${escapeHtml(location)}</div>
              ${delayDisplay}
              <div class="next-service">
                <div class="next-label">Continues as:</div>
                <div class="next-headcode">${escapeHtml(nextHeadcode)}</div>
              </div>
            </div>
          `;
        }
      }

      if (!found) {
        html += `<div class="no-data">
          <p>No service chain found for <strong>${escapeHtml(targetHeadcode)}</strong></p>
          <p><a href="/debug/chains">View all chains</a></p>
        </div>`;
      }

      html += `
    </main>
  </body>
</html>`;

      res.type("html").send(html);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected error";
      res.type("html").send(`
        <!doctype html>
        <html>
          <head><title>Debug Error</title></head>
          <body>
            <h1>Debug Error</h1>
            <p>${escapeHtml(message)}</p>
            <a href="/debug/chains">Back to chains</a>
          </body>
        </html>
      `);
    }
  });
}
