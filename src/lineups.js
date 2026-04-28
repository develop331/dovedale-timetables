import { buildEstimatedTimingPoints, parseDelayFromNote, parseTimeToHalfMinutes } from "./utils.js";

const MAX_CHAIN_STOP_HALF_MINUTES = 4;

function buildLineupsForSheet(info) {
  const lineups = new Map();
  let currentLocation = "";

  info.rows.forEach((row, rowIndex) => {
    const location = String(info.rowLabels[rowIndex] || "").trim();
    const type = String(row[1]?.value || "").trim().toLowerCase();
    
    // Skip "Next" rows as they're used for service chaining, not lineups
    if (location.toLowerCase() === "next") {
      return;
    }
    
    if (location) {
      currentLocation = location;
    }
    if (!currentLocation || (type !== "arr" && type !== "dep" && type !== "plt" && type !== "pth" && type !== "lne")) {
      return;
    }

    const locationMap = lineups.get(currentLocation) || new Map();
    for (let col = 2; col < info.headers.length; col += 1) {
      const headcode = String(info.headers[col] || "").trim();
      if (!headcode) {
        continue;
      }
      const cell = row[col] || { value: "", note: "" };
      const value = String(cell.value || "").trim();
      const note = String(cell.note || "").trim();
      if (!value && !note) {
        continue;
      }
      const entry =
        locationMap.get(headcode) ||
        {
          headcode,
          headcodeNote: info.headerNotes?.[col] || "",
          arrival: "",
          departure: "",
          platform: "",
          pth: "",
          lne: "",
          arrivalNote: "",
          departureNote: "",
          platformNote: "",
          pthNote: "",
          lneNote: "",
          departureStrikethrough: false,
        };
      if (type === "arr") {
        entry.arrival = value;
        entry.arrivalNote = note;
      } else if (type === "dep") {
        entry.departure = value;
        entry.departureNote = note;
        entry.departureStrikethrough = cell.strikethrough || false;
      } else if (type === "plt") {
        entry.platform = value;
        entry.platformNote = note;
      } else if (type === "pth") {
        entry.pth = value;
        entry.pthNote = note;
      } else if (type === "lne") {
        entry.lne = value;
        entry.lneNote = note;
      }
      locationMap.set(headcode, entry);
    }
    lineups.set(currentLocation, locationMap);
  });

  const result = {};
  for (const [location, entries] of lineups.entries()) {
    result[location] = Array.from(entries.values()).sort((a, b) =>
      a.headcode.localeCompare(b.headcode)
    );
  }
  return result;
}

function getLineupSortKey(entry, considerDelays = false) {
  const time = entry.arrival || entry.departure || "";
  const parsed = parseTimeToHalfMinutes(time);
  if (parsed === null) {
    return null;
  }
  if (!considerDelays || entry.anticipatedDelay === undefined || entry.anticipatedDelay === null) {
    return parsed;
  }
  return entry.estimatedDepartureUnits ?? entry.estimatedArrivalUnits ?? parsed;
}

function getDirectionForSheet(sheet) {
  const normalized = String(sheet || "").toUpperCase();
  if (normalized.includes("UP")) {
    return "U";
  }
  if (normalized.includes("DOWN")) {
    return "D";
  }
  return "";
}

