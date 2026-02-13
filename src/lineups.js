import { parseDelayFromNote, parseTimeToMinutes } from "./utils.js";

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
        };
      if (type === "arr") {
        entry.arrival = value;
        entry.arrivalNote = note;
      } else if (type === "dep") {
        entry.departure = value;
        entry.departureNote = note;
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
  const parsed = parseTimeToMinutes(time);
  if (parsed === null) {
    return null;
  }
  if (!considerDelays || !entry.anticipatedDelay) {
    return parsed;
  }
  return parsed + entry.anticipatedDelay;
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

  return { history, locationOrder, locationIndices, headcodeChain };
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

function getAnticipatedDelay(delayHistory, locationOrder, locationIndices, headcodeChain, headcode, targetLocation) {
  let currentHeadcode = headcode;
  const targetIdx = locationIndices[targetLocation];
  if (targetIdx === undefined || targetIdx < 0) {
    return 0;
  }

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
      const prevDelay = getAnticipatedDelay(delayHistory, locationOrder, locationIndices, headcodeChain, prevHeadcode, location);
      if (prevDelay !== 0) {
        console.log(`[getAnticipatedDelay] Inherited delay from ${prevHeadcode}: ${prevDelay}`);
        return prevDelay;
      }
      // Continue searching further back
      currentHeadcode = prevHeadcode;
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
              entry.headcode,
              location
            )
          : 0;
        combined[location].push({
          ...entry,
          sheet,
          direction: getDirectionForSheet(sheet),
          anticipatedDelay,
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
    headcode,
    location
  );
}
