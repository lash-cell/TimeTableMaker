"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ExcelJS = require("exceljs");
const { convertMatchesToInput } = require("../lib/row-converter");
const { validateInput } = require("../lib/input-validation");
const { proposeMatches } = require("../lib/column-matcher");
const { readWorkbook } = require("../lib/workbook-reader");
const { getUploadFields } = require("../data/form-definition");
const { createServer } = require("../server");

const fixtureRoot = path.join(__dirname, "fixtures");

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(fixtureRoot, name, "problem.json"), "utf8"));
}

async function listen(t, options = {}) {
  const server = createServer({ databasePath: ":memory:", ...options });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  }));
  return `http://127.0.0.1:${server.address().port}`;
}

async function json(response) {
  return response.json();
}

test("data guide and template are generated from the same active upload fields", async (t) => {
  const baseUrl = await listen(t);
  const guideResponse = await fetch(`${baseUrl}/api/data/guide`);
  assert.equal(guideResponse.status, 200);
  const guide = await json(guideResponse);
  assert.ok(guide.sections.some((section) => section.section === "groups"));

  const templateResponse = await fetch(`${baseUrl}/api/data/template`);
  assert.equal(templateResponse.status, 200);
  assert.match(templateResponse.headers.get("content-type"), /spreadsheetml/);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await templateResponse.arrayBuffer()));
  for (const section of ["courses", "teachers"]) {
    const sheet = workbook.getWorksheet(section === "courses" ? "Courses" : "Teachers");
    assert.deepEqual(
      sheet.getRow(1).values.slice(1),
      getUploadFields(section).map((field) => field.label),
    );
  }
});

test("upload proposal and pasted F1 course rows convert through the same importer", async (t) => {
  const baseUrl = await listen(t);
  const sourcePath = path.join(fixtureRoot, "F1", "source.xlsx");
  const bytes = fs.readFileSync(sourcePath);
  const uploadResponse = await fetch(`${baseUrl}/api/data/upload`, {
    method: "POST",
    headers: { "x-file-name": encodeURIComponent("F1 Thai.xlsx") },
    body: bytes,
  });
  assert.equal(uploadResponse.status, 200);
  const upload = await json(uploadResponse);
  assert.equal(upload.fileName, "F1 Thai.xlsx");
  assert.ok(upload.sheets.some((sheet) => sheet.sheetType === "courses"));

  const workbook = await readWorkbook(bytes);
  const courseSheet = workbook.sheets.find((sheet) =>
    proposeMatches([sheet]).sheets[0].sheetType === "courses");
  assert.ok(courseSheet);
  const pasteResponse = await fetch(`${baseUrl}/api/data/paste`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      section: "courses",
      year: courseSheet.name,
      text: courseSheet.rows.map((row) => row.cells.join("\t")).join("\n"),
    }),
  });
  assert.equal(pasteResponse.status, 200);
  const paste = await json(pasteResponse);
  assert.equal(paste.sheets[0].sheetType, "courses");

  const matchResponse = await fetch(`${baseUrl}/api/data/match`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(paste),
  });
  assert.equal(matchResponse.status, 200);
  const imported = await json(matchResponse);
  const expected = convertMatchesToInput(proposeMatches([courseSheet]), {
    fileName: paste.fileName,
    sourceSheets: [courseSheet],
  }).input;
  assert.deepEqual(imported.groups, expected.groups);
  assert.deepEqual(imported.courses, expected.courses);
  assert.deepEqual(imported.rooms, expected.rooms);
  assert.deepEqual(imported.rooms.map((room) => room.name), [
    "COM1", "COM2", "COM3", "COM4", "LAB1", "LAB2",
  ]);
});

