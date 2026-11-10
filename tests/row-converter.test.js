"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { convertMatchesToInput } = require("../lib/row-converter");
const { proposeMatches } = require("../lib/column-matcher");
const { readWorkbook } = require("../lib/workbook-reader");
const { validateInput } = require("../lib/input-validation");

const fixtureRoot = path.join(__dirname, "fixtures");

async function convertFixture(relativePath, options = {}) {
  const workbook = await readWorkbook(fs.readFileSync(path.join(fixtureRoot, relativePath)));
  return convertMatchesToInput(proposeMatches(workbook.sheets), {
    fileName: path.basename(relativePath),
    sourceSheets: workbook.sheets,
    readerReviewItems: workbook.reviewItems,
    ...options,
  });
}

test("F1 rows convert to the expected groups, courses, teachers, and unavailable periods", async () => {
  const { input, skipped, warnings } = await convertFixture("F1/source.xlsx");
  assert.equal(input.groups.length, 6);
  assert.equal(input.courses.length, 33);
  assert.equal(input.teachers.length, 5);
  assert.deepEqual(input.rooms.map(({ name, type }) => [name, type]), [
    ["COM1", "computer"],
    ["COM2", "computer"],
    ["COM3", "computer"],
    ["COM4", "computer"],
    ["LAB1", "lab"],
    ["LAB2", "lab"],
  ]);
  assert.ok(input.off.some((item) => item.section === "rooms"));
  assert.deepEqual(
    Object.fromEntries([...new Set(input.courses.map((course) => course.year))]
      .map((year) => [year, input.courses.filter((course) => course.year === year)
        .reduce((sum, course) => sum + course.periods, 0)])),
    { "ปวช.1": 36, "ปวช.2": 37, "ปวช.3": 34 },
  );
  assert.deepEqual(input.teachers[0].unavailable, [{ day: 2, start: 1, end: 4 }]);
  assert.deepEqual(input.time.finishLimits, [
    { year: "ปวช.1", lastPeriod: 9 },
    { year: "ปวช.2", lastPeriod: 11 },
    { year: "ปวช.3", lastPeriod: 11 },
  ]);
  assert.deepEqual(warnings, []);
  assert.ok(["title", "header", "heading", "empty"].every((reason) =>
    skipped.some((row) => row.reason === reason)));
  assert.ok(skipped.every((row) =>
    ["title", "header", "heading", "repeatedHeader", "total", "empty"].includes(row.reason)));
  assert.equal(input.courses.find((course) => course.code.replace(/\s/gu, "") === "21909-1011").roomType, "computerOrLab");
  assert.equal(input.courses.find((course) => course.code === "20000 - 2001").fixed.day, 3);
  assert.equal(input.confirmed, false);
  assert.equal(input.courses[0].source.confirmed, false);
  assert.equal(input.review.filter((item) => item.field === "category").length, 3);
  assert.deepEqual(validateInput(input), input.review);
});

test("authoritative Thai subject workbook preserves room descriptions and room types", async () => {
  const { input, warnings } = await convertFixture("F1/source-thai-original.xlsx");
  assert.equal(input.groups.length, 6);
  assert.equal(input.courses.length, 33);
  assert.deepEqual(input.rooms.map(({ name, type }) => [name, type]), [
    ["COM1", "computer"],
    ["COM2", "computer"],
    ["COM3", "computer"],
    ["COM4", "computer"],
    ["LAB1", "lab"],
    ["LAB2", "lab"],
  ]);
  assert.ok(input.off.some((item) => item.section === "rooms"));
  assert.deepEqual(warnings, []);
  assert.equal(input.courses.find((course) => course.code.replace(/\s/gu, "") === "21909-1001").roomType, "lab");
  assert.equal(input.courses.find((course) => course.code.replace(/\s/gu, "") === "21909-1004").roomType, "computer");
  assert.equal(input.courses.find((course) => course.code.replace(/\s/gu, "") === "21909-1011").roomType, "computerOrLab");
  assert.equal(
    input.courses.find((course) => course.code.replace(/\s/gu, "") === "21909-1001").roomDescription,
    "ใช้ห้องปฏิบัติการ",
  );
  assert.equal(
    input.courses.find((course) => course.code.replace(/\s/gu, "") === "21909-1011").roomDescription,
    "ใช้ห้องคอมพิวเตอร์หรือห้องปฏิบัติการ",
  );
  assert.equal(input.courses.find((course) => course.code.replace(/\s/gu, "") === "20000-1101").roomDescription, "ห้องเรียนภาษาไทย");
  assert.deepEqual(validateInput(input), input.review);
});

