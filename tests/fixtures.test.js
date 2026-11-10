"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const fixtureRoot = path.join(__dirname, "fixtures");

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(fixtureRoot, file), "utf8"));
}

function assertId(id) {
  assert.equal(typeof id, "string");
  assert.match(id, /^[A-Za-z0-9-]+$/);
}

function assertRange(range) {
  if (range === null) return;
  assert.ok(Number.isInteger(range.day));
  assert.ok(Number.isInteger(range.start));
  assert.ok(Number.isInteger(range.end));
  assert.ok(range.start >= 1);
  assert.ok(range.end >= range.start);
}

function assertExtra(extra) {
  assert.ok(Array.isArray(extra));
  for (const item of extra) {
    assert.equal(typeof item.header, "string");
    assert.equal(typeof item.value, "string");
  }
}

function assertSource(source) {
  assert.ok(["file", "paste", "form", "ai"].includes(source.how));
  assert.equal(typeof source.confirmed, "boolean");
  if (source.how === "file") {
    assert.equal(typeof source.file, "string");
    assert.equal(typeof source.sheet, "string");
    assert.ok(Number.isInteger(source.row));
  }
}

function assertInput(problem) {
  assert.equal(problem.format, 1);
  assert.ok(Array.isArray(problem.groups));
  assert.ok(Array.isArray(problem.courses));
  assert.ok(Array.isArray(problem.teachers));
  assert.ok(Array.isArray(problem.rooms));
  assert.ok(Array.isArray(problem.off));
  assert.ok(Array.isArray(problem.review));
  assert.equal(typeof problem.confirmed, "boolean");
  assert.ok(Array.isArray(problem.time.days));
  assert.ok(problem.time.days.every((day) => typeof day === "string"));
  assert.ok(Number.isInteger(problem.time.periodsPerDay));
  assert.ok(problem.time.breakPeriods.every(Number.isInteger));
  assert.ok(Array.isArray(problem.time.finishLimits));
  assertRange(problem.time.activitySlot);
  assert.ok(Array.isArray(problem.time.fromGuideline));
  assert.ok(problem.time.fromGuideline.every((field) => typeof field === "string"));

  for (const group of problem.groups) {
    assertId(group.id);
    assert.equal(typeof group.name, "string");
    assert.equal(typeof group.year, "string");
  }
  for (const course of problem.courses) {
    assertId(course.id);
    assert.equal(typeof course.code, "string");
    assert.equal(typeof course.name, "string");
    assert.equal(typeof course.year, "string");
    assert.ok(Number.isInteger(course.periods) && course.periods >= 1);
    assert.ok(["theory", "practical"].includes(course.kind));
    assert.ok(["general", "department", "activity"].includes(course.category));
    assertRange(course.fixed);
    assert.ok(["", "computer", "lab", "computerOrLab", "general"].includes(course.roomType));
    assert.equal(typeof course.teacherId, "string");
    if (course.teacherId) assertId(course.teacherId);
    assertSource(course.source);
    assertExtra(course.extra);
  }
  for (const teacher of problem.teachers) {
    assertId(teacher.id);
    assert.equal(typeof teacher.name, "string");
    assert.ok(["head", "instructor", "other"].includes(teacher.position));
    assert.ok(Number.isInteger(teacher.minPeriods));
    assert.ok(Number.isInteger(teacher.maxPeriods));
    assert.ok(Array.isArray(teacher.unavailable));
    teacher.unavailable.forEach(assertRange);
    assertSource(teacher.source);
    assertExtra(teacher.extra);
  }
  for (const room of problem.rooms) {
    assertId(room.id);
    assert.equal(typeof room.name, "string");
    assert.ok(["computer", "lab", "general"].includes(room.type));
    assert.ok(room.size === "" || Number.isInteger(room.size));
    assert.ok(Array.isArray(room.unavailable));
    room.unavailable.forEach(assertRange);
  }
  for (const limit of problem.time.finishLimits) {
    assert.equal(typeof limit.year, "string");
    assert.ok(Number.isInteger(limit.lastPeriod));
  }
  for (const item of problem.off) {
    assert.equal(typeof item.section, "string");
    assert.equal(typeof item.field, "string");
  }
  for (const item of problem.review) {
    assertId(item.id);
    for (const field of ["section", "recordId", "field", "problem", "original"]) {
      assert.equal(typeof item[field], "string");
    }
  }
}

