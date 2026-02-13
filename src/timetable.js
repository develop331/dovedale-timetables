import { normalizeHeadcode } from "./utils.js";
import { buildDelayHistory, buildLineups, getAnticipatedDelayForHeadcode } from "./lineups.js";

function findHeadcodeColumn(headers, target) {
  return headers.findIndex((header) => normalizeHeadcode(header) === target);
}

export function buildTimingPointsForColumn(info, columnIndex) {
  const points = [];
  let current = null;

  info.rows.forEach((row, idx) => {
    const location = String(info.rowLabels[idx] || "").trim();
    const type = String(row[1]?.value || "").trim().toLowerCase();
    const cell = row[columnIndex] || { value: "", note: "" };
    const value = cell.value ?? "";
    const sheetRowIndex = idx + 1;

    // Skip "Next" rows as they're service chain markers
    if (location.toLowerCase() === "next") {
      return;
    }

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

export function filterByHeadcode(data, headcode) {
  const target = normalizeHeadcode(headcode);
  if (!target) {
    return [];
  }

  // Build delay contexts to calculate anticipated delays
  const delayContexts = {};
  for (const [sheet, info] of Object.entries(data)) {
    delayContexts[sheet] = buildDelayHistory(info);
  }

  const matches = [];
  for (const [sheet, info] of Object.entries(data)) {
    const columnIndex = findHeadcodeColumn(info.headers, target);
    if (columnIndex < 0) {
      continue;
    }

    const points = buildTimingPointsForColumn(info, columnIndex);
    
    // Calculate anticipated delay for each location
    const pointsWithAnticipatedDelay = points.map((point) => ({
      ...point,
      anticipatedDelay: getAnticipatedDelayForHeadcode(delayContexts, sheet, target, point.location),
    }));
    
    matches.push({ sheet, points: pointsWithAnticipatedDelay, columnIndex, headcode: target });
  }

  return matches;
}
