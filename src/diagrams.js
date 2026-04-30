import PDFDocument from "pdfkit";
import { createWriteStream } from "fs";
import { dirname } from "path";
import { mkdirSync } from "fs";
import { formatHalfMinutesToTime, parseTimeToHalfMinutes, getDelayStyle } from "./utils.js";
import { buildDelayHistory } from "./lineups.js";

/**
 * Convert RGB object from getDelayStyle to PDF color [r, g, b] 0-255
 */
function rgbToPdfColor(rgbObj) {
  if (!rgbObj) return [0, 0, 0];
  return [
    Math.round(rgbObj.red * 255),
    Math.round(rgbObj.green * 255),
    Math.round(rgbObj.blue * 255),
  ];
}

/**
 * Extract location order from sheets data
 */
function getLocationOrder(data) {
  const locations = new Set();
  for (const [, info] of Object.entries(data)) {
    (info.rowLabels || []).forEach((label) => {
      const loc = String(label || "").trim();
      if (loc && loc.toLowerCase() !== "next") {
        locations.add(loc);
      }
    });
  }
  return Array.from(locations);
}

/**
 * Build service array from sheets data
 */
function buildServices(data) {
  const services = [];
  
  for (const [sheet, info] of Object.entries(data)) {
    const delayContext = buildDelayHistory(info);
    const { history, timings, locationOrder } = delayContext;
    
    // Get headers and build services
    for (let col = 2; col < (info.headers || []).length; col++) {
      const headcode = String(info.headers[col] || "").trim();
      if (!headcode) continue;
      
      const stops = [];
      let hasTimedStop = false;
      
      for (const location of locationOrder) {
        const timing = timings?.[headcode]?.[location];
        if (!timing || (!timing.arr && !timing.dep)) continue;
        
        // Get delays for arrival and departure (if recorded), otherwise use 0 (scheduled time)
        const arrivalDelayData = history?.[headcode]?.[location];
        const arrivalDelay = arrivalDelayData?.arr !== undefined ? arrivalDelayData.arr : 0;
        const departureDelay = arrivalDelayData?.dep !== undefined ? arrivalDelayData.dep : 0;
        
        const hasRecordedArrivalDelay = arrivalDelayData?.arr !== undefined;
        const hasRecordedDepartureDelay = arrivalDelayData?.dep !== undefined;
        
        const stop = {
          name: location,
          scheduled: {
            arr: timing.arr,
            dep: timing.dep,
          },
          arrivalDelay,
          departureDelay,
          hasRecordedArrivalDelay,
          hasRecordedDepartureDelay,
          arrivalEstimated: null,
          departureEstimated: null,
        };
        
        // Calculate estimated times using delay propagation logic
        if (stops.length > 0) {
          const prevStop = stops[stops.length - 1];
          const prevScheduledDep = prevStop.scheduled.dep ?? prevStop.scheduled.arr;
          const prevEstimatedDep = prevStop.departureEstimated ?? prevStop.arrivalEstimated;
          
          if (timing.arr !== null && prevScheduledDep !== null && prevEstimatedDep !== null) {
            stop.arrivalEstimated = prevEstimatedDep + (timing.arr - prevScheduledDep);
          } else if (timing.arr !== null) {
            stop.arrivalEstimated = timing.arr + (arrivalDelay * 2);
          }
          
          if (timing.dep !== null && prevScheduledDep !== null && prevEstimatedDep !== null) {
            const dwellScheduled = Math.max(0, timing.dep - timing.arr) || 0;
            const cappedDwell = Math.min(dwellScheduled, 1); // Cap dwell at 30 seconds
            const minDepTime = (stop.arrivalEstimated ?? prevEstimatedDep) + cappedDwell;
            stop.departureEstimated = Math.max(timing.dep, minDepTime);
          } else if (timing.dep !== null) {
            stop.departureEstimated = timing.dep + (departureDelay * 2);
          }
        } else {
          // First stop
          if (timing.arr !== null) {
            stop.arrivalEstimated = timing.arr + (arrivalDelay * 2);
          }
          if (timing.dep !== null) {
            stop.departureEstimated = timing.dep + (departureDelay * 2);
          }
        }
        
        stops.push(stop);
        hasTimedStop = true;
      }
      
      if (hasTimedStop) {
        services.push({
          name: headcode,
          sheet,
          columnIndex: col,
          stops,
          hasRecordedDelays: stops.some(s => s.hasRecordedArrivalDelay || s.hasRecordedDepartureDelay),
        });
      }
    }
  }
  
  return services;
}

/**
 * Get direction from sheet name
 */