test("workbook imports deduplicate by content and can be deleted or reset", async (t) => {
  const baseUrl = await listen(t);
  const bytes = fs.readFileSync(path.join(fixtureRoot, "F1", "source.xlsx"));
  const upload = () => fetch(`${baseUrl}/api/data/upload`, {
    method: "POST",
    headers: { "x-file-name": encodeURIComponent("F1 Thai.xlsx") },
    body: bytes,
  });
  const proposal = await json(await upload());
  assert.match(proposal.sha256, /^[a-f0-9]{64}$/u);

  const importedResponse = await fetch(`${baseUrl}/api/data/match`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(proposal),
  });
  const imported = await json(importedResponse);
  assert.equal(imported.importReport.importedFile.fileName, "F1 Thai.xlsx");
  assert.ok(imported.importReport.importedFile.courses > 0);
  assert.equal(validateInput(imported).some((item) =>
    item.field === "importId" || item.field === "source.importId"), false);

  const duplicateUpload = await json(await upload());
  assert.equal(duplicateUpload.alreadyImported, true);
  assert.equal(duplicateUpload.import.id, imported.importReport.importedFile.id);
  assert.equal((await json(await fetch(`${baseUrl}/api/data/imports`))).length, 1);

  const duplicateApply = await json(await fetch(`${baseUrl}/api/data/match`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(proposal),
  }));
  assert.equal(duplicateApply.importReport.alreadyImported, true);
  assert.equal(duplicateApply.courses.length, imported.courses.length);

  const deletedResponse = await fetch(
    `${baseUrl}/api/data/imports/${imported.importReport.importedFile.id}`,
    { method: "DELETE" },
  );
  assert.equal(deletedResponse.status, 200);
  const deleted = await json(deletedResponse);
  assert.ok(deleted.deleted.courses > 0);
  assert.deepEqual(deleted.input.groups, []);
  assert.deepEqual(deleted.input.courses, []);
  assert.deepEqual(deleted.input.teachers, []);
  assert.deepEqual(await json(await fetch(`${baseUrl}/api/data/imports`)), []);

  const uploadedAgain = await json(await upload());
  assert.equal(uploadedAgain.alreadyImported, undefined);
  const reset = await fetch(`${baseUrl}/api/data/reset`, { method: "POST" });
  assert.equal(reset.status, 200);
  assert.deepEqual(await json(await fetch(`${baseUrl}/api/data/imports`)), []);
});