export function buildDelayHistory(info) {
  const history = {};
  const locationOrder = [];
  const locationIndices = {};
  const headcodeChain = {};
  const timings = {};
  const seenLocations = new Set();
  let currentLocation = "";

  info.rows.forEach((row, rowIndex) => {
    const location = String(info.rowLabels[rowIndex] || "").trim();
    const type = String(row[1]?.value || "").trim().toLowerCase();
    
    // Handle "Next" row - it's in column A (location), not column B (type)
    if (location.toLowerCase() === "next") {
      for (let col = 2; col < info.headers.length; col += 1) {
        const headcode = String(info.headers[col] || "").trim();
        if (!headcode) {
          continue;
        }
        const cell = row[col] || { value: "", note: "" };
        const nextHeadcode = String(cell.value || "").trim();
        if (!nextHeadcode) {
          continue;
        }
        if (!headcodeChain[headcode]) {
          headcodeChain[headcode] = [];
        }
        // For "Next" rows, use the last actual location before this row
        const lastLocation = currentLocation || "Unknown";
        headcodeChain[headcode].push({ location: lastLocation, nextHeadcode });
      }
      return;
    }
    
    if (location) {
      currentLocation = location;
      if (!seenLocations.has(location)) {
        locationOrder.push(location);
        locationIndices[location] = locationOrder.length - 1;
        seenLocations.add(location);
      }
    }
    if (!currentLocation || (type !== "arr" && type !== "dep")) {
      return;
    }

    for (let col = 2; col < info.headers.length; col += 1) {
      const headcode = String(info.headers[col] || "").trim();
      if (!headcode) {
        continue;
      }
      const cell = row[col] || { value: "", note: "" };
      const value = String(cell.value || "").trim();
      const scheduledTime = parseTimeToHalfMinutes(value);
      if (scheduledTime !== null) {
        if (!timings[headcode]) {
          timings[headcode] = {};
        }
        if (!timings[headcode][currentLocation]) {
          timings[headcode][currentLocation] = { arr: null, dep: null };
        }
        if (type === "arr") {
          timings[headcode][currentLocation].arr = scheduledTime;
        } else if (type === "dep") {
          timings[headcode][currentLocation].dep = scheduledTime;
        }
      }

      const note = String(cell.note || "").trim();
      if (!note) {
        continue;
      }
      const delta = parseDelayFromNote(note);
      if (delta === null) {
        continue;
      }
      if (!history[headcode]) {
        history[headcode] = {};
      }
      history[headcode][currentLocation] = delta;
    }
  });

  return { history, locationOrder, locationIndices, headcodeChain, timings };
}

function getHandoverTimeForHeadcode(timings, headcode, location, preferDeparture = true) {
  const atLocation = timings?.[headcode]?.[location];
  if (!atLocation) {
    return null;
  }

  if (preferDeparture) {
    if (atLocation.dep !== null && atLocation.dep !== undefined) {
      return atLocation.dep;
    }
    if (atLocation.arr !== null && atLocation.arr !== undefined) {
      return atLocation.arr;
    }
    return null;
  }

  if (atLocation.arr !== null && atLocation.arr !== undefined) {
    return atLocation.arr;
  }
  if (atLocation.dep !== null && atLocation.dep !== undefined) {
    return atLocation.dep;
  }
  return null;
}

function getHeadcodeFirstTiming(context, headcode) {
  const headcodeTimings = context.timings?.[headcode];
  if (!headcodeTimings) {
    return null;
  }

  let best = null;
  for (const [location, timing] of Object.entries(headcodeTimings)) {
    const idx = context.locationIndices?.[location];
    if (idx === undefined) {
      continue;
    }
    const time = timing.dep ?? timing.arr;
    if (time === null || time === undefined) {
      continue;
    }
    if (!best || idx < best.idx) {
      best = { location, time, idx };
    }
  }

  return best;
}

