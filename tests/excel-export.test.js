"use strict";

const assert = require("node:assert/strict");
const ExcelJS = require("exceljs");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createExcelBuffer, uniqueSheetName } = require("../output/excel");
const { generateTimetable } = require("../engine/solver");

function fixture(name) {
  return JSON.parse(fs.readFileSync(
    path.join(__dirname, "fixtures", name, "problem.json"),
    "utf8",
  ));
}

test("Excel export reopens with valid sheets and merged cells matching the group view", async () => {
  const input = fixture("F2");
  const result = await generateTimetable(input);
  const workbookBuffer = await createExcelBuffer(input, result);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(workbookBuffer);

  assert.ok(workbook.worksheets.length >= input.groups.length + input.teachers.length + 1);
  assert.equal(new Set(workbook.worksheets.map((sheet) => sheet.name.toLowerCase())).size,
    workbook.worksheets.length);
  for (const worksheet of workbook.worksheets) {
    assert.ok(worksheet.name.length <= 31);
    assert.doesNotMatch(worksheet.name, /[\\/?*[\]:]/);
  }

  const groupSheet = workbook.getWorksheet("Demo-1");
  assert.ok(groupSheet);
  assert.match(groupSheet.getCell("B2").value, /DEMO-01/);
  assert.ok(groupSheet.model.merges.includes("B2:F2"));

  const allLessons = workbook.getWorksheet("ทุกรายวิชา");
  assert.ok(allLessons);
  assert.equal(allLessons.rowCount, result.lessons.length + 1);
  assert.equal(allLessons.getCell("C2").value, "DEMO-01");
});

test("sheet-name sanitizing caps length and disambiguates duplicates", () => {
  const used = new Set();
  const first = uniqueSheetName("group/".padEnd(36, "x"), used, "Group");
  const second = uniqueSheetName("group/".padEnd(36, "x"), used, "Group");
  assert.equal(first.length, 31);
  assert.equal(second.length, 31);
  assert.notEqual(first, second);
  assert.doesNotMatch(first, /[\\/?*[\]:]/);
});
