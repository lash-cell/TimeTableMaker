"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { checkTimetable } = require("../engine/checker");
const { generateTimetable } = require("../engine/solver");
const { createServer } = require("../server");

function fixture(name) {
  return JSON.parse(fs.readFileSync(
    path.join(__dirname, "fixtures", name, "problem.json"),
    "utf8",
  ));
}

test("OR-Tools finds and independently validates F1 within ten seconds", async () => {
  const input = fixture("F1");
  const result = await generateTimetable(input, { timeLimitMs: 10000 });

  assert.equal(result.status, "feasible");
  assert.equal(result.lessons.length, 51);
  assert.ok(result.stats.bridgeMs < 10000, `solver took ${result.stats.bridgeMs} ms end-to-end`);
  assert.equal(result.stats.limitHit, "");
  assert.ok(Number.isInteger(result.stats.steps));
  assert.ok(Array.isArray(result.stats.rejections));
  assert.ok(result.stats.rejections.length > 0);
  assert.equal(result.scoreHistory[0].round, 0);
  assert.equal(result.scoreHistory.at(-1).round, result.scoreHistory.length - 1);
  assert.ok(result.scoreHistory.at(-1).total <= result.scoreHistory[0].total);
  assert.equal(result.seed, 1);
  assert.equal(result.stats.improvementRounds, 100);
  assert.ok(result.report.items.filter((item) => item.result !== "notApplied")
    .every((item) => item.result === "passed"));
  assert.deepEqual(result.report.violations, []);
  assert.ok(result.assumptions.length > 0);
  assert.deepEqual(checkTimetable(input, result.lessons).violations, []);
});

test("the whole-run time limit is reported without claiming infeasibility", async () => {
  const result = await generateTimetable(fixture("F1"), { timeLimitMs: 1 });

  assert.equal(result.status, "searchLimit");
  assert.equal(result.stats.limitHit, "time");
  assert.match(result.causes[0].message, /not proof/i);
});

test("cancellation stops the local solver subprocess", async () => {
  const controller = new AbortController();
  const pending = generateTimetable(fixture("F1"), { signal: controller.signal });
  const timer = setTimeout(() => controller.abort(), 100);
  try {
    await assert.rejects(pending, { name: "AbortError" });
  } finally {
    clearTimeout(timer);
  }
});

test("a tiny CP-SAT step limit is reported as searchLimit, not infeasible", async () => {
  const result = await generateTimetable(fixture("F1"), {
    timeLimitMs: 10000,
    stepLimit: 1,
  });

  assert.equal(result.status, "searchLimit");
  assert.equal(result.stats.limitHit, "steps");
  assert.equal(result.stats.steps, 1);
  assert.match(result.causes[0].message, /not proof/i);
});

test("the same input produces the same timetable", async () => {
  const input = fixture("F2");
  const first = await generateTimetable(input, { seed: 29 });
  const second = await generateTimetable(input, { seed: 29 });

  assert.equal(first.status, "feasible");
  assert.equal(second.status, "feasible");
  assert.equal(first.seed, 29);
  assert.deepEqual(second.lessons, first.lessons);
  assert.deepEqual(second.scoreHistory, first.scoreHistory);
});

test("OR-Tools preserves fixed F2 lessons and checker validity", async () => {
  const input = fixture("F2");
  const result = await generateTimetable(input);

  assert.equal(result.status, "feasible");
  assert.equal(result.lessons.length, input.courses.length);
  assert.deepEqual(checkTimetable(input, result.lessons).violations, []);
});

test("OR-Tools schedules F5 and analysis reports F3/F4 infeasibility", async () => {
  const f5 = fixture("F5");
  const result = await generateTimetable(f5);
  assert.equal(result.status, "feasible");
  assert.deepEqual(checkTimetable(f5, result.lessons).violations, []);

  for (const name of ["F3", "F4"]) {
    const infeasible = await generateTimetable(fixture(name));
    assert.equal(infeasible.status, "infeasible");
    assert.ok(infeasible.analysis.causes.length > 0);
    assert.ok(Number.isFinite(infeasible.stats.ms));
    assert.ok(Number.isInteger(infeasible.stats.steps));
    assert.ok(Array.isArray(infeasible.stats.rejections));
  }
});

test("OR-Tools assigns required rooms and respects room availability", async () => {
  const input = fixture("F2");
  input.off = input.off.filter((item) => item.section !== "rooms");
  input.courses[0].roomType = "lab";
  input.rooms = [{
    id: "room-lab",
    name: "Lab",
    type: "lab",
    unavailable: [],
  }];

  const result = await generateTimetable(input);
  const checked = checkTimetable(input, result.lessons);
  assert.equal(result.status, "feasible");
  assert.equal(result.lessons.find((lesson) => lesson.courseId === input.courses[0].id).roomId, "room-lab");
  assert.deepEqual(checked.violations, []);

  input.rooms[0].unavailable = [{ day: 0, start: 1, end: 5 }];
  const unavailableResult = await generateTimetable(input);
  assert.equal(unavailableResult.status, "infeasible");
  assert.deepEqual(unavailableResult.lessons, []);
  assert.ok(unavailableResult.likelyCauses.some((message) => /room availability and types/.test(message)));
});

test("POST /api/timetable returns a checker-validated F2 schedule", async (t) => {
  const server = createServer({ databasePath: ":memory:" });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  }));

  const input = fixture("F2");
  const address = server.address();
  const invalidResponse = await fetch(`http://127.0.0.1:${address.port}/api/timetable`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{",
  });
  assert.equal(invalidResponse.status, 400);

  const response = await fetch(`http://127.0.0.1:${address.port}/api/timetable`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.status, "feasible");
  assert.deepEqual(result.validation.violations, []);
});
