"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { findTerms, scanSource } = require("../lib/hardcoding-scan");

const projectRoot = path.resolve(__dirname, "..");
const f1Problem = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures/F1/problem.json"), "utf8"),
);
const f1Terms = [
  ...f1Problem.courses.flatMap(({ code, name }) => [code, name]),
  ...f1Problem.teachers.map(({ name }) => name),
  ...f1Problem.groups.flatMap(({ name, year }) => [name, year]),
  ...f1Problem.courses.map(({ source }) => source.sheet),
  ...f1Problem.teachers.map(({ source }) => source.sheet),
  ...f1Problem.courses.map(({ source }) => source.file),
].filter(Boolean);

test("production JavaScript contains no F1 course, teacher, group, year, or sheet literals", () => {
  assert.deepEqual(scanSource(projectRoot, f1Terms), []);
});

test("the scan detects a sample course code and teacher name inserted into source text", () => {
  const code = f1Problem.courses[0].code;
  const teacher = f1Problem.teachers[0].name;
  assert.deepEqual(findTerms(`const courseCode = ${JSON.stringify(code)};`, [code]), [code]);
  assert.deepEqual(findTerms(`const teacherName = ${JSON.stringify(teacher)};`, [teacher]), [teacher]);
});