function getEstimatedHeadcodeTimeAtLocation(context, headcode, targetLocation, baseDelayMinutes) {
  const locationOrder = context.locationOrder || [];
  const headcodeTimings = context.timings?.[headcode];
  if (!headcodeTimings || !locationOrder.length) {
    return null;
  }

  const initialDelayUnits = Math.round((Number(baseDelayMinutes) || 0) * 2);
  let previousScheduled = null;
  let previousEstimated = null;

  for (const location of locationOrder) {
    const timing = headcodeTimings[location];
    if (!timing) {
      continue;
    }

    const arr = timing.arr;
    const dep = timing.dep;
    let arrEst = null;
    let depEst = null;

    if (arr !== null && arr !== undefined) {
      if (previousScheduled === null || previousEstimated === null) {
        arrEst = arr + initialDelayUnits;
      } else {
        arrEst = previousEstimated + (arr - previousScheduled);
      }
      previousScheduled = arr;
      previousEstimated = arrEst;
    }

    if (dep !== null && dep !== undefined) {
      if (arr !== null && arr !== undefined && arrEst !== null) {
        const dwellUnits = Math.max(0, dep - arr);
        const cappedDwellUnits = Math.min(dwellUnits, 1);
        depEst = Math.max(dep, arrEst + cappedDwellUnits);
      } else if (previousScheduled !== null && previousEstimated !== null) {
        depEst = previousEstimated + (dep - previousScheduled);
      } else {
        depEst = dep + initialDelayUnits;
      }
      previousScheduled = dep;
      previousEstimated = depEst;
    }

    if (location === targetLocation) {
      return depEst ?? arrEst;
    }
  }

  return null;
}

function applyInterHeadcodeStopRule(prevContext, prevHeadcode, previousDelayMinutes, nextContext, nextHeadcode) {
  if (!Number.isFinite(previousDelayMinutes) || previousDelayMinutes <= 0) {
    return previousDelayMinutes;
  }

  const nextFirst = getHeadcodeFirstTiming(nextContext, nextHeadcode);
  if (!nextFirst) {
    return previousDelayMinutes;
  }

  const prevEstimatedAtHandover = getEstimatedHeadcodeTimeAtLocation(
    prevContext,
    prevHeadcode,
    nextFirst.location,
    previousDelayMinutes
  );
  if (prevEstimatedAtHandover === null || prevEstimatedAtHandover === undefined) {
    return previousDelayMinutes;
  }

  const earliestAllowedNext = prevEstimatedAtHandover + MAX_CHAIN_STOP_HALF_MINUTES;
  const adjustedNextStart = Math.max(nextFirst.time, earliestAllowedNext);
  const adjustedDelayUnits = Math.max(0, adjustedNextStart - nextFirst.time);
  return adjustedDelayUnits / 2;
}

function getPreviousHeadcodeAtLocation(headcodeChain, targetHeadcode, targetLocation, locationOrder, locationIndices) {
  const targetIdx = locationIndices[targetLocation];
  console.log(`[getPreviousHeadcodeAtLocation] Looking for previous service that becomes ${targetHeadcode} at/before ${targetLocation} (idx: ${targetIdx})`);
  
  // First try exact match at this location
  for (const [prevHeadcode, transitions] of Object.entries(headcodeChain)) {
    for (const transition of transitions) {
      if (transition.location === targetLocation && transition.nextHeadcode === targetHeadcode) {
        console.log(`[getPreviousHeadcodeAtLocation] EXACT MATCH! ${prevHeadcode} -> ${targetHeadcode} at ${targetLocation}`);
        return prevHeadcode;
      }
    }
  }
  
  // If no exact match, look backwards from target location
  if (targetIdx !== undefined && targetIdx >= 0) {
    for (let i = targetIdx; i >= 0; i -= 1) {
      const location = locationOrder[i];
      for (const [prevHeadcode, transitions] of Object.entries(headcodeChain)) {
        for (const transition of transitions) {
          if (transition.location === location && transition.nextHeadcode === targetHeadcode) {
            console.log(`[getPreviousHeadcodeAtLocation] BACKWARD MATCH! ${prevHeadcode} -> ${targetHeadcode} at ${location} (before ${targetLocation})`);
            return prevHeadcode;
          }
        }
      }
    }
  }
  
  // If still no match, look forward from target location to handle cases where Next row is at a later stop
  if (targetIdx !== undefined && targetIdx < locationOrder.length) {
    for (let i = targetIdx + 1; i < locationOrder.length; i += 1) {
      const location = locationOrder[i];
      for (const [prevHeadcode, transitions] of Object.entries(headcodeChain)) {
        for (const transition of transitions) {
          if (transition.location === location && transition.nextHeadcode === targetHeadcode) {
            console.log(`[getPreviousHeadcodeAtLocation] FORWARD MATCH! ${prevHeadcode} -> ${targetHeadcode} at ${location} (after ${targetLocation})`);
            return prevHeadcode;
          }
        }
      }
    }
  }
  
  console.log(`[getPreviousHeadcodeAtLocation] No previous service found for ${targetHeadcode}`);
  return null;
}

