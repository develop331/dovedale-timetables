import express from "express";

import { PORT } from "./src/config.js";
import { registerRoutes } from "./src/routes.js";

const app = express();
console.log("Starting timetable server...");
app.use(express.json());

registerRoutes(app);

app.listen(PORT, () => {
  console.log(`Timetable app running on http://localhost:${PORT}`);
}).on("error", (err) => {
  console.error("Server failed to start:", err.message);
});