test("Thai and English copies warn and do not append duplicate groups, courses, or teachers", async () => {
  const thai = await convertFixture("F1/source.xlsx");
  const existingInput = structuredClone(thai.input);
  existingInput.time.finishLimits[0].lastPeriod = 8;
  const english = await convertFixture("F1/source-en.xlsx", { existingInput });

  assert.equal(english.input.groups.length, 6);
  assert.equal(english.input.courses.length, 33);
  assert.equal(english.input.teachers.length, 5);
  assert.equal(english.input.time.finishLimits[0].lastPeriod, 8);
  assert.ok(english.warnings.some((warning) => warning.includes("รหัสวิชาซ้ำ")));
  assert.ok(english.warnings.some((warning) => warning.includes("ชีตผู้สอน")));
  assert.ok(english.warnings.some((warning) => warning.includes("รายชื่อผู้สอนซ้ำ")));
});

test("unmatched columns are retained as extras and unreadable requirement text is reviewed", () => {
  const proposal = {
    sheets: [{
      name: "Year 1",
      sheetType: "courses",
      headerRow: 1,
      columns: [
        { index: 1, header: "Course Code", field: "courseCode" },
        { index: 2, header: "Course Name", field: "courseName" },
        { index: 3, header: "Hours", field: "periodsPerWeek" },
        { index: 4, header: "Course Type", field: "kind" },
        { index: 5, header: "Requirement", field: "requirement" },
        { index: 6, header: "Unmatched", field: "", sure: "no" },
      ],
      rows: [
        { row: 1, cells: ["Course Code", "Course Name", "Hours", "Course Type", "Requirement", "Unmatched"] },
        { row: 2, cells: ["C-1", "Example", "2", "Theory", "Some unknown rule", "keep me"] },
      ],
    }],
  };
  const { input } = convertMatchesToInput(proposal, {
    fileName: "custom.xlsx",
    sourceSheets: proposal.sheets,
  });

  assert.deepEqual(input.courses[0].extra, [{ header: "Unmatched", value: "keep me" }]);
  assert.ok(input.review.some((item) => item.field === "fixed" && item.original === "Some unknown rule"));
});

test("unrecognized group title and teacher position become review items", () => {
  const proposal = {
    sheets: [
      {
        name: "Unknown Year",
        sheetType: "courses",
        headerRow: 2,
        columns: [
          { index: 1, header: "Course Code", field: "courseCode" },
          { index: 2, header: "Course Name", field: "courseName" },
          { index: 3, header: "Hours", field: "periodsPerWeek" },
          { index: 4, header: "Course Type", field: "kind" },
        ],
        rows: [
          { row: 1, cells: ["unknown grouping"] },
          { row: 2, cells: ["Course Code", "Course Name", "Hours", "Course Type"] },
          { row: 3, cells: ["C-1", "Example", "2", "Theory"] },
        ],
      },
      {
        name: "Teachers",
        sheetType: "teachers",
        headerRow: 1,
        columns: [
          { index: 1, header: "Teacher Name", field: "teacherName" },
          { index: 2, header: "Position", field: "position" },
        ],
        rows: [
          { row: 1, cells: ["Teacher Name", "Position"] },
          { row: 2, cells: ["Teacher A", "Unknown role"] },
        ],
      },
    ],
  };
  const { input } = convertMatchesToInput(proposal, {
    fileName: "custom.xlsx",
    sourceSheets: proposal.sheets,
  });

  assert.ok(input.review.some((item) => item.field === "groups"));
  assert.ok(input.review.some((item) => item.field === "year"));
  assert.ok(input.review.some((item) => item.field === "position"));
  assert.equal(input.teachers[0].position, "other");
});