function getAnticipatedDelay(delayHistory, locationOrder, locationIndices, headcodeChain, timings, headcode, targetLocation, allDelayContexts = {}, visited = new Set(), activeSheet = "") {
  let currentHeadcode = headcode;
  const targetIdx = locationIndices[targetLocation];
  if (targetIdx === undefined || targetIdx < 0) {
    return 0;
  }

  // Prevent infinite recursion
  const visitKey = `${headcode}:${targetLocation}`;
  if (visited.has(visitKey)) {
    return 0;
  }
  visited.add(visitKey);

  console.log(`[getAnticipatedDelay] Looking for delays for ${headcode} at ${targetLocation}`);

  // First, try to find a delay recorded for the current headcode at or before the target location
  for (let i = targetIdx; i >= 0; i -= 1) {
    const location = locationOrder[i];
    const headcodeHistory = delayHistory[currentHeadcode];
    if (headcodeHistory && headcodeHistory[location] !== undefined) {
      console.log(`[getAnticipatedDelay] Found delay for ${currentHeadcode} at ${location}: ${headcodeHistory[location]}`);
      return headcodeHistory[location];
    }
  }

  // If no delay found for current headcode, look for the previous service in the chain
  // Check ALL locations backward to find where the chain breaks over to the next service
  for (let i = targetIdx; i >= 0; i -= 1) {
    const location = locationOrder[i];
    const prevHeadcode = getPreviousHeadcodeAtLocation(headcodeChain, currentHeadcode, location, locationOrder, locationIndices);
    if (prevHeadcode) {
      console.log(`[getAnticipatedDelay] Found chain: ${prevHeadcode} -> ${currentHeadcode} at ${location}`);
      // Recursively get the anticipated delay for the previous service
      // This handles multi-hop chains like 5F10 -> 2C11 -> 2A11
      const prevDelay = getAnticipatedDelay(
        delayHistory,
        locationOrder,
        locationIndices,
        headcodeChain,
        timings,
        prevHeadcode,
        location,
        allDelayContexts,
        visited,
        activeSheet
      );
      if (prevDelay !== 0) {
        const adjustedDelay = applyInterHeadcodeStopRule(
          { locationOrder, locationIndices, timings },
          prevHeadcode,
          prevDelay,
          { locationOrder, locationIndices, timings },
          currentHeadcode
        );
        console.log(
          `[getAnticipatedDelay] Inherited delay from ${prevHeadcode}: ${prevDelay} -> ${adjustedDelay} after handover cap at ${location}`
        );
        return adjustedDelay;
      }
      // Continue searching further back
      currentHeadcode = prevHeadcode;
    }
  }

  // Cross-sheet chain check: Look in other sheets for a headcode that chains TO this one
  if (Object.keys(allDelayContexts).length > 0) {
    console.log(`[getAnticipatedDelay] Checking other sheets for chains TO ${currentHeadcode}`);
    for (const [sheetName, context] of Object.entries(allDelayContexts)) {
      // Look for ANY headcode in this sheet that chains to currentHeadcode
      for (const [prevHeadcode, transitions] of Object.entries(context.headcodeChain)) {
        for (const transition of transitions) {
          if (transition.nextHeadcode === currentHeadcode) {
            console.log(`[getAnticipatedDelay] Found cross-sheet chain: ${prevHeadcode} (${sheetName}) → ${currentHeadcode}`);
            // Now check if that previous headcode has delays
            const inheritedDelay = getAnticipatedDelay(
              context.history,
              context.locationOrder,
              context.locationIndices,
              context.headcodeChain,
              context.timings,
              prevHeadcode,
              transition.location,
              allDelayContexts,
              visited,
              sheetName
            );
            if (inheritedDelay !== 0) {
              const adjustedDelay = applyInterHeadcodeStopRule(
                context,
                prevHeadcode,
                inheritedDelay,
                { locationOrder, locationIndices, timings },
                currentHeadcode
              );
              console.log(
                `[getAnticipatedDelay] Using cross-sheet delay ${inheritedDelay} from ${prevHeadcode} (${sheetName}) -> ${currentHeadcode} (${activeSheet || "current"}) as ${adjustedDelay}`
              );
              return adjustedDelay;
            }
          }
        }
      }
    }
  }

  console.log(`[getAnticipatedDelay] No delay found for ${headcode} at ${targetLocation}`);
  return 0;
}