function assertResult(result) {
  assert.equal(result.format, 1);
  assert.ok(["feasible", "infeasible", "searchLimit", "invalidInput", "validationFailed"].includes(result.status));
  assert.ok(Array.isArray(result.lessons));
  for (const lesson of result.lessons) {
    assertId(lesson.id);
    assertId(lesson.courseId);
    assert.ok(Array.isArray(lesson.groupIds));
    lesson.groupIds.forEach(assertId);
    for (const field of ["day", "start", "end"]) assert.ok(Number.isInteger(lesson[field]));
    assert.equal(typeof lesson.teacherId, "string");
    if (lesson.teacherId) assertId(lesson.teacherId);
    assert.equal(typeof lesson.roomId, "string");
    if (lesson.roomId) assertId(lesson.roomId);
  }

  assert.ok(["ok", "infeasible", "invalidInput"].includes(result.analysis.status));
  assert.ok(Array.isArray(result.analysis.causes));
  assert.ok(Array.isArray(result.analysis.groups));
  for (const group of result.analysis.groups) {
    assertId(group.groupId);
    for (const field of ["needed", "possibleMin", "possibleMax"]) assert.ok(Number.isInteger(group[field]));
  }
  for (const field of ["counted", "minSum", "maxSum"]) {
    assert.ok(Number.isInteger(result.analysis.teachers[field]));
  }
  assert.ok(Array.isArray(result.report.items));
  for (const item of result.report.items) {
    assert.equal(typeof item.rubricId, "string");
    assert.ok(["passed", "failed", "notApplied"].includes(item.result));
    assert.ok(Number.isInteger(item.count));
  }
  assert.ok(Array.isArray(result.report.violations));
  assert.ok(Array.isArray(result.report.teacherLoads));
  assert.ok(Array.isArray(result.report.causes));
  assert.ok(Array.isArray(result.report.likelyCauses));
  assert.ok(Array.isArray(result.scoreHistory));
  assert.ok(Number.isInteger(result.seed));
  assert.ok(Array.isArray(result.assumptions));
  assert.ok(Number.isInteger(result.stats.steps));
  assert.ok(Number.isInteger(result.stats.ms));
  assert.ok(["", "time", "steps"].includes(result.stats.limitHit));
  assert.ok(Array.isArray(result.stats.rejections));
}

for (const set of ["F1", "F2", "F3", "F4", "F5"]) {
  test(`${set} has a problem and expected fixture`, () => {
    const problem = readJson(`${set}/problem.json`);
    const expected = readJson(`${set}/expected.json`);
    assertInput(problem);
    assert.ok(expected.counts);
    assert.ok(fs.existsSync(path.join(fixtureRoot, set, "source.xlsx")) ||
      fs.existsSync(path.join(fixtureRoot, set, "source.json")));
  });
}

test("F1 records and period totals match the hand-checked source summary", () => {
  const problem = readJson("F1/problem.json");
  const expected = readJson("F1/expected.json");
  assert.equal(problem.groups.length, expected.counts.groups);
  assert.equal(problem.courses.length, expected.counts.courses);
  assert.equal(problem.teachers.length, expected.counts.teachers);

  for (const [year, periods] of Object.entries(expected.periodsPerYear)) {
    assert.equal(
      problem.courses.filter((course) => course.year === year).reduce((sum, course) => sum + course.periods, 0),
      periods,
      `${year} periods`,
    );
  }
  assert.deepEqual(problem.teachers[0].unavailable, [
    { day: expected.teacherUnavailable.day, start: expected.teacherUnavailable.start, end: expected.teacherUnavailable.end },
  ]);
});

test("F2 hand-made result covers every weekday and respects its fixed courses and teacher loads", () => {
  const problem = readJson("F2/problem.json");
  const result = readJson("F2/result.json");
  assertResult(result);
  const lessons = result.lessons;
  assert.equal(result.status, "feasible");
  assert.equal(lessons.length, problem.courses.length);

  const courseById = new Map(problem.courses.map((course) => [course.id, course]));
  const teacherLoads = new Map();
  for (const lesson of lessons) {
    const course = courseById.get(lesson.courseId);
    assert.ok(course, `unknown course ${lesson.courseId}`);
    assert.deepEqual(course.fixed, { day: lesson.day, start: lesson.start, end: lesson.end });
    assert.equal(course.periods, lesson.end - lesson.start + 1);
    assert.deepEqual(lesson.groupIds, ["g-f2"]);
    assert.equal(lesson.teacherId, course.teacherId);
    assert.equal(lesson.start, 1);
    assert.equal(lesson.end, 5);
    teacherLoads.set(lesson.teacherId, (teacherLoads.get(lesson.teacherId) ?? 0) + course.periods);
  }
  assert.deepEqual([...new Set(lessons.map((lesson) => lesson.day))].sort(), [0, 1, 2, 3, 4]);
  assert.deepEqual([...teacherLoads.entries()].sort(), [["t-f2-1", 15], ["t-f2-2", 10]]);
  assert.equal(result.analysis.groups[0].needed, 25);
  assert.equal(result.analysis.groups[0].possibleMin, 5);
  assert.equal(result.analysis.teachers.counted, 25);
  assert.deepEqual(result.report.teacherLoads.map(({ teacherId, periods }) => [teacherId, periods]).sort(), [
    ["t-f2-1", 15],
    ["t-f2-2", 10],
  ]);
  assert.deepEqual(result.report.items.map(({ rubricId }) => rubricId), [
    "1.1", "1.2", "1.3", "1.4", "1.5", "1.6", "1.7", "1.8", "1.9", "1.10", "1.11", "1.12", "2.1",
  ]);
  assert.equal(result.report.items.find(({ rubricId }) => rubricId === "1.6").result, "notApplied");
  assert.ok(result.report.items.filter(({ rubricId }) => rubricId !== "1.6")
    .every(({ result: status }) => status === "passed"));
  assert.equal(problem.time.breakPeriods.includes(6), true);
  assert.ok(lessons.every((lesson) => lesson.end < 6));
  assert.ok(lessons.every((lesson) => lesson.end + 1 === 6));
  assert.ok(problem.teachers.every((teacher) =>
    (teacherLoads.get(teacher.id) ?? 0) >= teacher.minPeriods &&
    (teacherLoads.get(teacher.id) ?? 0) <= teacher.maxPeriods));
});