function getDirection(sheetName) {
  const upper = String(sheetName || "").toUpperCase();
  if (upper.includes("UP")) return "U";
  if (upper.includes("DOWN")) return "D";
  return "";
}

/**
 * Split services by direction based on station order
 */
function splitByDirection(services, locations) {
  const locationIndex = Object.fromEntries(locations.map((l, i) => [l, i]));
  const up = [];
  const down = [];
  
  for (const svc of services) {
    if (!svc.stops.length) continue;
    const timedStops = svc.stops.filter((s) => s.arrivalEstimated !== null || s.departureEstimated !== null);
    if (timedStops.length < 2) continue;
    
    const firstIdx = locationIndex[timedStops[0].name];
    const lastIdx = locationIndex[timedStops[timedStops.length - 1].name];
    
    if (firstIdx === undefined || lastIdx === undefined) continue;
    
    if (lastIdx > firstIdx) {
      down.push(svc);
    } else {
      up.push(svc);
    }
  }
  
  return { up, down };
}

/**
 * Get time range from services
 */
function getTimeRange(services, minuteGrid = 10) {
  const times = [];
  
  for (const svc of services) {
    for (const stop of svc.stops) {
      if (stop.arrivalEstimated !== null) times.push(stop.arrivalEstimated);
      if (stop.departureEstimated !== null) times.push(stop.departureEstimated);
    }
  }
  
  if (!times.length) {
    return [8 * 120, 12 * 120]; // Default 8:00 - 12:00 in half-minutes
  }
  
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const minGridUnits = Math.floor(minTime / minuteGrid) * minuteGrid;
  const maxGridUnits = Math.ceil(maxTime / minuteGrid) * minuteGrid;
  
  // Ensure minimum 180 minute (3 hour) range
  if (maxGridUnits - minGridUnits < 360) {
    return [minGridUnits, minGridUnits + 360];
  }
  
  return [minGridUnits, maxGridUnits];
}

/**
 * Draw a timing diagram page
 */
