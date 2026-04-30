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

function getServiceSummaryFromPoints(points, serviceMeta) {
  const firstPoint = points[0] || null;
  const nextPoint = points[1] || firstPoint;
  const lastPoint = points[points.length - 1] || null;

  return {
    origin: String(serviceMeta?.from || firstPoint?.location || "").trim(),
    destination: String(serviceMeta?.to || lastPoint?.location || "").trim(),
    nextStop: String(nextPoint?.location || "").trim(),
  };
}

function getServiceSortKeyFromOverview(entry) {
  if (entry.latenessMinutes === null) {
    return Number.NEGATIVE_INFINITY;
  }
  const latenessPriority = Number(entry.latenessMinutes || 0);
  const nextStopTime = entry.nextStopSortKey;
  if (nextStopTime === null) {
    return latenessPriority;
  }
  return latenessPriority * 10000 - nextStopTime;
}

export function buildNetworkOverview(data) {
  const delayContexts = getDelayContexts(data);
  const entries = [];

  for (const [sheet, info] of Object.entries(data)) {
    for (let columnIndex = 2; columnIndex < (info.headers || []).length; columnIndex += 1) {
      const headcode = normalizeHeadcode(info.headers[columnIndex]);
      if (!headcode) {
        continue;
      }

      const points = buildTimingPointsForColumn(info, columnIndex);
      if (!points.length) {
        continue;
      }

      const serviceMeta = info.serviceMeta?.[columnIndex] || null;
      const summary = getServiceSummaryFromPoints(points, serviceMeta);
      const nextStopPoint = points[1] || points[0] || null;
      const nextStopLocation = summary.nextStop || nextStopPoint?.location || "";
      const latenessMinutes = nextStopLocation
        ? getAnticipatedDelayForHeadcode(delayContexts, sheet, headcode, nextStopLocation)
        : 0;

      entries.push({
        sheet,
        headcode,
        serviceMeta,
        headcodeNote: info.headerNotes?.[columnIndex] || "",
        direction: serviceMeta?.direction || "",
        origin: summary.origin,
        destination: summary.destination,
        nextStop: nextStopLocation,
        latenessMinutes,
        nextStopSortKey: parseTimeToHalfMinutes(nextStopPoint?.arrival || nextStopPoint?.departure || ""),
      });
    }
  }

  return entries.sort((a, b) => {
    const aDelay = Number(a.latenessMinutes || 0);
    const bDelay = Number(b.latenessMinutes || 0);
    if (aDelay !== bDelay) {
      return bDelay - aDelay;
    }

    const aSort = getServiceSortKeyFromOverview(a);
    const bSort = getServiceSortKeyFromOverview(b);
    if (aSort !== bSort) {
      return aSort - bSort;
    }

    return a.headcode.localeCompare(b.headcode);
  });
}
