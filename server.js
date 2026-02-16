import express from "express";
import https from "https";
import fs from "fs";

import { PORT, HTTPS_CONFIG } from "./src/config.js";
import { registerRoutes } from "./src/routes.js";

const app = express();
console.log("Starting timetable server...");
app.use(express.json());

registerRoutes(app);

if (HTTPS_CONFIG) {
  const httpsOptions = {
    cert: fs.readFileSync(HTTPS_CONFIG.cert),
    key: fs.readFileSync(HTTPS_CONFIG.key)
  };
  
  https.createServer(httpsOptions, app).listen(HTTPS_CONFIG.port, () => {
    console.log(`Timetable app running on https://localhost:${HTTPS_CONFIG.port}`);
  }).on("error", (err) => {
    console.error("HTTPS server failed to start:", err.message);
  });
} else {
  app.listen(PORT, () => {
    console.log(`Timetable app running on http://localhost:${PORT}`);
  }).on("error", (err) => {
    console.error("Server failed to start:", err.message);
  });
}
