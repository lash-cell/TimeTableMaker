"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { checkTimetable } = require("../engine/checker");

const fixtureRoot = path.join(__dirname, "fixtures");

function readFixture(name, file) {
  return JSON.parse(fs.readFileSync(path.join(fixtureRoot, name, file), "utf8"));
}

function f2() {
  return {
    input: readFixture("F2", "problem.json"),
    lessons: readFixture("F2", "result.json").lessons,
  };
}

function rubricFailures(report) {
  return report.items.filter((item) => item.result === "failed").map((item) => item.rubricId);
}

function cloneF2() {
  const fixture = f2();
  return { input: structuredClone(fixture.input), lessons: structuredClone(fixture.lessons) };
}

test("F2 valid timetable passes every applied rubric and reports teacher loads", () => {
  const { input, lessons } = f2();
  const report = checkTimetable(input, lessons);
  assert.deepEqual(rubricFailures(report), []);
  assert.equal(report.items.length, 13);
  assert.equal(report.items.find((item) => item.rubricId === "1.6").result, "notApplied");
  assert.deepEqual(report.teacherLoads, [
    { teacherId: "t-f2-1", periods: 15, minPeriods: 0, maxPeriods: 15 },
    { teacherId: "t-f2-2", periods: 10, minPeriods: 0, maxPeriods: 15 },
  ]);
});

const ruleBreakers = [
  {
    rubricId: "1.1",
    name: "finish limit",
    break(fixture) {
      fixture.input.time.finishLimits[0].lastPeriod = 4;
    },
  },
  {
    rubricId: "1.2",
    name: "break placement",
    break(fixture) {
      fixture.input.time.breakPeriods = [4, 5];
    },
  },
  {
    rubricId: "1.3",
    name: "activity slot",
    break(fixture) {
      fixture.input.courses[0].category = "activity";
      fixture.input.courses[0].fixed = null;
    },
  },
  {
    rubricId: "1.4",
    name: "theory grouping",
    break(fixture) {
      fixture.input.groups.push({ id: "g-f2-2", name: "Demo/2", year: "Demo Year" });
      fixture.input.courses[0].kind = "practical";
      for (const lesson of fixture.lessons) {
        lesson.groupIds = ["g-f2", "g-f2-2"];
      }
    },
  },
  {
    rubricId: "1.5",
    name: "teacher workload",
    break(fixture) {
      fixture.input.teachers[0].minPeriods = 16;
    },
  },
  {
    rubricId: "1.6",
    name: "room type",
    break(fixture) {
      fixture.input.off = [];
      fixture.input.rooms.push({
        id: "r-f2",
        name: "Lab",
        type: "lab",
        unavailable: [],
      });
      fixture.input.courses[0].roomType = "computer";
      fixture.lessons[0].roomId = "r-f2";
    },
  },
  {
    rubricId: "1.7",
    name: "block length",
    break(fixture) {
      fixture.input.courses[0].fixed = null;
      fixture.lessons[0].end = 6;
    },
  },
  {
    rubricId: "1.8",
    name: "teacher clash",
    break(fixture) {
      fixture.lessons[1].day = 0;
      fixture.lessons[1].teacherId = "t-f2-1";
    },
  },
  {
    rubricId: "1.9",
    name: "group clash",
    break(fixture) {
      fixture.lessons[1].day = 0;
      fixture.lessons[1].teacherId = "t-f2-2";
    },
  },
  {
    rubricId: "1.10",
    name: "teacher availability",
    break(fixture) {
      fixture.input.teachers[0].unavailable = [{ day: 0, start: 1, end: 2 }];
    },
  },
  {
    rubricId: "1.11",
    name: "day starts at period one",
    break(fixture) {
      fixture.lessons[0].start = 2;
      fixture.lessons[0].end = 6;
      fixture.input.time.breakPeriods = [1, 4, 5];
    },
  },
  {
    rubricId: "1.12",
    name: "given teacher",
    break(fixture) {
      fixture.input.courses[0].teacherId = "t-f2-2";
    },
  },
  {
    rubricId: "2.1",
    name: "course completeness",
    break(fixture) {
      fixture.lessons.pop();
    },
  },
];

for (const rule of ruleBreakers) {
  test(`checker catches ${rule.name} with rubric ${rule.rubricId}`, () => {
    const fixture = cloneF2();
    rule.break(fixture);
    const report = checkTimetable(fixture.input, fixture.lessons);
    assert.ok(
      rubricFailures(report).includes(rule.rubricId),
      `expected rubric ${rule.rubricId}; got ${JSON.stringify(rubricFailures(report))}`,
    );
    assert.ok(report.violations.some((item) => item.rubricId === rule.rubricId));
  });
}

test("checker includes room conflicts and unavailable rooms in rubric 1.10", () => {
  const fixture = cloneF2();
  fixture.input.off = [];
  fixture.input.rooms.push({
    id: "r-f2",
    name: "Computer",
    type: "computer",
    unavailable: [{ day: 0, start: 1, end: 1 }],
  });
  fixture.lessons[0].roomId = "r-f2";
  fixture.lessons[1].roomId = "r-f2";
  fixture.lessons[1].day = 0;
  fixture.lessons[1].teacherId = "t-f2-2";
  const report = checkTimetable(fixture.input, fixture.lessons);

  assert.ok(report.violations.some((item) => item.rubricId === "1.6" && item.constraint === "H9"));
  assert.ok(report.violations.some((item) => item.rubricId === "1.10" && item.constraint === "H10"));
});

test("checker requires a matching room when room rules are enabled", () => {
  const fixture = cloneF2();
  fixture.input.off = [];
  fixture.input.courses[0].roomType = "computer";
  const report = checkTimetable(fixture.input, fixture.lessons);

  assert.ok(report.violations.some((item) => item.rubricId === "1.6" && item.constraint === "H9"));
});

test("checker treats general classrooms as a distinct room type", () => {
  const fixture = cloneF2();
  fixture.input.off = [];
  fixture.input.rooms.push({
    id: "r-f2",
    name: "Lab",
    type: "lab",
    unavailable: [],
  });
  fixture.input.courses[0].roomType = "general";
  fixture.lessons[0].roomId = "r-f2";
  const report = checkTimetable(fixture.input, fixture.lessons);

  assert.ok(report.violations.some((item) => item.rubricId === "1.6" && item.constraint === "H9"));
});

test("checker rejects missing input arrays explicitly", () => {
  assert.throws(() => checkTimetable({}, []), {
    name: "TypeError",
    message: "checkTimetable requires input data and a lessons array",
  });
});
