"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { analyzeInput } = require("../engine/analysis");

const fixtureRoot = path.join(__dirname, "fixtures");

function readProblem(name) {
  return JSON.parse(fs.readFileSync(path.join(fixtureRoot, name, "problem.json"), "utf8"));
}

test("F1 analysis reports the expected group periods and teacher workload", () => {
  const result = analyzeInput(readProblem("F1"));

  assert.equal(result.status, "ok");
  assert.deepEqual(result.causes, []);
  assert.deepEqual(
    result.groups.map(({ needed }) => needed),
    [36, 36, 37, 37, 34, 34],
  );
  assert.deepEqual(
    result.groups.map(({ possibleMin }) => possibleMin),
    [25, 25, 25, 25, 25, 25],
  );
  assert.deepEqual(result.teachers, { counted: 159, minSum: 138, maxSum: 170 });
});

test("F3 is infeasible on Thursday and Friday period one", () => {
  const f1 = readProblem("F1");
  const f3 = readProblem("F3");
  const removedCourseIds = ["21909-1011", "21909-2022"];

  assert.deepEqual(
    f1.courses.filter((course) => !f3.courses.some(({ id }) => id === course.id))
      .map(({ code }) => code).sort(),
    removedCourseIds.sort(),
  );

  const result = analyzeInput(f3);
  assert.equal(result.status, "infeasible");
  assert.deepEqual(
    result.causes.flatMap((cause) => cause.refs.map(({ day, period }) => ({ day, period }))),
    [{ day: 3, period: 1 }, { day: 4, period: 1 }],
  );
  assert.ok(result.causes.every((cause) => cause.layer === 3));
});

test("fixed lessons that exceed simultaneous teacher capacity are infeasible", () => {
  const input = readProblem("F1");
  const coursesByYear = new Set();
  for (const course of input.courses) {
    if (coursesByYear.has(course.year)) continue;
    coursesByYear.add(course.year);
    course.kind = "practical";
    course.category = "department";
    course.periods = 1;
    course.fixed = { day: 0, start: 1, end: 1 };
  }

  const result = analyzeInput(input);
  assert.equal(result.status, "infeasible");
  assert.ok(result.causes.some((cause) =>
    cause.layer === 2 && cause.message.includes("Fixed lessons need 6 teachers")));
});

test("fixed lessons that exceed combined computer-or-lab capacity are infeasible", () => {
  const input = readProblem("F1");
  const coursesByYear = new Set();
  input.rooms = [];
  input.off = input.off.filter((item) => item.section !== "rooms");
  for (const course of input.courses) {
    if (coursesByYear.has(course.year)) continue;
    coursesByYear.add(course.year);
    course.kind = "practical";
    course.category = "department";
    course.periods = 1;
    course.roomType = "computerOrLab";
    course.fixed = { day: 0, start: 1, end: 1 };
  }

  const result = analyzeInput(input);
  assert.equal(result.status, "infeasible");
  assert.ok(result.causes.some((cause) =>
    cause.layer === 2 && cause.message.includes("computer or lab rooms")));
});

test("analysis rejects incomplete input explicitly", () => {
  const result = analyzeInput({});

  assert.equal(result.status, "invalidInput");
  assert.equal(result.causes[0].field, "groups");
});

test("F1 analysis completes in under one second", () => {
  const input = readProblem("F1");
  analyzeInput(input);

  const started = performance.now();
  analyzeInput(input);
  assert.ok(performance.now() - started < 1000);
});