function drawDiagramPage(doc, services, locations, title, timeMin, timeMax) {
  const marginMm = 15;
  const margin = marginMm * 2.834645669; // mm to points
  const pageWidth = doc.page.width;
  const pageHeight = doc.page.height;
  
  const plotX0 = margin;
  const plotY0 = margin + 20;
  const plotX1 = pageWidth - margin;
  const plotY1 = pageHeight - margin - 30;
  
  const locationIndex = Object.fromEntries(locations.map((l, i) => [l, i]));
  
  // Coordinate transformation functions
  const xForTime = (halfMinutes) => plotX0 + ((halfMinutes - timeMin) / (timeMax - timeMin)) * (plotX1 - plotX0);
  const yForLocation = (location) => {
    const idx = locationIndex[location] ?? 0;
    return plotY1 - (idx / Math.max(1, locations.length - 1)) * (plotY1 - plotY0);
  };
  
  // Draw title
  doc.fontSize(14).font("Helvetica-Bold").text(title, margin, margin);
  
  // Draw grid lines
  doc.strokeColor("#d3d3d3").lineWidth(0.5);
  
  // Horizontal lines (stations)
  for (const location of locations) {
    const y = yForLocation(location);
    doc.moveTo(plotX0, y).lineTo(plotX1, y).stroke();
  }
  
  // Vertical lines (time)
  const gridInterval = 10 * 2; // 10-minute intervals in half-minutes
  for (let t = timeMin; t <= timeMax; t += gridInterval) {
    const x = xForTime(t);
    doc.moveTo(x, plotY0).lineTo(x, plotY1).stroke();
  }
  
  // Draw box around plot
  doc.strokeColor("black").lineWidth(1);
  doc.rect(plotX0, plotY0, plotX1 - plotX0, plotY1 - plotY0).stroke();
  
  // Draw station labels (left side)
  doc.fontSize(9).fillColor("black");
  for (const location of locations) {
    const y = yForLocation(location);
    doc.text(location, plotX0 - 45, y - 4, { width: 40, align: "right" });
  }
  
  // Draw time labels (bottom)
  doc.fontSize(8);
  for (let t = timeMin; t <= timeMax; t += gridInterval) {
    const x = xForTime(t);
    const hours = Math.floor(t / 120);
    const mins = Math.floor((t % 120) / 2);
    const timeStr = `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
    doc.text(timeStr, x - 15, plotY1 + 5, { width: 30, align: "center" });
  }
  
  // Draw services
  for (const service of services) {
    const timedStops = service.stops.filter((s) => s.arrivalEstimated !== null || s.departureEstimated !== null);
    if (timedStops.length < 1) continue;
    
    // Determine line color based on whether service has recorded delays
    const lineColor = service.hasRecordedDelays ? "black" : "#999999";
    
    // Draw service lines between stops as dotted lines
    for (let i = 0; i < timedStops.length - 1; i++) {
      const stopA = timedStops[i];
      const stopB = timedStops[i + 1];
      
      const timeA = stopA.departureEstimated ?? stopA.arrivalEstimated;
      const timeB = stopB.arrivalEstimated ?? stopB.departureEstimated;
      
      if (timeA !== null && timeB !== null && timeA >= timeMin && timeB <= timeMax) {
        const xA = xForTime(timeA);
        const xB = xForTime(timeB);
        const yA = yForLocation(stopA.name);
        const yB = yForLocation(stopB.name);
        
        // Draw dotted line between stops
        doc.strokeColor(lineColor).lineWidth(1).dash(2, { space: 2 });
        doc.moveTo(xA, yA).lineTo(xB, yB).stroke();
        doc.undash();
      }
    }
    
    // Draw dwell bars (from ARR to DEP at same station)
    for (const stop of timedStops) {
      if (stop.arrivalEstimated !== null && stop.departureEstimated !== null) {
        const tArr = stop.arrivalEstimated;
        const tDep = stop.departureEstimated;
        
        if (tArr >= timeMin && tDep <= timeMax) {
          const xA = xForTime(tArr);
          const xD = xForTime(tDep);
          const y = yForLocation(stop.name);
          
          const dwellColor = stop.hasRecordedDepartureDelay ? "black" : "#999999";
          doc.strokeColor(dwellColor).lineWidth(2);
          doc.moveTo(xA, y).lineTo(xD, y).stroke();
        }
      }
    }
    
    // Draw stop points using the delay palette, or grey if no recorded delay
    for (const stop of timedStops) {
      const timePoint = stop.departureEstimated ?? stop.arrivalEstimated;
      if (timePoint !== null && timePoint >= timeMin && timePoint <= timeMax) {
        const x = xForTime(timePoint);
        const y = yForLocation(stop.name);

        // Determine which delay to use for coloring (arrival or departure)
        const hasRecordedDelay = (stop.departureEstimated !== null && stop.hasRecordedDepartureDelay) ||
                                 (stop.departureEstimated === null && stop.hasRecordedArrivalDelay);
        const delayForColor = stop.departureEstimated !== null ? stop.departureDelay : stop.arrivalDelay;
        
        let dotColor;
        if (hasRecordedDelay) {
          const style = getDelayStyle(delayForColor ?? 0);
          dotColor = rgbToPdfColor(style.background);
        } else {
          // Grey color for stops without recorded delays
          dotColor = [153, 153, 153]; // #999999 in RGB
        }
        doc.fillColor(dotColor).circle(x, y, 2).fill();
      }
    }
    
    // Draw service label near first stop
    if (timedStops.length > 0) {
      const firstStop = timedStops[0];
      const timeLabel = firstStop.departureEstimated ?? firstStop.arrivalEstimated;
      if (timeLabel !== null && timeLabel >= timeMin && timeLabel <= timeMax) {
        const x = xForTime(timeLabel);
        const y = yForLocation(firstStop.name);
        
        const labelColor = service.hasRecordedDelays ? "black" : "#999999";
        doc.fontSize(7).fillColor(labelColor).text(service.name, x + 3, y - 8);
      }
    }
  }
}

/**
 * Export timing diagrams from sheets data
 */
export async function exportTimingDiagrams(data, outputPath) {
  // Extract data
  const locations = getLocationOrder(data);
  if (locations.length < 2) {
    throw new Error("Insufficient locations to generate diagrams");
  }
  
  const services = buildServices(data);
  if (!services.length) {
    throw new Error("No services with timing data found");
  }
  
  const { up, down } = splitByDirection(services, locations);
  const [timeMin, timeMax] = getTimeRange([...up, ...down], 20);
  
  // Create output directory if needed
  const dir = dirname(outputPath);
  if (dir && dir !== ".") {
    mkdirSync(dir, { recursive: true });
  }
  
  // Create PDF
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ layout: "landscape", margin: 0 });
      const stream = createWriteStream(outputPath);
      
      doc.pipe(stream);
      
      // Combine UP and DOWN services for merged diagram
      const allServices = [...up, ...down];
      
      // Draw combined services page with both UP and DOWN
      if (allServices.length > 0) {
        drawDiagramPage(doc, allServices, locations, "Timing Diagram - UP and DOWN Services", timeMin, timeMax);
      }
      
      doc.end();
      
      stream.on("finish", () => {
        resolve(outputPath);
      });
      
      stream.on("error", reject);
      doc.on("error", reject);
    } catch (err) {
      reject(err);
    }
  });
}
