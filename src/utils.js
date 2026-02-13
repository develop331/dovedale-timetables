export function normalizeHeadcode(value) {
  return String(value || "").trim().toUpperCase();
}

export function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function parseTimeToMinutes(value) {
  const cleaned = String(value || "").replace(/H/gi, "");
  const match = cleaned.match(/(\d{1,2})\s*[.:\/ Rt]\s*(\d{2})/);
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return null;
  }
  return (hours % 24) * 60 + (minutes % 60);
}

export function formatMinutesToTime(totalMinutes) {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, "0")}.${String(minutes).padStart(2, "0")}`;
}

export function buildNoteFromActual(scheduled, actualInput, type) {
  const raw = String(actualInput || "").trim();
  if (!raw) {
    return { error: "Enter an actual value." };
  }

  if (type === "plt") {
    return { note: raw, delta: null };
  }

  if (/^ot$/i.test(raw) || /^on\s*time$/i.test(raw)) {
    return { note: "OT", delta: 0 };
  }

  const actualMinutes = parseTimeToMinutes(raw);
  if (actualMinutes === null) {
    return { error: "Actual time is not valid." };
  }

  const scheduledMinutes = parseTimeToMinutes(scheduled);
  if (scheduledMinutes === null) {
    return { error: "Scheduled time is not valid." };
  }

  const delta = actualMinutes - scheduledMinutes;
  if (delta === 0) {
    return { note: "OT", delta: 0 };
  }

  const offset = Math.abs(delta);
  const suffix = delta > 0 ? "L" : "E";
  return { note: `${offset}${suffix}`, delta };
}

function lerpColor(start, end, t) {
  return {
    red: start.red + (end.red - start.red) * t,
    green: start.green + (end.green - start.green) * t,
    blue: start.blue + (end.blue - start.blue) * t,
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function getDelayStyle(deltaMinutes) {
  const blue = { red: 0.2, green: 0.45, blue: 0.95 };
  const green = { red: 0.2, green: 0.7, blue: 0.35 };
  const yellow = { red: 0.98, green: 0.85, blue: 0.25 };
  const orange = { red: 0.96, green: 0.55, blue: 0.2 };
  const red = { red: 0.9, green: 0.25, blue: 0.2 };
  const darkRed = { red: 0.55, green: 0.08, blue: 0.08 };

  if (deltaMinutes <= -5) {
    return { background: blue };
  }
  if (deltaMinutes < 0) {
    const t = clamp((deltaMinutes + 5) / 5, 0, 1);
    return { background: lerpColor(blue, green, t) };
  }
  if (deltaMinutes === 0) {
    return { background: green };
  }

  if (deltaMinutes <= 1) {
    const t = clamp(deltaMinutes / 1, 0, 1);
    return { background: lerpColor(green, yellow, t) };
  }
  if (deltaMinutes <= 4) {
    const t = clamp((deltaMinutes - 1) / 3, 0, 1);
    return { background: lerpColor(yellow, orange, t) };
  }
  if (deltaMinutes <= 7) {
    const t = clamp((deltaMinutes - 4) / 3, 0, 1);
    return { background: lerpColor(orange, red, t) };
  }
  if (deltaMinutes < 10) {
    const t = clamp((deltaMinutes - 7) / 3, 0, 1);
    return { background: lerpColor(red, darkRed, t) };
  }

  return { background: darkRed, text: { red: 1, green: 1, blue: 1 } };
}

export function parseDelayFromNote(note) {
  const trimmed = String(note || "").trim();
  if (!trimmed || /^ot$/i.test(trimmed) || /^on\s*time$/i.test(trimmed)) {
    return 0;
  }
  const match = trimmed.match(/(\d+)([LE])/i);
  if (!match) {
    return null;
  }
  const minutes = Number(match[1]);
  const suffix = match[2].toUpperCase();
  return suffix === "L" ? minutes : -minutes;
}