test("F3 removes the two courses used in the documented impossible case", () => {
  const f1 = readJson("F1/problem.json");
  const f3 = readJson("F3/problem.json");
  const expected = readJson("F3/expected.json");
  assert.equal(f3.courses.length, f1.courses.length - 2);
  for (const code of expected.removedCourses) {
    assert.ok(f1.courses.some((course) => course.code.replace(/\s/g, "") === code));
    assert.ok(!f3.courses.some((course) => course.code.replace(/\s/g, "") === code));
  }
  assert.equal(expected.status, "infeasible");
  assert.deepEqual(expected.causes, [{ day: 3, period: 1 }, { day: 4, period: 1 }]);
});

test("F4 adds a teacher, changes a course, and adds a non-conflicting fixed slot", () => {
  const f1 = readJson("F1/problem.json");
  const f4 = readJson("F4/problem.json");
  const expected = readJson("F4/expected.json");
  assert.equal(f4.teachers.length, f1.teachers.length + 1);
  const course = f4.courses.find((item) => item.code === "21909-2022-REV");
  assert.ok(course);
  assert.notEqual(course.name, f1.courses.find((item) => item.code === "21909-2022").name);
  assert.equal(course.year, expected.newFixed.year);
  assert.deepEqual(
    { day: course.fixed.day, start: course.fixed.start, end: course.fixed.end },
    { day: expected.newFixed.day, start: expected.newFixed.start, end: expected.newFixed.end },
  );
  const fixedCourses = f4.courses.filter((item) => item.fixed);
  for (const fixed of fixedCourses) {
    const finishLimit = f4.time.finishLimits.find((limit) => limit.year === fixed.year);
    assert.ok(finishLimit);
    assert.equal(fixed.periods, fixed.fixed.end - fixed.fixed.start + 1);
    assert.ok(fixed.fixed.end <= finishLimit.lastPeriod);
    assert.ok(!f4.time.breakPeriods.every((period) =>
      period >= fixed.fixed.start && period <= fixed.fixed.end));
    for (const other of fixedCourses) {
      if (fixed.id === other.id || fixed.year !== other.year || fixed.fixed.day !== other.fixed.day) continue;
      assert.ok(fixed.fixed.end < other.fixed.start || other.fixed.end < fixed.fixed.start);
    }
  }
  assert.equal(expected.columnsReordered, true);
});

test("F5 renames all F1 identities while preserving structural counts", () => {
  const f1 = readJson("F1/problem.json");
  const f5 = readJson("F5/problem.json");
  const expected = readJson("F5/expected.json");
  assert.deepEqual(
    [f5.groups.length, f5.courses.length, f5.teachers.length],
    [f1.groups.length, f1.courses.length, f1.teachers.length],
  );
  const originalNames = new Set([
    ...f1.courses.flatMap(({ code, name }) => [code, name]),
    ...f1.teachers.map(({ name }) => name),
    ...f1.groups.map(({ name }) => name),
    ...f1.courses.map(({ source }) => source.sheet),
    ...f1.teachers.map(({ source }) => source.sheet),
  ]);
  const renamedNames = [
    ...f5.courses.flatMap(({ code, name }) => [code, name]),
    ...f5.teachers.map(({ name }) => name),
    ...f5.groups.map(({ name }) => name),
    ...f5.courses.map(({ source }) => source.sheet),
    ...f5.teachers.map(({ source }) => source.sheet),
  ];
  assert.ok(renamedNames.every((name) => !originalNames.has(name)));
  assert.equal(expected.allSourceNamesReplaced, true);
});
