import { buildEstimatedTimingPoints, escapeHtml, formatHalfMinutesToTime, parseTimeToHalfMinutes } from "./utils.js";

function formatDelayLabel(delayMinutes) {
  const minutes = Number(delayMinutes || 0);
  if (minutes === 0) {
    return "On time";
  }
  if (minutes > 0) {
    return `${minutes} min late`;
  }
  return `${Math.abs(minutes)} min early`;
}

function renderDelayBadge(delayMinutes) {
  const minutes = Number(delayMinutes || 0);
  const className = minutes > 0 ? "late" : minutes < 0 ? "early" : "on-time";
  return `<span class="delay-pill ${className}">${escapeHtml(formatDelayLabel(minutes))}</span>`;
}

function renderNav(activePage) {
  const navItems = [
    ["lookup", "/", "Lookup"],
    ["duties", "/duties", "Duties"],
    ["lineups", "/lineups", "Lineups"],
  ];

  return `<div class="nav">
    ${navItems
      .map(([key, href, label]) => `<a href="${href}" class="nav-link${key === activePage ? " active" : ""}">${label}</a>`)
      .join("")}
  </div>`;
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

function renderCellDisplayWithEstimate(scheduledValue, noteValue, estimatedHalfMinutes) {
  const scheduled = String(scheduledValue || "").trim();
  const note = String(noteValue || "").trim();
  const scheduledHalfMinutes = parseTimeToHalfMinutes(scheduled);

  if (!scheduled) {
    return renderCellDisplay(scheduledValue, noteValue);
  }

  if (
    estimatedHalfMinutes !== null &&
    estimatedHalfMinutes !== undefined &&
    scheduledHalfMinutes !== null &&
    estimatedHalfMinutes !== scheduledHalfMinutes
  ) {
    const estimatedTime = formatHalfMinutesToTime(estimatedHalfMinutes);
    const estimateDisplay = `<span class="muted">(est. ${escapeHtml(estimatedTime)})</span>`;

    if (!note) {
      return `<strong>${escapeHtml(scheduled)}</strong> ${estimateDisplay}`;
    }
    if (note === scheduled) {
      return `${escapeHtml(note)} ${estimateDisplay}`;
    }
    return `${escapeHtml(note)} <span class="muted">(${escapeHtml(scheduled)})</span> ${estimateDisplay}`;
  }

  return renderCellDisplay(scheduledValue, noteValue);
}

function renderEditableCellWithEstimate(value, note, sheet, rowIndex, columnIndex, type, estimatedHalfMinutes, strikethrough = false) {
  const display = estimatedHalfMinutes !== null && estimatedHalfMinutes !== undefined
    ? renderCellDisplayWithEstimate(value, note, estimatedHalfMinutes)
    : renderCellDisplay(value, note);
  const safeValue = escapeHtml(value);
  const safeNote = escapeHtml(note);
  if (rowIndex === null || rowIndex === undefined || strikethrough) {
    const className = strikethrough ? ' class="strikethrough"' : '';
    return `<td${className}>${display}</td>`;
  }
  return `<td class="editable" data-sheet="${escapeHtml(sheet)}" data-row="${rowIndex}" data-col="${columnIndex}" data-type="${type}" data-value="${safeValue}" data-note="${safeNote}">${display}</td>`;
}

function renderEditableCell(value, note, sheet, rowIndex, columnIndex, type, strikethrough = false) {
  return renderEditableCellWithEstimate(value, note, sheet, rowIndex, columnIndex, type, null, strikethrough);
}

function getPointSortUnits(point) {
  const departure = parseTimeToHalfMinutes(point.departure || "");
  if (departure !== null) {
    return departure;
  }
  return parseTimeToHalfMinutes(point.arrival || "");
}

function renderRecord(sheet, columnIndex, points) {
  const orderedPoints = points
    .map((point, index) => ({ point, index, sortUnits: getPointSortUnits(point) }))
    .sort((a, b) => {
      if (a.sortUnits === null && b.sortUnits === null) {
        return a.index - b.index;
      }
      if (a.sortUnits === null) {
        return 1;
      }
      if (b.sortUnits === null) {
        return -1;
      }
      if (a.sortUnits !== b.sortUnits) {
        return a.sortUnits - b.sortUnits;
      }
      return a.index - b.index;
    })
    .map((entry) => entry.point);

  const anticipatedDelay = orderedPoints[0]?.anticipatedDelay || 0;
  const estimatedPoints = buildEstimatedTimingPoints(orderedPoints, anticipatedDelay);
  const rows = orderedPoints
    .map((point, index) => {
      const estimatedPoint = estimatedPoints[index];
      const {
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
        platformStrikethrough,
        arrivalStrikethrough,
        departureStrikethrough,
      } = point;

      return `<tr>
          <th>${escapeHtml(location)}</th>
          ${renderEditableCell(platform, platformNote, sheet, platformRow, columnIndex, "plt", platformStrikethrough)}
          ${renderEditableCellWithEstimate(arrival, arrivalNote, sheet, arrivalRow, columnIndex, "arr", estimatedPoint.arrivalEstimatedUnits, arrivalStrikethrough)}
          ${renderEditableCellWithEstimate(departure, departureNote, sheet, departureRow, columnIndex, "dep", estimatedPoint.departureEstimatedUnits, departureStrikethrough)}
        </tr>`;
    })
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

function renderServiceSections(results) {
  return results
    .map(
      (result) => {
        const meta = result.serviceMeta || {};
        const metaItems = [
          ["Source", meta.source],
          ["Train", meta.train],
          ["From", meta.from],
          ["UP/DN", meta.direction],
          ["To", meta.to],
          ["Description", meta.description],
        ].filter(([, value]) => String(value || "").trim() !== "");
        const metaHtml = metaItems.length
          ? `<div class="service-meta">${metaItems
              .map(([label, value]) => `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`)
              .join("")}</div>`
          : "";
        const routeChangeBox = result.headcodeNote
          ? `<div class="route-change-box">
               <div class="route-change-icon">⚠️</div>
               <div class="route-change-content">
                 <strong>Route Change:</strong> ${escapeHtml(result.headcodeNote)}
               </div>
             </div>`
          : "";
        const title = result.duty !== undefined && result.duty !== null
          ? `${escapeHtml(result.headcode)} <span class="muted">(Duty ${escapeHtml(result.duty)})</span>`
          : escapeHtml(result.headcode);
        return `${routeChangeBox}<section><h2>${title}</h2>${metaHtml}${renderRecord(result.sheet, result.columnIndex, result.points)}</section>`;
      }
    )
    .join("");
}

  function renderOverviewRows(entries) {
    return entries
      .map((entry) => {
        const warningIcon = entry.headcodeNote
          ? ` <span class="warning-icon" data-note="${escapeHtml(entry.headcodeNote)}" data-headcode="${escapeHtml(entry.headcode)}" title="Route change note">⚠️</span>`
          : "";
        return `<tr>
          <th>${escapeHtml(entry.headcode)}${warningIcon}</th>
          <td>${escapeHtml(entry.direction || "")}</td>
          <td>${escapeHtml(entry.origin || "")}</td>
          <td>${escapeHtml(entry.nextStop || "")}</td>
          <td>${escapeHtml(entry.destination || "")}</td>
          <td>${renderDelayBadge(entry.latenessMinutes)}</td>
        </tr>`;
      })
      .join("");
  }

function renderNoteModal() {
  return `
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
  `;
}

function renderNoteScript(refreshWhenQueryKeyExists = "headcode") {
  return `
      const params = new URLSearchParams(window.location.search);
      const modal = document.getElementById("note-modal");
      const form = document.getElementById("note-form");
      const input = document.getElementById("delay-input");
      const meta = document.getElementById("note-meta");
      const status = document.getElementById("note-status");
      const cancel = document.getElementById("note-cancel");
      let activeCell = null;

      if (params.get("${refreshWhenQueryKeyExists}")) {
        // auto-reload disabled
      }

      const closeModal = ({ refresh = false } = {}) => {
        modal.classList.remove("open");
        modal.setAttribute("aria-hidden", "true");
        status.textContent = "";
        activeCell = null;
        if (refresh && params.get("${refreshWhenQueryKeyExists}")) {
          // refresh action intentionally left blank (auto-reload removed)
        }
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
        closeModal({ refresh: true });
      });

      modal.addEventListener("click", (event) => {
        if (event.target === modal) {
          closeModal({ refresh: true });
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
            closeModal({ refresh: true });
          }, 400);
        } catch (err) {
          status.textContent = "Failed to save note.";
        }
      });
  `;
}

export function renderPage({ headcode, results, error }) {
  const resultHtml = error
    ? `<div class="alert">${escapeHtml(error)}</div>`
    : results.length
      ? renderServiceSections(results)
      : headcode
        ? "<p class=\"empty\">No matching headcode found.</p>"
        : "<p class=\"empty\">Enter a headcode to see the timetable.</p>";

  return renderShell({
    title: "Timetable Lookup",
    body: `
      <header>
        ${renderNav("lookup")}
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
      ${renderNoteModal()}
    `,
    script: renderNoteScript("headcode"),
  });
}

export function renderDutyPage({ duty, results, error }) {
  const resultHtml = error
    ? `<div class="alert">${escapeHtml(error)}</div>`
    : results.length
      ? renderServiceSections(results)
      : duty
        ? "<p class=\"empty\">No matching services found for this duty.</p>"
        : "<p class=\"empty\">Enter a duty number to see the services for that duty.</p>";

  return renderShell({
    title: "Duty View",
    body: `
      <header>
        ${renderNav("duties")}
        <h1>Duty View</h1>
        <p>Enter the duty number from the third character of a headcode to see every service booked on that duty.</p>
      </header>
      <form method="get" action="/duties">
        <input
          name="duty"
          type="text"
          inputmode="numeric"
          maxlength="1"
          placeholder="Duty number, e.g. 1"
          value="${escapeHtml(duty || "")}" />
        <button type="submit">Show duty</button>
      </form>
      ${resultHtml}
      ${renderNoteModal()}
    `,
    script: `${renderNoteScript("duty")}`,
  });
}

export function renderLineupsIndex({ locations, error }) {
  const content = error
    ? `<div class="alert">${escapeHtml(error)}</div>`
    : locations.length
      ? `<section>
          <h2>Timing points</h2>
          <p>Select a location to view arriving and departing trains.</p>
          <div class="grid">
            ${locations
              .map((location) => {
                const href = `/lineups/${encodeURIComponent(location)}`;
                return `<a class="card-link" href="${href}">${escapeHtml(location)}</a>`;
              })
              .join("")}
          </div>
        </section>`
      : "<p class=\"empty\">No timing points found.</p>";

  return renderShell({
    title: "Lineups",
    body: `
      <header>
        ${renderNav("lineups")}
        <h1>Lineups</h1>
        <p>Choose a timing point to see every arrival and departure.</p>
      </header>
      ${content}
    `,
    script: `
      // auto-reload disabled
    `,
  });
}

export function renderLineupPage({ location, combined, considerDelays, error }) {
  const content = error
    ? `<div class="alert">${escapeHtml(error)}</div>`
    : location
      ? (() => {
          const entries = combined[location] || [];
          const columns = [
            {
              key: "direction",
              label: "Dir",
              has: entries.some((entry) => String(entry.direction || "").trim() !== ""),
              render: (entry) => escapeHtml(entry.direction || ""),
            },
            {
              key: "platform",
              label: "Platform",
              has: entries.some(
                (entry) =>
                  String(entry.platform || "").trim() !== "" ||
                  String(entry.platformNote || "").trim() !== ""
              ),
              render: (entry) => renderCellDisplay(entry.platform, entry.platformNote),
            },
            {
              key: "pth",
              label: "PTH",
              has: entries.some(
                (entry) => String(entry.pth || "").trim() !== "" || String(entry.pthNote || "").trim() !== ""
              ),
              render: (entry) => renderCellDisplay(entry.pth, entry.pthNote),
            },
            {
              key: "lne",
              label: "LNE",
              has: entries.some(
                (entry) => String(entry.lne || "").trim() !== "" || String(entry.lneNote || "").trim() !== ""
              ),
              render: (entry) => renderCellDisplay(entry.lne, entry.lneNote),
            },
            {
              key: "arrival",
              label: "Arrival time",
              has: entries.some(
                (entry) =>
                  String(entry.arrival || "").trim() !== "" || String(entry.arrivalNote || "").trim() !== ""
              ),
              render: (entry, estimatedEntry) => considerDelays
                ? renderCellDisplayWithEstimate(entry.arrival, entry.arrivalNote, estimatedEntry?.arrivalEstimatedUnits)
                : renderCellDisplay(entry.arrival, entry.arrivalNote),
            },
            {
              key: "departure",
              label: "Departure time",
              has: entries.some(
                (entry) =>
                  String(entry.departure || "").trim() !== "" || String(entry.departureNote || "").trim() !== ""
              ),
              render: (entry, estimatedEntry) => considerDelays
                ? renderCellDisplayWithEstimate(entry.departure, entry.departureNote, estimatedEntry?.departureEstimatedUnits)
                : renderCellDisplay(entry.departure, entry.departureNote),
            },
          ];
          const visibleColumns = columns.filter((column) => column.has);
          const colSpan = 1 + visibleColumns.length;
          const rows = entries.length
            ? entries
                .map((entry) => {
                  const estimatedEntry = considerDelays
                    ? buildEstimatedTimingPoints(
                        [{ arrival: entry.arrival, departure: entry.departure }],
                        entry.anticipatedDelay || 0
                      )[0]
                    : null;
                  const cells = visibleColumns
                    .map((column) => `<td>${column.render(entry, estimatedEntry)}</td>`)
                    .join("");
                  const rowClass = entry.departureStrikethrough ? ' class="strikethrough"' : '';
                    const sortKey = Number.isFinite(entry.sortKeyUnits) ? entry.sortKeyUnits : "";
                  const warningIcon = entry.headcodeNote 
                    ? ` <span class="warning-icon" data-note="${escapeHtml(entry.headcodeNote)}" data-headcode="${escapeHtml(entry.headcode)}" title="Route change note">⚠️</span>`
                    : '';
                    return `<tr${rowClass} data-sort-key="${sortKey}"><th>${escapeHtml(entry.headcode)}${warningIcon}</th>${cells}</tr>`;
                })
                .join("")
            : `<tr><td colspan="${colSpan}" class="empty">No trains listed.</td></tr>`;

          const headerCells = visibleColumns.map((column) => `<th>${column.label}</th>`).join("");

          return `
            <section>
              <h2>All services</h2>
              <table>
                <thead>
                  <tr>
                    <th>Headcode</th>
                    ${headerCells}
                  </tr>
                </thead>
                <tbody>${rows}</tbody>
              </table>
            </section>
          `;
        })()
      : "<p class=\"empty\">Unknown timing point.</p>";

  const toggleUrl = considerDelays
    ? `/lineups/${encodeURIComponent(location)}`
    : `/lineups/${encodeURIComponent(location)}?consider=delays`;
  const toggleText = considerDelays ? "Hide anticipated delays" : "Consider anticipated delays";

  return renderShell({
    title: `Lineups - ${location || "Unknown"}`,
    body: `
      <header>
        ${renderNav("lineups")}
        <h1>${escapeHtml(location || "Lineup")}</h1>
        <p>All trains calling at this timing point, sorted by arrival (or departure).</p>
        <p><a href="${toggleUrl}" style="font-weight: 600;">${toggleText}</a></p>
      </header>
      ${content}
      <div id="route-note-modal" class="modal" aria-hidden="true">
        <div class="modal-card" role="dialog" aria-modal="true">
          <h3 id="route-note-title">Route Change</h3>
          <div id="route-note-content"></div>
          <div class="modal-actions">
            <button type="button" id="route-note-close">Close</button>
          </div>
        </div>
      </div>
    `,
    script: `
      const routeModal = document.getElementById("route-note-modal");
      const routeTitle = document.getElementById("route-note-title");
      const routeContent = document.getElementById("route-note-content");
      const routeClose = document.getElementById("route-note-close");

      function parseCurrentTimeUnits() {
        const now = new Date();
        return (now.getHours() * 60 + now.getMinutes()) * 2 + (now.getSeconds() >= 30 ? 1 : 0);
      }

      function insertNowMarker() {
        document.querySelectorAll("table").forEach((table) => {
          const body = table.querySelector("tbody");
          if (!body) {
            return;
          }

          const existingMarker = body.querySelector("tr.now-marker");
          if (existingMarker) {
            existingMarker.remove();
          }

          const rows = Array.from(body.querySelectorAll("tr:not(.now-marker)"));
          const currentTimeUnits = parseCurrentTimeUnits();
          const marker = document.createElement("tr");
          marker.className = "now-marker";
          marker.innerHTML = '<td colspan="' + table.querySelectorAll("thead th").length + '"><span aria-hidden="true"></span></td>';

          let insertBefore = null;
          for (const row of rows) {
            const sortKey = Number(row.dataset.sortKey);
            if (Number.isFinite(sortKey) && sortKey >= currentTimeUnits) {
              insertBefore = row;
              break;
            }
          }

          if (insertBefore) {
            body.insertBefore(marker, insertBefore);
          } else {
            body.appendChild(marker);
          }
        });
      }

      document.addEventListener("click", (event) => {
        const icon = event.target.closest(".warning-icon");
        if (!icon) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        const headcode = icon.dataset.headcode || "";
        const note = icon.dataset.note || "";
        routeTitle.textContent = headcode ? headcode + " - Route Change" : "Route Change";
        routeContent.textContent = note;
        routeModal.classList.add("open");
        routeModal.setAttribute("aria-hidden", "false");
      });

      routeClose.addEventListener("click", () => {
        routeModal.classList.remove("open");
        routeModal.setAttribute("aria-hidden", "true");
      });

      routeModal.addEventListener("click", (event) => {
        if (event.target === routeModal) {
          routeModal.classList.remove("open");
          routeModal.setAttribute("aria-hidden", "true");
        }
      });

      insertNowMarker();
      setInterval(insertNowMarker, 30000);

      if (window.location.pathname.startsWith('/lineups/')) {
        // auto-reload disabled for lineup pages
      }
    `,
  });
}

// Network overview page removed

function renderShell({ title, body, script }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
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
        max-width: 960px;
        margin: 0 auto;
      }
      h1 {
        font-size: 2.3rem;
        margin: 0 0 6px;
      }
      h2 {
        margin: 0 0 8px;
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
      .service-meta {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
        gap: 10px;
        margin: 0 0 14px;
        padding: 12px 14px;
        border-radius: 12px;
        background: #f8f4e8;
        border: 1px solid #e7dfc7;
      }
      .service-meta span {
        display: block;
        font-size: 0.78rem;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: #756d5f;
        margin-bottom: 2px;
      }
      .service-meta strong {
        display: block;
        font-size: 0.98rem;
        color: #2f2b24;
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
      a {
        color: #355930;
        text-decoration: none;
      }
      a:hover {
        text-decoration: underline;
      }
      .nav {
        display: flex;
        gap: 14px;
        margin-bottom: 18px;
        flex-wrap: wrap;
      }
      .nav-link {
        padding: 6px 12px;
        border-radius: 999px;
        background: #ece6d8;
        color: #4b4435;
        font-weight: 600;
      }
      .nav-link.active {
        background: #5b6f3b;
        color: white;
      }
      .delay-pill {
        display: inline-block;
        min-width: 84px;
        padding: 5px 10px;
        border-radius: 999px;
        text-align: center;
        font-weight: 700;
        font-size: 0.9rem;
      }
      .delay-pill.on-time {
        background: #dff0d4;
        color: #315126;
      }
      .delay-pill.late {
        background: #f7d7d0;
        color: #7f2418;
      }
      .delay-pill.early {
        background: #dbe8fb;
        color: #284c80;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 14px;
      }
      .card-link {
        display: block;
        padding: 14px 16px;
        border-radius: 14px;
        background: #fffefb;
        border: 1px solid #efe9d7;
        color: #3b3a30;
        box-shadow: 0 8px 16px rgba(50, 45, 30, 0.07);
      }
      .card-link:hover {
        border-color: #d8cfb4;
        box-shadow: 0 12px 22px rgba(50, 45, 30, 0.12);
        text-decoration: none;
      }
      .editable {
        cursor: pointer;
      }
      .editable:hover {
        background: #f7f2e3;
      }
      .strikethrough {
        text-decoration: line-through;
        color: #9a9489;
        opacity: 0.7;
      }
      .strikethrough th,
      .strikethrough td {
        text-decoration: line-through;
        color: #9a9489;
        opacity: 0.7;
      }
      .warning-icon {
        display: inline-block;
        cursor: pointer;
        font-size: 0.9em;
        margin-left: 6px;
        opacity: 0.8;
        transition: opacity 0.2s, transform 0.2s;
      }
      .warning-icon:hover {
        opacity: 1;
        transform: scale(1.15);
      }
      .now-marker td {
        padding: 0;
        border-bottom: none;
      }
      .now-marker td span {
        display: block;
        position: relative;
        padding: 8px 0;
      }
      .now-marker td span::before {
        content: "";
        position: absolute;
        left: 0;
        right: 0;
        top: 50%;
        border-top: 3px solid #d11f2d;
        transform: translateY(-50%);
        z-index: 0;
      }
      .now-marker td span::after {
        content: "Now";
        position: relative;
        z-index: 1;
        background: #fff6f6;
        padding: 0 10px;
        margin-left: 14px;
        border-radius: 999px;
        box-shadow: 0 0 0 2px #fff6f6;
      }
      .route-change-box {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        background: #fff4e6;
        border: 2px solid #f59e0b;
        border-radius: 12px;
        padding: 14px 16px;
        margin-bottom: 16px;
        box-shadow: 0 4px 12px rgba(245, 158, 11, 0.15);
      }
      .route-change-icon {
        font-size: 1.3em;
        flex-shrink: 0;
        line-height: 1;
      }
      .route-change-content {
        flex: 1;
        color: #92400e;
        line-height: 1.5;
      }
      .route-change-content strong {
        color: #78350f;
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
      .modal-card #route-note-content {
        margin: 12px 0;
        padding: 12px;
        background: #f9f7f3;
        border-radius: 8px;
        color: #3b3a30;
        line-height: 1.5;
        white-space: pre-wrap;
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
      ${body}
    </main>
    ${script ? `<script>${script}</script>` : ""}
  </body>
</html>`;
}
