import { normalizeHeadcode } from "./utils.js";
import { buildLineups, getAnticipatedDelayForHeadcode, getDelayContexts } from "./lineups.js";
import { parseTimeToHalfMinutes } from "./utils.js";

function findHeadcodeColumn(headers, target) {
  return headers.findIndex((header) => normalizeHeadcode(header) === target);
}

function getDutyFromHeadcode(headcode) {
  const normalized = normalizeHeadcode(headcode);
  return normalized.length >= 3 ? normalized.charAt(2) : "";
}

function getServiceSortKey(points) {
  let best = null;
  points.forEach((point) => {
    const candidate = parseTimeToHalfMinutes(point.arrival || point.departure || "");
    if (candidate === null) {
      return;
    }
    if (best === null || candidate < best) {
      best = candidate;
    }
  });
  return best;
}

export function buildTimingPointsForColumn(info, columnIndex) {
  const points = [];
  let current = null;
  const dataStartIndex = Number.isInteger(info.dataStartIndex) ? info.dataStartIndex : 1;

  info.rows.forEach((row, idx) => {
    const location = String(info.rowLabels[idx] || "").trim();
    const type = String(row[1]?.value || "").trim().toLowerCase();
    const cell = row[columnIndex] || { value: "", note: "" };
    const value = cell.value ?? "";
    const sheetRowIndex = dataStartIndex + idx;

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
        arrivalStrikethrough: false,
        departureStrikethrough: false,
        platformStrikethrough: false,
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
      current.arrivalStrikethrough = cell.strikethrough || false;
    } else if (type === "dep") {
      current.departure = value;
      current.departureNote = cell.note || "";
      current.departureRow = sheetRowIndex;
      current.departureStrikethrough = cell.strikethrough || false;
    } else if (type === "plt") {
      current.platform = value;
      current.platformNote = cell.note || "";
      current.platformRow = sheetRowIndex;
      current.platformStrikethrough = cell.strikethrough || false;
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
  const delayContexts = getDelayContexts(data);

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
    
    const headcodeNote = info.headerNotes?.[columnIndex] || "";
    
    matches.push({
      sheet,
      points: pointsWithAnticipatedDelay,
      columnIndex,
      headcode: target,
      headcodeNote,
      serviceMeta: info.serviceMeta?.[columnIndex] || null,
    });
  }

  return matches;
}

export function filterByDuty(data, duty) {
  const target = String(duty || "").trim().charAt(0);
  if (!target) {
    return [];
  }

  const delayContexts = getDelayContexts(data);

  const matches = [];
  for (const [sheet, info] of Object.entries(data)) {
    info.headers.forEach((header, columnIndex) => {
      const headcode = normalizeHeadcode(header);
      if (!headcode || getDutyFromHeadcode(headcode) !== target) {
        return;
      }

      const points = buildTimingPointsForColumn(info, columnIndex);
      const pointsWithAnticipatedDelay = points.map((point) => ({
        ...point,
        anticipatedDelay: getAnticipatedDelayForHeadcode(delayContexts, sheet, headcode, point.location),
      }));

      matches.push({
        sheet,
        points: pointsWithAnticipatedDelay,
        columnIndex,
        headcode,
        duty: target,
        headcodeNote: info.headerNotes?.[columnIndex] || "",
        serviceMeta: info.serviceMeta?.[columnIndex] || null,
        sortKey: getServiceSortKey(pointsWithAnticipatedDelay),
      });
    });
  }

  return matches.sort((a, b) => {
    if (a.sortKey === null && b.sortKey === null) {
      return a.headcode.localeCompare(b.headcode);
    }
    if (a.sortKey === null) {
      return 1;
    }
    if (b.sortKey === null) {
      return -1;
    }
    if (a.sortKey !== b.sortKey) {
      return a.sortKey - b.sortKey;
    }
    return a.headcode.localeCompare(b.headcode);
  });
}