test("data edit, confirm, check, run, recheck, view, history, choose, and export routes work together", async (t) => {
  const problem = fixture("F2");
  const solver = async () => ({
    status: "feasible",
    lessons: [],
    scoreHistory: [],
    report: { items: [], violations: [], teacherLoads: [], causes: [], likelyCauses: [] },
  });
  const baseUrl = await listen(t, { solver });
  const savedResponse = await fetch(`${baseUrl}/api/data`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(problem),
  });
  assert.equal(savedResponse.status, 200);
  const saved = await json(savedResponse);
  assert.equal(saved.confirmed, false);

  const confirmedResponse = await fetch(`${baseUrl}/api/data/confirm`, { method: "POST" });
  assert.equal(confirmedResponse.status, 200);
  assert.equal((await json(confirmedResponse)).confirmed, true);

  const checkResponse = await fetch(`${baseUrl}/api/check`, { method: "POST" });
  assert.equal(checkResponse.status, 200);
  assert.equal((await json(checkResponse)).status, "ok");

  const startResponse = await fetch(`${baseUrl}/api/runs`, { method: "POST" });
  assert.equal(startResponse.status, 202);
  const started = await json(startResponse);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/runs/${started.id}`);
    const run = await json(response);
    if (run.state === "finished") break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  const viewResponse = await fetch(`${baseUrl}/api/runs/${started.id}/view?kind=group`);
  assert.equal(viewResponse.status, 200);
  assert.equal((await json(viewResponse)).kind, "group");
  const invalidView = await fetch(`${baseUrl}/api/runs/${started.id}/view?kind=unknown`);
  assert.equal(invalidView.status, 400);
  assert.equal((await json(invalidView)).error.code, "bad_input");
  const recheckResponse = await fetch(`${baseUrl}/api/runs/${started.id}/recheck`, { method: "POST" });
  assert.equal(recheckResponse.status, 200);
  assert.ok(Array.isArray((await json(recheckResponse)).items));
  assert.equal((await fetch(`${baseUrl}/api/runs`)).status, 200);
  const compare = await fetch(`${baseUrl}/api/runs/compare?a=${started.id}&b=${started.id}`);
  assert.equal(compare.status, 200);
  const choose = await fetch(`${baseUrl}/api/runs/${started.id}/choose`, { method: "POST" });
  assert.equal(choose.status, 200);
  assert.equal((await json(choose)).chosen, true);

  const exportResponse = await fetch(`${baseUrl}/api/runs/${started.id}/export.xlsx`);
  assert.equal(exportResponse.status, 200);
  assert.ok((await exportResponse.arrayBuffer()).byteLength > 0);
});

test("errors use the documented envelope and invalid run ids are rejected before lookup", async (t) => {
  const baseUrl = await listen(t);
  const badPaste = await fetch(`${baseUrl}/api/data/paste`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ section: "groups", text: "bad" }),
  });
  assert.equal(badPaste.status, 400);
  assert.deepEqual(Object.keys((await json(badPaste)).error).sort(), ["code", "message"]);

  const unsupported = await fetch(`${baseUrl}/api/data/upload`, {
    method: "POST",
    headers: { "x-file-name": "data.csv" },
    body: "course,name",
  });
  assert.equal(unsupported.status, 415);
  assert.equal((await json(unsupported)).error.code, "unsupported_file");

  const invalidId = await fetch(`${baseUrl}/api/runs/%2E%2E%2Foutside`);
  assert.equal(invalidId.status, 400);
  assert.equal((await json(invalidId)).error.code, "bad_input");

  const missing = await fetch(`${baseUrl}/api/runs/run-missing`);
  assert.equal(missing.status, 404);
  assert.equal((await json(missing)).error.code, "not_found");

  const aiOff = await fetch(`${baseUrl}/api/ai/propose`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ items: [] }),
  });
  assert.equal(aiOff.status, 409);
  assert.equal((await json(aiOff)).error.code, "ai_off");

  const notConfirmed = await fetch(`${baseUrl}/api/runs`, { method: "POST" });
  assert.equal(notConfirmed.status, 409);
  assert.equal((await json(notConfirmed)).error.code, "not_confirmed");

  const unreadable = await fetch(`${baseUrl}/api/data/upload`, {
    method: "POST",
    headers: { "x-file-name": "broken.xlsx" },
    body: "not an Excel workbook",
  });
  assert.equal(unreadable.status, 422);
  assert.equal((await json(unreadable)).error.code, "unreadable_file");
});

test("upload size limit, solver busy state, and non-feasible result use documented errors", async (t) => {
  let releaseSolver;
  const blockedSolver = () => new Promise((resolve) => {
    releaseSolver = () => resolve({
      status: "infeasible",
      lessons: [],
      analysis: { status: "infeasible", causes: [] },
    });
  });
  const baseUrl = await listen(t, { solver: blockedSolver });

  const tooLarge = await fetch(`${baseUrl}/api/data/upload`, {
    method: "POST",
    headers: { "x-file-name": "large.xlsx" },
    body: Buffer.alloc(30 * 1024 * 1024 + 1),
  });
  assert.equal(tooLarge.status, 413);
  assert.equal((await json(tooLarge)).error.code, "too_large");

  const input = fixture("F2");
  await fetch(`${baseUrl}/api/data`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const confirmed = await fetch(`${baseUrl}/api/data/confirm`, { method: "POST" });
  assert.equal(confirmed.status, 200);
  const first = await fetch(`${baseUrl}/api/runs`, { method: "POST" });
  assert.equal(first.status, 202);
  const busy = await fetch(`${baseUrl}/api/runs`, { method: "POST" });
  assert.equal(busy.status, 409);
  assert.equal((await json(busy)).error.code, "busy");
  for (let attempt = 0; attempt < 100 && !releaseSolver; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(typeof releaseSolver, "function");
  releaseSolver();

  const started = await json(first);
  let finished;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    finished = await json(await fetch(`${baseUrl}/api/runs/${started.id}`));
    if (finished.state === "finished") break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(finished.state, "finished");
  const notFeasible = await fetch(`${baseUrl}/api/runs/${started.id}/view?kind=group`);
  assert.equal(notFeasible.status, 409);
  assert.equal((await json(notFeasible)).error.code, "not_feasible");
});

test("internal failures are logged and do not expose details", async (t) => {
  const logged = [];
  const baseUrl = await listen(t, {
    solver: async () => { throw new Error("private backend detail"); },
    logger: { error: (...args) => logged.push(args) },
  });
  const response = await fetch(`${baseUrl}/api/timetable`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(fixture("F2")),
  });
  assert.equal(response.status, 500);
  const result = await json(response);
  assert.equal(result.error.code, "internal");
  assert.doesNotMatch(result.error.message, /private backend detail/);
  assert.equal(logged.length, 1);
});
