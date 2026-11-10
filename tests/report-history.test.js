"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { buildAssumptions } = require("../engine/report");
const { compareRuns } = require("../output/history");
const { RunStore } = require("../server/run-store");

function fixture(name) {
  return JSON.parse(fs.readFileSync(
    path.join(__dirname, "fixtures", name, "problem.json"),
    "utf8",
  ));
}

test("changed guideline values and explicit settings appear in assumptions", () => {
  const input = fixture("F1");
  input.time.breakPeriods = [3, 4, 5];
  input.time.fromGuideline = input.time.fromGuideline.filter((field) => field !== "breakPeriods");
  const assumptions = buildAssumptions(input);

  assert.ok(assumptions.some((item) =>
    item.includes("คาบพัก") && item.includes("[3,4,5]") && item.includes("[4,5,6]")));
  assert.ok(assumptions.some((item) => item.includes("ปิดใช้ข้อกำหนดส่วน rooms")));
});

test("run comparison shows changed input, score terms, and passed rubric counts", () => {
  const firstInput = fixture("F2");
  const secondInput = structuredClone(firstInput);
  secondInput.time.finishLimits[0].lastPeriod = 8;
  const result = {
    status: "feasible",
    scoreHistory: [{ round: 1, total: 15, terms: { S1: 2, S2: 10, S3: 3 } }],
    report: { items: [
      { rubricId: "1.1", result: "passed", count: 0 },
      { rubricId: "1.2", result: "notApplied", count: 0 },
    ] },
  };
  const compared = compareRuns(
    { id: "run-a", state: "finished", input: firstInput, result },
    { id: "run-b", state: "finished", input: secondInput, result },
  );

  assert.equal(compared.a.score.terms.S1, 2);
  assert.equal(compared.b.itemsPassed, 1);
  assert.ok(compared.dataChanges.some((change) =>
    change.includes("time.finishLimits[0].lastPeriod: 9 -> 8")));
});

test("choosing a run is exclusive and refuses a non-feasible result", () => {
  const store = new RunStore(":memory:");
  try {
    const input = fixture("F2");
    const first = store.create({ id: "run-first", createdAt: "2025-01-01T00:00:00.000Z", input });
    const second = store.create({ id: "run-second", createdAt: "2025-01-02T00:00:00.000Z", input });
    store.finish(first.id, { status: "feasible", lessons: [] });
    store.finish(second.id, { status: "feasible", lessons: [] });

    assert.equal(store.choose(first.id).chosen, true);
    assert.equal(store.choose(second.id).chosen, true);
    assert.equal(store.get(first.id).chosen, false);
    assert.equal(store.choose("missing"), null);
    store.create({ id: "run-pending", createdAt: "2025-01-03T00:00:00.000Z", input });
    assert.throws(() => store.choose("run-pending"), { code: "not_feasible" });
  } finally {
    store.close();
  }
});
