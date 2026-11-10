# Tools, stack, and techniques used

This log records what has actually been used while building TimeTableMaker 1.0. The runtime plan was deliberately
extended to integrate the validated open-source CP-SAT solver; the app, importer, and independent checker remain
Node.js.

## Owner-approved solver decision

The original stack plan preferred a Node.js-only scheduler and prohibited Python for application logic. After the
Node.js search, MRV, workload-bound, and LCV implementations failed to place F1 within its 10-second target, the
owner explicitly approved integrating OR-Tools CP-SAT. Python is therefore used only for the local solver
subprocess; Node.js still owns the application, input pipeline, analysis, routes, and independent checker. CP-SAT
jointly models lesson timing, teachers, rooms, and workload rather than requiring the planned two-phase retry loop.

## Current project stack

| Area | Used | Current status |
|---|---|---|
| Application runtime | Node.js 24.22.0, plain JavaScript | HTTP app, importer, input analysis, and independent checker |
| Browser frontend | Static HTML, CSS, and vanilla JavaScript served by `node:http` | Thai Data, Generate, and Results workflow; same-origin requests; no frontend framework |
| Scheduling runtime | Python 3.12.3 with OR-Tools CP-SAT 9.15.6755 | Production scheduler, pinned in `requirements.txt`; launched locally by Node.js |
| PDF export runtime | LibreOffice headless | Converts the ExcelJS-generated group sheets to PDF; uses the installed Noto Sans Thai font in this environment |
| Package scripts | npm 11.19.1 | `npm start` starts the app; `npm test` runs tests |
| HTTP server | Built-in `node:http` | Serves the planned local-only data, check, run, result, and export routes on `127.0.0.1:5000` |
| Tests | Built-in `node:test` and `node:assert/strict` | Health and route contracts, CP-SAT F1/F2/F5 schedules, limits, cancellation, persistence, reports, views, exports, room availability, project configuration, F1-F5 fixtures, T6-T24, and hard-coding scan |
| Storage API | Built-in `node:sqlite` | Persists editable input plus run snapshots, results, errors, state, and chosen flag in ignored `data/timetablemaker.sqlite` |
| External runtime dependencies | ExcelJS 4.4.0; OR-Tools 9.15.6755 and Python dependencies | Pinned in `package.json`/lockfile and `requirements.txt` |

## Tools used for spikes and checks

| Tool | How it was used | Current status |
|---|---|---|
| ExcelJS 4.4.0 | Read F1 and a temporary reversed-columns workbook for T1; write and read back a merged Thai timetable for T2; generate and cross-check F1/F3/F4/F5 source fixtures for T5; read plain-text workbook rows for T7; provide F1/F4 workbooks to T8/T9 tests | Approved project runtime dependency, installed offline from the npm cache |
| LibreOffice (headless) | Open and re-save the T2 XLSX; export it to PDF | Verification tool available in the environment |
| `pdftotext` | Check text extracted from the T2 PDF | Verification tool |
| `pdftoppm` | Render the first PDF page to PNG for visual inspection | Verification tool |
| `curl` | Call the local health endpoint | Verification tool |
| `npm` / Node.js CLI | Install the cached spike dependency, start the app, and run tests | Development tools |
| `node:sqlite` | Verify SQLite availability with an in-memory table, primary key, insert, and query on Node.js 24.22.0 | Built-in module; no package installed |
| Python 3.12.3 and OR-Tools CP-SAT 9.15.6755 | Integrated F1/F2 scheduling backend, with outputs checked by `engine/checker.js` | Production dependency, isolated in ignored `.venv/` |

## Techniques used

- Bound the local HTTP server explicitly to `127.0.0.1`.
- Kept the application and independent checker in Node.js and integrated OR-Tools as a local child process using
  JSON on stdin/stdout; scheduling needs no external service or network connection.
- Modeled one exact group-day shape per group/day: periods are occupied from period 1 through the day end except
  for exactly one configured break. Lesson blocks must cover only occupied periods.
- Modeled each lesson's day/start, teacher assignment, and required room as a joint Boolean candidate. Added
  at-most-one constraints for group, teacher, and room occupancy and min/max teacher-workload constraints.
- Revalidates each feasible CP-SAT result with the separate JavaScript checker before returning it.
- Used Node's built-in test runner and assertions, with no testing framework.
- Smoke-tested the approved built-in SQLite API in memory with a keyed insert and query; no database file or schema
  was added to the app.
- Added a source scan that searches production JavaScript for F1 course codes and names, teacher names, group names,
  year labels, sheet names, and the source workbook name. Tests verify both a clean scan and detection of injected
  course and teacher literals.
