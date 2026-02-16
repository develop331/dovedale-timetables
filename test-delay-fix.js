import { loadData } from "./src/sheets.js";
import { buildLineups } from "./src/lineups.js";

async function testDelayPropagation() {
  console.log("=== TESTING DELAY PROPAGATION: 2C11 → 2A11 ===\n");
  
  try {
    const data = await loadData();
    
    // Build lineups with delays enabled
    const lineups = buildLineups(data, true);
    
    // Find 2A11 in the lineups
    for (const [location, entries] of Object.entries(lineups.combined)) {
      const entry2A11 = entries.find(e => e.headcode === "2A11");
      if (entry2A11 && entry2A11.anticipatedDelay !== 0) {
        console.log(`\n✅ SUCCESS! Found 2A11 at ${location}`);
        console.log(`   Anticipated Delay: ${entry2A11.anticipatedDelay > 0 ? '+' : ''}${entry2A11.anticipatedDelay} minutes`);
        console.log(`   Sheet: ${entry2A11.sheet}`);
        console.log(`   Departure: ${entry2A11.departure}`);
      }
    }
    
    console.log("\n=== All 2A11 entries ===");
    for (const [location, entries] of Object.entries(lineups.combined)) {
      const entry2A11 = entries.find(e => e.headcode === "2A11");
      if (entry2A11) {
        const delay = entry2A11.anticipatedDelay;
        const delayStr = delay === 0 ? "no delay" : `${delay > 0 ? '+' : ''}${delay} min`;
        console.log(`${location.padEnd(25)} → ${delayStr}`);
      }
    }
    
  } catch (err) {
    console.error("Error:", err);
  }
}

testDelayPropagation();
