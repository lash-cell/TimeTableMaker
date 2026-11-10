# TimeTableMaker: AI Handoff Brief

## What this project does

TimeTableMaker is a local timetable builder for one teacher on one computer. It imports course and teacher data,
checks the input, schedules lessons, validates the result independently, and presents or exports timetables.
Scheduling uses Google OR-Tools CP-SAT through a local Python subprocess; the app, importer, and independent
checker are Node.js. Data and run history are stored locally in SQLite.

## Current state

- Backend: built and tested; the partner UI is not included yet.
- Main workflow routes are implemented. The optional settings/AI feature is not; `POST /api/ai/propose` returns
  `ai_off`.
- The server binds to `127.0.0.1:5000`. It does not expose a cloud service. Browser access from a different
  origin has not been configured with CORS; use a same-origin development proxy or coordinate a local bridge
  before relying on cross-origin `fetch`.
- API contracts are described in the approved `all_tableplan/restart/app/routes.md`; shapes are in
  `all_tableplan/restart/shapes.md`.

## Start the backend

From the project directory:

```bash
npm install
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
npm start
```

Set `TIMETABLEMAKER_PYTHON` if the Python executable is elsewhere. PDF export also requires LibreOffice.
Run `npm test` for the backend suite.

## Main UI flow

1. `GET /api/data` loads saved input; a fresh installation returns an empty input with guideline time defaults.
2. Import with raw `.xlsx` bytes to `POST /api/data/upload` and URL-encoded `X-File-Name`, or paste tab-separated
   spreadsheet rows to `POST /api/data/paste` with `{ "section": "courses"|"teachers", "year": "...", "text": "..." }`.
   Both return a match proposal. Upload is capped at 30 MB; only `.xlsx` is supported.
3. Let the teacher correct the returned sheet/column matches, then send the **whole proposal JSON** to
   `POST /api/data/match`. The proposal includes `sheets`, `sourceSheets`, `fileName`, and
   `readerReviewItems`; `sourceSheets` must be preserved because it contains the source rows. The response is the
   resulting Input data.
4. `PUT /api/data` saves teacher-edited Input data. The backend revalidates it and always clears `confirmed`.
   Use `GET /api/data/template` for the Excel template and `GET /api/data/guide` for field guidance.
5. `POST /api/check` analyzes the saved input, even before confirmation. Resolve ReviewItems and validation issues,
   then `POST /api/data/confirm`. A non-empty review list or invalid input returns `not_confirmed`.
6. `POST /api/runs` starts a run from the **saved, confirmed input** (no request body). Poll
   `GET /api/runs/{id}` until it finishes. Only one run can be active at a time; cancellation is
   `POST /api/runs/{id}/cancel`.
7. For a finished feasible run use `GET /api/runs/{id}/view?kind=group|teacher|room|course`, optionally with a
   `key`; `POST .../recheck`; `POST .../choose`; and `GET .../export.xlsx` or `GET .../export.pdf`.
   History is `GET /api/runs`; compare two saved run IDs with
   `GET /api/runs/compare?a={id}&b={id}`.

## Integration expectations

- JSON API errors have the shape `{ "error": { "code": "...", "message": "..." } }`; messages are Thai.
- Downloads are binary responses, not JSON. Use `Content-Disposition` or the known route to save them.
- Do not calculate timetable rules or pass/fail results in the UI. Show the backend Analysis and Report.
- Input, run, lesson, Analysis, Report, and View object shapes are defined in `shapes.md`.
- IDs contain only letters, digits, and hyphens. Encode URL query values normally; invalid path IDs return
  `bad_input`.
- `GET /api/health` returns `{ "ok": true, "version": "1.0.0" }`.

## Known scope limits

- No frontend, authentication, CORS policy, settings UI, AI provider, CSV/XLS/PDF import, or multi-user/network
  service is included.
- Excel upload currently returns internal source rows as part of the match proposal; send that proposal back to
  `/api/data/match` intact after editing its column mappings.
- A legacy synchronous `POST /api/timetable` route remains for compatibility; the primary UI workflow should use
  persisted input and asynchronous `/api/runs`.