- For T1, read the F1 workbook with ExcelJS and generated a temporary reversed-columns copy for comparison. Checked
  that values could be represented as strings, merged headings were retained, and mirrored cells had no mismatches.
- For T2, generated a 5-day by 11-period XLSX with Thai text and merged cells, round-tripped it through LibreOffice,
  checked the merged ranges and exact text with ExcelJS, exported PDF, extracted its text, and visually inspected a
  rendered page.
- For T5, validated the problem fixture fields against `shapes.md`, matched every F1/F3/F4/F5 course and teacher
  record to its source workbook row with ExcelJS, and confirmed the F5 workbook contains no exact F1 identity values.
  Corrected the generated F3/F5 workbook rows after this comparison exposed mismatches. Checked the hand-made F2
  timetable against its fixed slots, group coverage, teacher loads, break placement, and daily shape.
- For T6, validated F1 and F2 with the new input checker and tested ten deliberately broken values plus an unknown
  contract field. Each produced the expected Thai ReviewItem; existing unresolved ReviewItems remain visible.
- For T7, read all F1 Thai cells as strings; generated an English-header XLSX test fixture by translating the
  original Thai XLSX, preserving data, formulas, and merged ranges. Compared every represented cell to the Thai
  source. The original workbook has two formula cells without cached results; these remain uncached in the derived
  fixture and each produces a Thai ReviewItem. Also tested rich text, merged values, hyperlinks, dates, cached
  formulas, plus empty and corrupt files.
- For T8, matched sheet type, header row, and columns using only `words.json` synonyms. Verified identical field
  matches for F1 Thai and English, the same fields in F4's reversed column order, and an unknown header left
  unmatched with `sure: "no"`.
- For T9, converted workbook rows using the T8 match proposal and original plain-text rows. Parsed groups, years,
  category and kind, fixed periods, room types, teacher positions, and unavailable periods; retained unmatched
  columns as `extra`; reported unreadable suggestions; and listed skipped rows with their reason. Existing input
  is preserved when a file is added; duplicate course codes, equivalent groups, and teacher names are not appended
  twice and produce warnings.
- For T10, implemented `engine/checker.js` as a standalone checker with no shared engine helpers. It recomputes
  rubric results, violations, and teacher loads from input plus lessons, including day shape, coverage, grouping,
  fixed slots, teacher/room conflicts, availability, and workload.
- For T11, expanded each theory course into one shared lesson task for every group in its year and each practical
  course into one task per group. Fixed courses keep their specified slot; activity courses use the configured
  activity slot. Conflicting activity fixed-times and courses without matching groups are reported as conflicts.
- For T12, added layered arithmetic feasibility analysis: weekly group totals and lesson lengths, fixed lesson
  conflicts and teacher/room capacity, teacher workload and period-one staffing, and weekly room capacity. Verified
  F1 totals (36/37/34), 159 counted periods, workload bands 138-170, and F3 Thursday/Friday period-one staffing
  causes. Fixed teacher- and flexible room-capacity tests pass; F1 analysis runs well under one second.
- For T13, added a deterministic phase-one day-builder search that pre-places fixed lessons, builds each group day
  from period 1 through its selected break, and filters movable placements by fixed ranges, teacher availability
  and capacity, and room type capacity. F2's five fixed lessons pass the independent checker with zero violations.
- The original Node.js phase-one search and subsequent MRV, workload-bound, and LCV prototypes did not find F1
  within 10 seconds (some exceeded 30 or 120 seconds). They remain as historical experiments; production
  generation now uses OR-Tools CP-SAT.
- The integrated `engine/cpsat_solver.py` models each task's day/start/teacher/room choices together with exact
  group-day shapes, fixed lessons, teacher availability and workloads, room type/availability, and resource
  non-overlap. `engine/solver.js` launches it locally and passes every feasible result through the independent
  `engine/checker.js`.
- T16 counts CP-SAT conflict events as the engine's configured `steps` budget, reports branches and conflicts
  separately, and uses a Node-side timer so process startup and Python model construction are included in the run
  deadline. `infeasible` is reserved for analysis or a complete CP-SAT proof; a time or step cutoff is
  `searchLimit` and explicitly says it is not proof.
- T16 records candidate-pruning counts by constraint and, for proven search infeasibility within the remaining
  deadline, tests one constraint group at a time as a bounded diagnostic. A relaxed solve only creates a
  "likely cause, not proof" entry; it does not produce a timetable for the user.
- T17 starts only after the CP-SAT candidate passes the independent checker. The Node.js late-acceptance stage
  makes 100 seeded teacher-reassignment attempts by default (or stops at the run deadline), rejects every move
  that fails the checker, and checks the final timetable again. It records scores before and after each round.
  The current equal-weight score is S1 = teacher idle gaps between first/last lessons, S2 = sum of each group's
  last occupied period per day, and S3 = twice the total absolute distance from each teacher's min/max workload
  midpoint. These transparent proxy terms are used for improvement, not presented as competition rubric points.
