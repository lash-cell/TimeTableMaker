"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { validateInput } = require("../lib/input-validation");

const fixtureRoot = path.join(__dirname, "fixtures");

function readProblem(name) {
  return JSON.parse(fs.readFileSync(path.join(fixtureRoot, name, "problem.json"), "utf8"));
}

test("F1 and F2 inputs pass validation", () => {
  assert.deepEqual(validateInput(readProblem("F1")), []);
  assert.deepEqual(validateInput(readProblem("F2")), []);
});

const brokenInputs = [
  {
    name: "non-positive course periods",
    section: "courses",
    field: "periods",
    original: "0",
    problem: "จำนวนคาบรายสัปดาห์ต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป",
    mutate(problem) {
      problem.courses[0].periods = 0;
      return problem.courses[0].id;
    },
  },
  {
    name: "unknown course kind",
    section: "courses",
    field: "kind",
    original: "lecture",
    problem: "ประเภทวิชาต้องเป็นทฤษฎีหรือปฏิบัติ",
    mutate(problem) {
      problem.courses[0].kind = "lecture";
      return problem.courses[0].id;
    },
  },
  {
    name: "missing given teacher",
    section: "courses",
    field: "teacherId",
    original: "t-missing",
    problem: "ไม่พบผู้สอนตามรหัสที่ระบุ",
    mutate(problem) {
      problem.courses[0].teacherId = "t-missing";
      return problem.courses[0].id;
    },
  },
  {
    name: "course year without groups",
    section: "courses",
    field: "year",
    original: "Unknown Year",
    problem: "ชั้นปีของรายวิชาไม่มีอยู่ในข้อมูลกลุ่มเรียน",
    mutate(problem) {
      problem.courses[0].year = "Unknown Year";
      return problem.courses[0].id;
    },
  },
  {
    name: "fixed day outside the school week",
    section: "courses",
    field: "fixed",
    original: "{\"day\":99,\"start\":1,\"end\":5}",
    problem: "วันหรือช่วงคาบอยู่นอกเวลาที่กำหนด",
    mutate(problem) {
      problem.courses[0].fixed.day = 99;
      return problem.courses[0].id;
    },
  },
  {
    name: "non-consecutive break periods",
    section: "time",
    field: "breakPeriods",
    original: "[4,6]",
    problem: "คาบพักต้องเรียงต่อเนื่องกัน",
    mutate(problem) {
      problem.time.breakPeriods = [4, 6];
      return "";
    },
  },
  {
    name: "teacher minimum above maximum",
    section: "teachers",
    field: "maxPeriods",
    original: "15",
    problem: "คาบงานสูงสุดต้องไม่น้อยกว่าคาบงานขั้นต่ำ",
    mutate(problem) {
      problem.teachers[0].minPeriods = 16;
      return problem.teachers[0].id;
    },
  },
  {
    name: "teacher unavailable range outside the school week",
    section: "teachers",
    field: "unavailable",
    original: "{\"day\":9,\"start\":1,\"end\":2}",
    problem: "วันหรือช่วงคาบอยู่นอกเวลาที่กำหนด",
    mutate(problem) {
      problem.teachers[0].unavailable = [{ day: 9, start: 1, end: 2 }];
      return problem.teachers[0].id;
    },
  },
  {
    name: "unknown room type",
    section: "courses",
    field: "roomType",
    original: "studio",
    problem: "ประเภทห้องไม่อยู่ในรายการที่กำหนด",
    mutate(problem) {
      problem.courses[0].roomType = "studio";
      return problem.courses[0].id;
    },
  },
  {
    name: "duplicate record id",
    section: "courses",
    field: "id",
    original: "c-f2-1",
    problem: "รหัสรายการต้องไม่ซ้ำกัน",
    mutate(problem) {
      problem.courses[1].id = problem.courses[0].id;
      return problem.courses[1].id;
    },
  },
];

for (const broken of brokenInputs) {
  test(`invalid input becomes a ReviewItem: ${broken.name}`, () => {
    const problem = structuredClone(readProblem("F2"));
    const recordId = broken.mutate(problem);
    const items = validateInput(problem);
    assert.deepEqual(items, [{
      id: "review-1",
      section: broken.section,
      recordId,
      field: broken.field,
      problem: broken.problem,
      original: broken.original,
    }]);
  });
}

test("unresolved ReviewItems remain visible and block a clean validation result", () => {
  const problem = readProblem("F2");
  const existing = {
    id: "review-1",
    section: "courses",
    recordId: "c-f2-1",
    field: "name",
    problem: "กรุณาตรวจสอบชื่อรายวิชา",
    original: "unreadable",
  };
  problem.review = [existing];
  assert.deepEqual(validateInput(problem), [existing]);
});

test("unknown contract fields become ReviewItems", () => {
  const problem = readProblem("F2");
  problem.extraData = "not in shapes.md";
  assert.deepEqual(validateInput(problem), [{
    id: "review-1",
    section: "input",
    recordId: "",
    field: "extraData",
    problem: "พบชื่อช่องข้อมูลที่ไม่รองรับ",
    original: "not in shapes.md",
  }]);
});
