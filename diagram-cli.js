#!/usr/bin/env node

import { loadData } from "./src/sheets.js";
import { exportTimingDiagrams } from "./src/diagrams.js";
import { resolve } from "path";

const args = process.argv.slice(2);

if (args.includes("-h") || args.includes("--help")) {
  console.log(`
Timing Diagram Generator

Usage:
  node diagram-cli.js [options]

Options:
  -o, --output <path>    Output PDF file (default: timing_diagram.pdf)
  -h, --help             Show this help message
  
Example:
  node diagram-cli.js -o reports/my_diagram.pdf
  `);
  process.exit(0);
}

let outputPath = "timing_diagram.pdf";

for (let i = 0; i < args.length; i++) {
  if ((args[i] === "-o" || args[i] === "--output") && i + 1 < args.length) {
    outputPath = args[i + 1];
    i++;
  }
}

async function main() {
  try {
    console.log("[timing-diagram] Loading sheets data...");
    const data = await loadData();
    
    console.log("[timing-diagram] Generating diagrams...");
    const fullPath = resolve(outputPath);
    await exportTimingDiagrams(data, fullPath);
    
    console.log(`[timing-diagram] ✓ Diagrams written to: ${fullPath}`);
  } catch (err) {
    console.error("[timing-diagram] Error:", err instanceof Error ? err.message : err);
  }
}

// Run initially
await main();

// Refresh every 20 seconds
console.log("[timing-diagram] Starting refresh cycle (every 20 seconds)...");
setInterval(main, 20000);