- T18 persists asynchronous run snapshots and state in `node:sqlite`, launches generation after returning a
  `running` response, supports poll/cancel, kills the local solver subprocess on cancellation, marks interrupted
  runs failed on the next startup, and limits the app to one active run. A real F1 run kept the health route below
  the 50 ms target and remained listed after a server restart.
- T19 builds group, teacher, room, and course views from saved result lessons. F1 group grids cover all periods on
  each day and sum to the expected 36/37/34 lesson periods by year.
- T20 derives each rubric report from the independent checker, records explicit assumptions, compares saved inputs
  and scores, and uses a SQLite transaction to keep at most one chosen run.
- T21 writes grids and an all-lessons sheet with ExcelJS. The generated F2 workbook reopened, its group lesson
  matched the view, merged period cells were retained, and all sheet names were valid and unique.
- T22 uses LibreOffice, the tested fallback from the PDF spike, to print one landscape page per group. F1 produced
  six pages; page 1 was rendered to `/tmp/timetablemaker-f1-page1.png` and visually checked: Thai marks were
  readable and course codes were visible. `pdfinfo` confirmed the page count; `pdftotext` confirmed course text.
- The initial CP-SAT benchmark allowed trailing empty periods after the selected break and failed the independent
  checker. The corrected shape model requires exactly one free configured break and continuous coverage on every
  group-day.
- Integrated F1 solved with status `OPTIMAL` in 1.78 seconds of backend time (1.21 seconds CP-SAT wall time,
  5,511 Boolean variables, 692 constraints) and passed the independent checker with zero violations. The full
  Node.js integration test, including subprocess startup and checker validation, completed in 2.95 seconds.
  F2 passed in 0.03 seconds of backend time; F5 also solved and passed the checker. F3 and F4 are rejected by
  arithmetic analysis for their documented teacher-capacity and minimum-workload shortages.
- Added `POST /api/timetable` on the localhost-only server. It accepts a problem JSON document and returns the
  solver result plus independent validation; request bodies are capped at 2 MB. `npm test` currently passes all
  79 tests.
- T1/T2/T5 workbooks were temporary spike material and were removed; ExcelJS is retained because T7 uses it at runtime.

## Earlier scaffold, removed

An initial prototype used Python 3.12.3, Flask, and OpenPyXL. Flask and OpenPyXL were removed when the app was
rebuilt in Node.js. Python is now used only as the local OR-Tools solver backend; Flask and OpenPyXL are not used.

## Results and limitations recorded so far

- T0: the initial `npm test` passed 4 tests; `npm start` served the health response. The current expanded
  `npm test` run passes 88 tests, including the data-literal scan, F1-F5 fixture checks, T6-T18 tests, the CP-SAT
  integration, and health/timetable endpoints.
- T1: ExcelJS read the four-sheet F1 workbook and a temporary reversed-columns copy. All inspected values were
  convertible to strings and the mirror comparison had zero mismatches. A T7 recheck found that the two F1 formula
  cells have cached results (50 and 48); an earlier note claiming those caches were missing was incorrect.
- T2: LibreOffice opened and re-saved the generated workbook; ExcelJS confirmed both merged ranges and the Thai
  strings remained intact. The PDF rendering was visually inspected. Microsoft Excel was not available, so direct
  Excel compatibility has not been verified.
- T3: the pdfmake package was not present in the local npm cache and Sarabun was not installed, so the first-choice
  pdfmake + Sarabun combination could not be tested offline. The approved LibreOffice fallback converted an XLSX
  containing the exact required Thai/Latin string to a one-page PDF. The rendered page was visually inspected and
  was legible; text extraction separated a Thai mark in one word, so extracted text alone is not reliable proof of
  Thai shaping. No permanent PDF-library choice is claimed.
- T4: a worker thread ran a 60-second busy-loop workload while the localhost health endpoint was measured. The first
  cold `fetch` measurement was 118.8 ms; after warming the connection, five requests measured 3.63, 2.07, 2.37,
  2.25, and 2.65 ms (all under 50 ms). Terminating the busy worker took 5.13 ms and it exited. The cold connection
  measurement is retained here rather than discarded.
- T5: F1/F3/F4/F5 workbook rows matched all 33/31/33/33 course records and 5/5/6/5 teacher records. F3 removes the
  two documented courses; F4 has the added teacher and fixed course; F5 retains the F1 counts and has renamed source
  identities. The F2 hand-made timetable has five 5-period lessons, one per weekday, with the break at period 6;
  its two teacher loads are 15 and 10 periods, within their 0-15 limits. Its report contains all 13 rubric items,
  with the room rule marked not applied because rooms are switched off.
