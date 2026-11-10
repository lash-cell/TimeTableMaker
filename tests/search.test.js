"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { checkTimetable } = require("../engine/checker");
const { searchPhaseOne } = require("../engine/search");

const input = JSON.parse(fs.readFileSync(
  path.join(__dirname, "fixtures", "F2", "problem.json"),
  "utf8",
));

test("F2 phase-one search places every lesson and passes the time rules", () => {
  const result = searchPhaseOne(input);
  const checked = checkTimetable(input, result.lessons);

  assert.equal(result.status, "feasible");
  assert.equal(result.lessons.length, input.courses.length);
  assert.deepEqual(checked.violations, []);
  assert.ok(result.stats.steps > 0);
  assert.ok(Number.isFinite(result.stats.ms));
  assert.equal(result.stats.limitHit, "");
  assert.ok(Array.isArray(result.stats.rejections));
});

test("phase-one search produces the same F2 placement for the same input", () => {
  const first = searchPhaseOne(input);
  const second = searchPhaseOne(input);

  assert.deepEqual(first.lessons, second.lessons);
});

test("day builder places movable F2 lessons as consecutive blocks with a daily break", () => {
  const movableInput = structuredClone(input);
  for (const course of movableInput.courses) course.fixed = null;

  const result = searchPhaseOne(movableInput);
  const checked = checkTimetable(movableInput, result.lessons);

  assert.equal(result.status, "feasible");
  assert.equal(result.lessons.length, movableInput.courses.length);
  assert.deepEqual(checked.violations, []);
  assert.deepEqual(
    result.lessons.map(({ day, start, end }) => ({ day, start, end })),
    movableInput.courses.map((_, day) => ({ day, start: 1, end: 5 })),
  );
});