export function buildLineups(data, considerDelays = false) {
  const locations = new Set();
  const sheets = {};
  const combined = {};
  const delayContexts = {};

  for (const [sheet, info] of Object.entries(data)) {
    delayContexts[sheet] = buildDelayHistory(info);
  }

  for (const [sheet, info] of Object.entries(data)) {
    const sheetLineups = buildLineupsForSheet(info);
    Object.keys(sheetLineups).forEach((location) => locations.add(location));
    sheets[sheet] = sheetLineups;
    Object.entries(sheetLineups).forEach(([location, entries]) => {
      if (!combined[location]) {
        combined[location] = [];
      }
      entries.forEach((entry) => {
        const delayContext = delayContexts[sheet];
        const anticipatedDelay = considerDelays
          ? getAnticipatedDelay(
              delayContext.history,
              delayContext.locationOrder,
              delayContext.locationIndices,
              delayContext.headcodeChain,
              delayContext.timings,
              entry.headcode,
              location,
              delayContexts, // Pass all contexts for cross-sheet chains
              new Set(),
              sheet
            )
          : 0;
        const estimatedEntry = considerDelays
          ? buildEstimatedTimingPoints(
              [
                {
                  arrival: entry.arrival,
                  departure: entry.departure,
                },
              ],
              anticipatedDelay
            )[0]
          : null;
        combined[location].push({
          ...entry,
          sheet,
          direction: getDirectionForSheet(sheet),
          anticipatedDelay,
          estimatedArrivalUnits: estimatedEntry?.arrivalEstimatedUnits ?? null,
          estimatedDepartureUnits: estimatedEntry?.departureEstimatedUnits ?? null,
        });
      });
    });
  }

  Object.entries(combined).forEach(([location, entries]) => {
    combined[location] = entries.sort((a, b) => {
      const aKey = getLineupSortKey(a, considerDelays);
      const bKey = getLineupSortKey(b, considerDelays);
      if (aKey === null && bKey === null) {
        return a.headcode.localeCompare(b.headcode);
      }
      if (aKey === null) {
        return 1;
      }
      if (bKey === null) {
        return -1;
      }
      if (aKey !== bKey) {
        return aKey - bKey;
      }
      return a.headcode.localeCompare(b.headcode);
    });
  });

  return {
    locations: Array.from(locations).sort((a, b) => a.localeCompare(b)),
    sheets,
    combined,
    delayContexts,
  };
}

export function getAnticipatedDelayForHeadcode(delayContexts, sheet, headcode, location) {
  const delayContext = delayContexts[sheet];
  if (!delayContext) {
    return 0;
  }
  return getAnticipatedDelay(
    delayContext.history,
    delayContext.locationOrder,
    delayContext.locationIndices,
    delayContext.headcodeChain,
    delayContext.timings,
    headcode,
    location,
    delayContexts, // Pass all contexts for cross-sheet chains
    new Set(),
    sheet
  );
}