- T6: `validateInput` accepts F1 and F2 and turns invalid values into ReviewItems. Ten single-fault cases passed,
  covering periods, enums, references, year, fixed ranges, break periods, workload, unavailability, room type, and
  duplicate IDs.
- T7: `readWorkbook` returns plain-text rows for F1 Thai, including merged cells and cached formula values, and
  for the English-header workbook translated from the original Thai XLSX. The derived workbook preserves source
  cells and merged ranges. Two original formulas lack cached results, so the reader emits ReviewItems for them.
  Empty and corrupt files return distinct `bad_input` and `unreadable_file` errors. The fixture is not an original
  English-language workbook.
- T7's selected missing-cache policy is to emit a ReviewItem and continue. The synthetic uncached-formula test passes.
- T8: `proposeMatches` classifies F1's three course sheets and teacher sheet, finds their header rows, and matches
  fields in both Thai and English. F4's reversed columns resolve to the same fields by meaning. Unknown columns
  remain unused and marked `sure: "no"`. The full `npm test` run passes all 35 tests.
- T9: F1 converts to 6 groups, 33 courses, and 5 teachers; course period totals are 36/37/34 and the unavailable
  time for the first teacher is Wednesday periods 1-4. The activity category suggested from course names produces
  three ReviewItems. Every skipped row has a permitted reason. Importing the English copy into the Thai input warns
  about duplicates without adding groups, courses, or teachers; a pre-existing customized finish limit is retained.
  The full `npm test` run passes all 39 tests.
- T10: the F2 timetable passes all applied checks, with the room rule marked `notApplied` and teacher loads of 15/10.
  Thirteen mutated F2 cases trigger the expected rubric IDs 1.1-1.12 and 2.1; additional tests cover room conflicts,
  unavailable rooms, required room assignment, general-room type matching, and invalid checker arguments. `npm test`
  passes all 57 tests.
- T11: F1 expands to exactly 51 lesson tasks: 15 shared theory courses and 18 practical courses for two groups
  each. All three activity courses are fixed to the configured slot. F2-F5 expansion counts also match the input
  course types and groups; malformed years and kinds and conflicting activity times are returned as explicit
  conflicts. `npm test` passes all 66 tests.
- T12: F1 analysis is `ok` with group totals 36/37/34, 159 counted teacher periods, and min/max workload sums of
  138/170. F3 is `infeasible`, naming Thursday and Friday period 1 because six teachers are needed but five are
  available. Fixed teacher and combined computer/lab room capacity shortages are detected. Invalid input is
  reported explicitly; F1 analysis takes under 1 second. `npm test` passes all 75 tests.
- T13: F2 phase-one search produces all five lessons at their required fixed times and passes the independent
  checker with no violations. Movable F2 lessons also pass the checker with daily breaks. Repeated searches return
  identical placements; step, elapsed-time, limit, and rejection counters are included. `npm test` passes all 75 tests.
- T14 Node.js phase-one search: the F2 tests pass, but the Node.js implementation does not meet the F1 performance
  target. Production schedule generation now uses the approved OR-Tools integration instead.
- Integrated CP-SAT: F1 (`OPTIMAL`, 1.89 s backend, 2.80 s end-to-end including checker in a standalone run),
  F2, and F5 pass the independent checker with zero violations. F3 and F4 are rejected by the existing analysis
  layer with explicit infeasibility causes. Room assignment/availability and the HTTP endpoint are covered by
  targeted tests.
- ExcelJS and OR-Tools are the current external runtime dependencies; their manifests are `package.json`/
  `package-lock.json` and `requirements.txt`, respectively.
- T23-T24: implemented the localhost-only routes for input persistence/editing, upload and paste proposals,
  confirmation and analysis, run lifecycle/history/comparison/selection, views/recheck, and Excel/PDF downloads.
  Errors use `{error:{code,message}}` with Thai messages; run IDs are validated before lookup, and uploads are capped
  at 30 MB. Added template and guide generation from a shared field definition. The route tests verify upload and
  paste handling, F1 course-row parity, template headers, all documented error codes, and the complete feasible-run
  workflow. Settings and functional AI remain optional T25 work.
- Initial frontend: added a Thai same-origin browser interface for data editing/import/review, feasibility checks,
  asynchronous generation, timetable views, reports, run statistics, assumptions, and history. Static asset routes
  and navigation were browser-checked; an F2 run was exercised through the backend and displayed in the UI.
  Automated tests verify static asset delivery, while full manual review with real imported school data remains.
