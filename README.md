# Timetable manager

Simple Node.js app to lookup timetable rows by headcode from the WTT-UP and WTT-DOWN sheets.

## Setup

1. Create a Google service account and download `credentials.json`.
2. Share the Google Sheet with the service account email.
3. Copy `.env.example` to `.env` and set `GOOGLE_SHEETS_CREDENTIALS` if needed.
3. Install dependencies:

```
npm install
```

## Run

```
npm start
```

Then open http://localhost:3000 and enter a headcode.
