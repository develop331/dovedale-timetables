import { loadData } from "./src/sheets.js";
import { buildDelayHistory } from "./src/lineups.js";

async function debugDelayPropagation() {
  console.log("=== TIMETABLE SNAPSHOT & DELAY PROPAGATION DEBUG ===\n");
  
  try {
    const data = await loadData();
    
    for (const [sheet, info] of Object.entries(data)) {
      console.log(`\n### SHEET: ${sheet} ###`);
      console.log(`Headers: ${info.headers.slice(0, 10).join(", ")}...`);
      
      // Find 2C11 and 2A11 columns
      const c11Index = info.headers.findIndex(h => h.includes("2C11"));
      const a11Index = info.headers.findIndex(h => h.includes("2A11"));
      
      console.log(`\n2C11 column index: ${c11Index}`);
      console.log(`2A11 column index: ${a11Index}`);
      
      if (c11Index >= 0) {
        console.log(`\n--- 2C11 Data ---`);
        info.rows.forEach((row, idx) => {
          const location = info.rowLabels[idx];
          const type = row[1]?.value || "";
          const cell = row[c11Index] || {};
          if (location || cell.value || cell.note) {
            console.log(`${location.padEnd(20)} [${type.padEnd(4)}] value: "${cell.value}" note: "${cell.note}"`);
          }
        });
      }
      
      if (a11Index >= 0) {
        console.log(`\n--- 2A11 Data ---`);
        info.rows.forEach((row, idx) => {
          const location = info.rowLabels[idx];
          const type = row[1]?.value || "";
          const cell = row[a11Index] || {};
          if (location || cell.value || cell.note) {
            console.log(`${location.padEnd(20)} [${type.padEnd(4)}] value: "${cell.value}" note: "${cell.note}"`);
          }
        });
      }
      
      // Build delay history and check for chains
      console.log(`\n--- Delay History & Chains ---`);
      const delayContext = buildDelayHistory(info);
      
      console.log(`\nLocation Order: ${delayContext.locationOrder.join(", ")}`);
      
      console.log(`\nHeadcode Chains:`);
      for (const [headcode, transitions] of Object.entries(delayContext.headcodeChain)) {
        if (headcode.includes("2C11") || headcode.includes("2A11")) {
          console.log(`  ${headcode}:`);
          transitions.forEach(t => {
            console.log(`    At ${t.location} -> ${t.nextHeadcode}`);
          });
        }
      }
      
      console.log(`\nDelay History:`);
      for (const [headcode, locations] of Object.entries(delayContext.history)) {
        if (headcode.includes("2C11") || headcode.includes("2A11")) {
          console.log(`  ${headcode}:`);
          for (const [location, delay] of Object.entries(locations)) {
            console.log(`    ${location}: ${delay > 0 ? '+' : ''}${delay} min`);
          }
        }
      }
      
      // Check if there are any "Next" rows
      console.log(`\n--- Looking for "Next" Rows ---`);
      info.rows.forEach((row, idx) => {
        const location = info.rowLabels[idx];
        if (location.toLowerCase() === "next") {
          console.log(`Found "Next" row at index ${idx}`);
          const type = row[1]?.value || "";
          console.log(`  Type column: "${type}"`);
          if (c11Index >= 0) {
            const c11Cell = row[c11Index] || {};
            console.log(`  2C11 column: "${c11Cell.value}"`);
          }
          if (a11Index >= 0) {
            const a11Cell = row[a11Index] || {};
            console.log(`  2A11 column: "${a11Cell.value}"`);
          }
        }
      });
    }
    
  } catch (err) {
    console.error("Error:", err);
  }
}

debugDelayPropagation();
