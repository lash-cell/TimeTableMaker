# TimeTableMaker 1.0

A local timetable tool for one teacher on one computer, built to the final plan in
the approved local project plan (`all_tableplan/restart/`).

## Runtime stack

- Node.js, current LTS, plain JavaScript
- Google OR-Tools CP-SAT 9.15.6755, called by Node.js through a local Python subprocess
- Python 3.10 or newer for the solver backend
- LibreOffice for PDF export
- Built-in `node:http` web server and `node:test`
- ExcelJS 4.4.0 for `.xlsx` reading
- Runtime binds only to `127.0.0.1`
- ExcelJS and OR-Tools are the external runtime dependencies

## Run

Install the solver dependency once:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
```

On Windows, use `.venv\Scripts\python.exe` in place of `.venv/bin/python`. To use another Python
installation, set `TIMETABLEMAKER_PYTHON` to its executable path.

Start the app:

```bash
npm start
```

The app exposes a localhost-only interface at `http://127.0.0.1:5000`. It does not contact a remote service.
The partner UI can use the routes in the approved `all_tableplan/restart/app/routes.md` contract:

- Data: `GET/PUT /api/data`, `POST /api/data/upload`, `/api/data/paste`, `/api/data/match`, and `/api/data/confirm`
- Input help: `GET /api/data/template` and `/api/data/guide`
- Check and generation: `POST /api/check`, `POST /api/runs`, then poll `GET /api/runs/{id}`
- Results: run view, recheck, comparison, choose, Excel, and PDF export routes

The server binds only to `127.0.0.1`; uploaded workbooks and timetable data are processed and stored locally.
Schedules are checked by the independent JavaScript checker before results are saved.

Run tests, including the dataset-literal scan, with:

```bash
npm test
```

See [TOOLS_AND_TECHNIQUES.md](./TOOLS_AND_TECHNIQUES.md) for the actual stack, spike tools, techniques, and
verification limitations recorded so far.
For a frontend/AI coding handoff, see [PARTNER_AI_BRIEF.md](./PARTNER_AI_BRIEF.md).

## Current task

T0-T24 implementation checks pass. T7's English-header reader fixture was translated from the original Thai XLSX,
preserving course and teacher data; two source formulas have no cached results and therefore produce ReviewItems.
T8 matches Thai and English headers from `words.json`, including a reversed-column workbook. T9 converts rows into
the input contract, records skipped rows and review items, and warns/deduplicates when Thai and English copies are
both imported. T10's standalone checker validates F2 and catches 13 rule-specific breaks. T11 expands input courses
into shared theory and per-group practical placement
tasks. T12 checks arithmetic feasibility in layers: F1 passes with 36/37/34 weekly periods and 159 counted teacher
periods; F3 is infeasible because Thursday and Friday period 1 each need six teachers, while five are available.
F1 analysis completes in under one second. The production timetable endpoint now uses OR-Tools CP-SAT through the
local Python backend while the app, input pipeline, and independent checker remain in Node.js. F1 is checker-valid
in a standalone 2.8-second end-to-end run here; the automated test enforces the 10-second ceiling. F2 and
required-room availability tests also pass. T16 distinguishes proven `infeasible` results from `searchLimit`,
reports whether time or the configured step budget stopped search, includes solver and candidate-rejection
measurements, and labels constraint-relaxation results as likely causes rather than proof. T17 adds a seeded,
checker-gated late-acceptance stage with score history; F1's score improved from 279 to 275 in a measured run.
T18 adds asynchronous start/poll/cancel runs, persists run snapshots and results in SQLite under ignored `data/`,
marks interrupted jobs after restart, and keeps health responsive while CP-SAT runs.
T19 builds complete group, teacher, room, and course views from saved results. T20 adds rubric reports, assumptions,
run comparisons, and exclusive run selection. T21 exports merged-cell Excel workbooks. T22 uses headless LibreOffice
to export one landscape PDF page per group; the F1 first page was rendered and visually inspected for Thai shaping
and visible course codes. T23 adds the planned localhost route contracts, structured Thai error responses, persisted
editable input, and run-result operations. T24 adds pasted spreadsheet rows, workbook templates, and a field guide
from one shared definition; pasted F1 course rows match the upload importer. Optional T25 AI and settings are not
implemented. No partner UI is included in this repository yet.
Task checkmarks remain owner-controlled.
The runtime `data/` directory is ignored by Git; `words.json` and `defaults.json` are shipped
configuration, not runtime data.
