"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { buildView } = require("../output/views");
const { generateTimetable } = require("../engine/solver");

function fixture(name) {
  return JSON.parse(fs.readFileSync(
    path.join(__dirname, "fixtures", name, "problem.json"),
    "utf8",
  ));
}

function assertRowsCoverDay(view, periodsPerDay) {
  for (const row of view.rows) {
    let nextPeriod = 1;
    for (const cell of row.cells) {
      assert.equal(cell.start, nextPeriod);
      assert.ok(cell.end >= cell.start);
      nextPeriod = cell.end + 1;
    }
    assert.equal(nextPeriod, periodsPerDay + 1);
  }
}

test("F1 group views cover each day and lesson periods match the expected year totals", async () => {
  const input = fixture("F1");
  const result = await generateTimetable(input);
  const expected = JSON.parse(fs.readFileSync(
    path.join(__dirname, "fixtures", "F1", "expected.json"),
    "utf8",
  ));

  assert.equal(result.status, "feasible");
  for (const group of input.groups) {
    const view = buildView(input, result, "group", group.id);
    assertRowsCoverDay(view, input.time.periodsPerDay);
    assert.ok(view.rows.every((row) => row.cells.filter((cell) => cell.type === "break").length === 1));
    const lessonPeriods = view.rows.flatMap((row) => row.cells)
      .filter((cell) => cell.type === "lesson")
      .reduce((sum, cell) => sum + cell.end - cell.start + 1, 0);
    assert.equal(lessonPeriods, expected.periodsPerYear[group.year]);
  }
});

test("teacher, room, and course views expose sorted, complete data", async () => {
  const input = fixture("F2");
  input.off = input.off.filter((item) => item.section !== "rooms");
  input.courses[0].roomType = "lab";
  input.rooms = [{ id: "room-1", name: "Lab 1", type: "lab", unavailable: [] }];
  const result = await generateTimetable(input);

  assert.equal(result.status, "feasible");
  const teacherView = buildView(input, result, "teacher");
  assert.deepEqual(teacherView.keys.map((item) => item.label), ["Demo Teacher 1", "Demo Teacher 2"]);
  assertRowsCoverDay(teacherView, input.time.periodsPerDay);

  const roomView = buildView(input, result, "room", "room-1");
  assertRowsCoverDay(roomView, input.time.periodsPerDay);
  assert.equal(roomView.rows[0].cells.find((cell) => cell.type === "lesson").lesson.roomName, "Lab 1");

  const courseView = buildView(input, result, "course");
  assert.equal(courseView.rows, undefined);
  assert.equal(courseView.lessons.length, result.lessons.length);
  assert.deepEqual(
    courseView.lessons.map((lesson) => lesson.code),
    [...courseView.lessons.map((lesson) => lesson.code)].sort(),
  );
  assert.equal(courseView.lessons[0].groupNames[0], "Demo/1");
});
