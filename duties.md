# Duties Feature

This document describes the v2 duties flow for the timetable app.

## Goal

Add a driver-facing view where a user can book on by duty number and immediately see every service that belongs to that duty in a simple, easy-to-scan timetable UI.

## Core Rule

Each chain belongs to a duty number.

- The duty number is taken from the third character in the headcode.
- Example: `1A10` belongs to duty `1`.

## Required Behaviour

- A user should be able to enter or select a duty number to access their services.
- The duty screen should show all services for that duty.
- Services should be presented in the same general timetable style used today.
- Services should appear one after another on the page, in duty order.
- The existing lineups feature must remain unchanged.

## UX Intent

- Keep the duty screen fast to read during operational use.
- Make it obvious which services belong to the signed-on duty.
- Avoid forcing duty operators to search by individual headcode when they already know the duty number.

## Data Model Assumptions

- Duty grouping is derived from the headcode, not a separate user record.
- A duty may contain multiple chains and multiple services.
- The app should treat duty views as a filtered presentation of existing timetable data rather than a separate timetable source.

## Presentation

- Reuse the existing timetable detail layout where possible.
- Render each matching service in sequence on the same page.
- Preserve the existing service detail information such as locations, arrival/departure times, platforms, and notes.

## Non-Goals

- Do not change the lineups screen.
- Do not redesign the core timetable data source.
- Do not require the user to search by headcode first when the duty number is already known.

## Acceptance Criteria

- Given a duty number, the app can find every service whose headcode maps to that duty.
- The duty page shows those services in a readable sequence.
- The lineup view continues to work as before.