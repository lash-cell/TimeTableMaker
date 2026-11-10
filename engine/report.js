"use strict";

const defaults = require("../defaults.json");
const { checkTimetable } = require("./checker");

const engineAssumptions = [
  "คาบเรียนของแต่ละกลุ่มเริ่มจากคาบ 1 และมีช่วงพักที่เลือกหนึ่งช่วงต่อวัน",
  "รายวิชาหนึ่งรายการจัดเป็นบล็อกเดียวตามจำนวนคาบต่อสัปดาห์",
];

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function finishLimitDefault(year) {
  const normalized = String(year).toLowerCase().replace(/[\s.]/g, "");
  const isFirstYear = normalized.endsWith("1") && !normalized.endsWith("11");
  return isFirstYear
    ? defaults.time.finishLimits.vocationalCertificateYear1
    : defaults.time.finishLimits.otherYears;
}

function buildAssumptions(input) {
  const assumptions = [];
  const time = input.time ?? {};
  const fromGuideline = new Set(time.fromGuideline ?? []);
  const timeLabels = {
    days: "วันเรียน",
    periodsPerDay: "จำนวนคาบต่อวัน",
    breakPeriods: "คาบพัก",
    activitySlot: "ช่วงเวลากิจกรรม",
  };
  for (const [field, label] of Object.entries(timeLabels)) {
    if (
      !fromGuideline.has(field) &&
      !sameValue(time[field], defaults.time[field])
    ) {
      assumptions.push(
        `${label}: ${JSON.stringify(time[field])} (ค่าแนวทาง: ${JSON.stringify(defaults.time[field])})`,
      );
    }
  }

  if (!fromGuideline.has("finishLimits")) {
    for (const limit of time.finishLimits ?? []) {
      const standard = finishLimitDefault(limit.year);
      if (limit.lastPeriod !== standard) {
        assumptions.push(
          `กำหนดคาบสุดท้ายของปี ${limit.year} เป็นคาบ ${limit.lastPeriod} (ค่าแนวทาง: คาบ ${standard})`,
        );
      }
    }
  }

  for (const teacher of input.teachers ?? []) {
    const band = defaults.workloadBands[teacher.position];
    if (band && (teacher.minPeriods !== band.minPeriods || teacher.maxPeriods !== band.maxPeriods)) {
      assumptions.push(
        `ช่วงภาระสอนของ ${teacher.name}: ${teacher.minPeriods}-${teacher.maxPeriods} คาบ (ค่าแนวทาง: ${band.minPeriods}-${band.maxPeriods})`,
      );
    }
  }

  for (const course of input.courses ?? []) {
    if (course.fixed) {
      assumptions.push(
        `กำหนดรายวิชา ${course.code} ไว้วัน ${(course.fixed.day ?? 0) + 1} คาบ ${course.fixed.start}-${course.fixed.end}`,
      );
    }
    if (course.teacherId) {
      assumptions.push(`กำหนดผู้สอนรายวิชา ${course.code} ไว้ล่วงหน้า`);
    }
    if (course.source?.how === "ai") {
      const original = course.source.original ?? course.source.text;
      assumptions.push(
        `ยอมรับข้อเสนอจาก AI สำหรับรายวิชา ${course.code}${original ? ` จากข้อความ "${original}"` : ""}`,
      );
    }
  }
  for (const teacher of input.teachers ?? []) {
    if (teacher.source?.how === "ai") {
      const original = teacher.source.original ?? teacher.source.text;
      assumptions.push(
        `ยอมรับข้อเสนอจาก AI สำหรับผู้สอน ${teacher.name}${original ? ` จากข้อความ "${original}"` : ""}`,
      );
    }
  }
  for (const item of input.off ?? []) {
    assumptions.push(`ปิดใช้ข้อกำหนดส่วน ${item.section}${item.field ? ` (${item.field})` : ""}`);
  }

  return [...engineAssumptions, ...assumptions];
}

function buildReport(input, result, validation) {
  if (result.status === "feasible") {
    const report = validation ?? checkTimetable(input, result.lessons);
    return { ...report, causes: [], likelyCauses: result.likelyCauses ?? [] };
  }

  const causes = result.causes ?? result.analysis?.causes ?? [];
  return {
    items: [],
    violations: [],
    teacherLoads: [],
    causes: causes.map((cause) => typeof cause === "string" ? cause : cause.message),
    likelyCauses: result.likelyCauses ?? [],
  };
}

module.exports = { buildAssumptions, buildReport };
