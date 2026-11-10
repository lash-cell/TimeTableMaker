"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createLessonsToPlace } = require("../engine/lesson-builder");

const fixtureRoot = path.join(__dirname, "fixtures");

function readProblem(name) {
  return JSON.parse(fs.readFileSync(path.join(fixtureRoot, name, "problem.json"), "utf8"));
}

test("F1 expands to 51 lessons with theory shared and practical per group", () => {
  const input = readProblem("F1");
  const { lessons, conflicts } = createLessonsToPlace(input);
  const courseById = new Map(input.courses.map((course) => [course.id, course]));

  assert.equal(lessons.length, 51);
  assert.deepEqual(conflicts, []);

  for (const course of input.courses) {
    const courseLessons = lessons.filter((lesson) => lesson.courseId === course.id);
    const yearGroupIds = input.groups
      .filter((group) => group.year === course.year)
      .map((group) => group.id)
      .sort();
    if (course.kind === "theory") {
      assert.equal(courseLessons.length, 1, course.code);
      assert.deepEqual([...courseLessons[0].groupIds].sort(), yearGroupIds, course.code);
    } else {
      assert.equal(courseLessons.length, yearGroupIds.length, course.code);
      assert.deepEqual(
        courseLessons.map((lesson) => lesson.groupIds[0]).sort(),
        yearGroupIds,
        course.code,
      );
    }
    assert.ok(courseLessons.every((lesson) => lesson.periods === course.periods), course.code);
  }

  const activities = lessons.filter((lesson) =>
    courseById.get(lesson.courseId).category === "activity");
  assert.equal(activities.length, 3);
  assert.ok(activities.every((lesson) =>
    JSON.stringify(lesson.fixed) === JSON.stringify(input.time.activitySlot)));
});

for (const name of ["F2", "F3", "F4", "F5"]) {
  test(`${name} expands theory/practical courses from its own groups`, () => {
    const input = readProblem(name);
    const { lessons, conflicts } = createLessonsToPlace(input);
    const expectedCount = input.courses.reduce((total, course) => {
      const groups = input.groups.filter((group) => group.year === course.year);
      return total + (course.kind === "theory" ? 1 : groups.length);
    }, 0);

    assert.deepEqual(conflicts, []);
    assert.equal(lessons.length, expectedCount);
  });
}

test("activity slot overrides no movable placement and reports conflicting explicit fixed time", () => {
  const input = readProblem("F2");
  const course = structuredClone(input.courses[0]);
  course.category = "activity";
  course.fixed = { day: 0, start: 1, end: 5 };
  input.courses = [course];

  const { lessons, conflicts } = createLessonsToPlace(input);
  assert.deepEqual(lessons[0].fixed, input.time.activitySlot);
  assert.deepEqual(conflicts, [{
    courseId: course.id,
    reason: "activitySlotConflictsWithCourseFixed",
    courseFixed: { day: 0, start: 1, end: 5 },
    activitySlot: input.time.activitySlot,
  }]);
});

test("unknown course year is returned as an explicit conflict", () => {
  const input = readProblem("F2");
  input.courses[0].year = "Unknown year";
  const { lessons, conflicts } = createLessonsToPlace(input);

  assert.equal(lessons.length, input.courses.length - 1);
  assert.deepEqual(conflicts, [{ courseId: "c-f2-1", reason: "noGroupsForYear" }]);
});

test("unknown course kind is returned as an explicit conflict", () => {
  const input = readProblem("F2");
  input.courses[0].kind = "unknown";
  const { lessons, conflicts } = createLessonsToPlace(input);

  assert.equal(lessons.length, input.courses.length - 1);
  assert.deepEqual(conflicts, [{ courseId: "c-f2-1", reason: "unknownCourseKind" }]);
});

test("missing required input is rejected explicitly", () => {
  assert.throws(() => createLessonsToPlace({}), {
    name: "TypeError",
    message: "createLessonsToPlace requires input groups, courses, and time settings",
  });
});
