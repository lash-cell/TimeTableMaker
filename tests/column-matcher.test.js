"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { proposeMatches } = require("../lib/column-matcher");
const { readWorkbook } = require("../lib/workbook-reader");

const fixtureRoot = path.join(__dirname, "fixtures");

async function matchFixture(relativePath) {
  const workbook = await readWorkbook(fs.readFileSync(path.join(fixtureRoot, relativePath)));
  return proposeMatches(workbook.sheets);
}

function fieldsBySheet(proposal) {
  return proposal.sheets.map((sheet) => ({
    sheetType: sheet.sheetType,
    fields: sheet.columns.map((column) => column.field),
  }));
}

function sortedFieldsBySheet(proposal) {
  return fieldsBySheet(proposal).map((sheet) => ({
    ...sheet,
    fields: [...sheet.fields].sort(),
  }));
}

test("F1 Thai and English workbooks produce the same sheet and field matches", async () => {
  const thai = await matchFixture("F1/source.xlsx");
  const english = await matchFixture("F1/source-en.xlsx");
  assert.deepEqual(fieldsBySheet(thai), fieldsBySheet(english));
  assert.deepEqual(thai.sheets.map((sheet) => sheet.sheetType), [
    "courses", "courses", "courses", "teachers",
  ]);
  assert.deepEqual(thai.sheets.map((sheet) => sheet.headerRow), [2, 2, 3, 1]);
  assert.deepEqual(thai.sheets[0].columns.map((column) => column.field), [
    "courseCode", "courseName", "periodsPerWeek", "kind", "requirement", "roomDescription",
  ]);
  assert.deepEqual(thai.sheets[3].columns.map((column) => column.field), [
    "teacherName", "position", "teacherNote",
  ]);
});

test("F4 reversed columns match the same fields as F1", async () => {
  const f1 = await matchFixture("F1/source.xlsx");
  const f4 = await matchFixture("F4/source.xlsx");
  assert.deepEqual(sortedFieldsBySheet(f4), sortedFieldsBySheet(f1));
});

test("unknown headers stay unmatched and require review", () => {
  const proposal = proposeMatches([{
    name: "Courses",
    rows: [
      { row: 1, cells: ["Code", "Course Name", "Mystery column"] },
      { row: 2, cells: ["X-1", "Example", "value"] },
    ],
  }]);

  assert.equal(proposal.sheets[0].sheetType, "courses");
  assert.equal(proposal.sheets[0].headerRow, 1);
  assert.deepEqual(proposal.sheets[0].columns[2], {
    index: 3,
    header: "Mystery column",
    samples: ["value"],
    field: "",
    sure: "no",
  });
});
