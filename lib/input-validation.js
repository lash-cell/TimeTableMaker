"use strict";

const idPattern = /^[A-Za-z0-9-]+$/;
const timeFields = new Set(["days", "periodsPerDay", "breakPeriods", "finishLimits", "activitySlot"]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toOriginal(value) {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  if (value === null) return "null";
  return String(JSON.stringify(value));
}

function validateInput(input) {
  const reviewItems = [];
  let nextReviewId = 1;

  function addReview(section, recordId, field, problem, original) {
    let id = `review-${nextReviewId}`;
    while (reviewItems.some((item) => item.id === id)) {
      nextReviewId += 1;
      id = `review-${nextReviewId}`;
    }
    nextReviewId += 1;
    reviewItems.push({
      id,
      section,
      recordId: typeof recordId === "string" ? recordId : "",
      field,
      problem,
      original: toOriginal(original),
    });
  }

  function checkKeys(record, allowed, section, recordId) {
    for (const [field, value] of Object.entries(record)) {
      if (!allowed.includes(field)) {
        addReview(section, recordId, field, "พบชื่อช่องข้อมูลที่ไม่รองรับ", value);
      }
    }
  }

  if (!isRecord(input)) {
    addReview("input", "", "problem", "ข้อมูลต้องเป็นวัตถุตามรูปแบบที่กำหนด", input);
    return reviewItems;
  }
  checkKeys(input, [
    "format", "groups", "courses", "teachers", "rooms", "time", "off", "review", "confirmed",
  ], "input", "");

  const existingReview = Array.isArray(input.review) ? input.review : [];
  for (const [index, item] of existingReview.entries()) {
    if (
      isRecord(item) &&
      typeof item.id === "string" &&
      idPattern.test(item.id) &&
      ["section", "recordId", "field", "problem", "original"].every((field) => typeof item[field] === "string")
    ) {
      reviewItems.push({ ...item });
      checkKeys(item, ["id", "section", "recordId", "field", "problem", "original"], "review", item.id);
      continue;
    }
    addReview("review", "", "review", "รายการตรวจสอบเดิมมีรูปแบบไม่ถูกต้อง", item ?? index);
  }

  if (input.format !== 1) {
    addReview("input", "", "format", "รูปแบบข้อมูลไม่รองรับ", input.format);
  }

  const time = isRecord(input.time) ? input.time : {};
  if (!isRecord(input.time)) {
    addReview("time", "", "time", "กรุณาระบุข้อมูลเวลา", input.time);
  } else {
    checkKeys(time, ["days", "periodsPerDay", "breakPeriods", "finishLimits", "activitySlot", "fromGuideline"], "time", "");
  }

  const days = Array.isArray(time.days) ? time.days : [];
  const periodsPerDay = Number.isInteger(time.periodsPerDay) ? time.periodsPerDay : 0;
  if (days.length === 0 || days.some((day) => typeof day !== "string" || day.trim() === "")) {
    addReview("time", "", "days", "ต้องระบุวันเรียนเป็นข้อความอย่างน้อยหนึ่งวัน", time.days);
  } else if (new Set(days).size !== days.length) {
    addReview("time", "", "days", "วันเรียนต้องไม่ซ้ำกัน", time.days);
  }
  if (periodsPerDay < 1) {
    addReview("time", "", "periodsPerDay", "จำนวนคาบต่อวันต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป", time.periodsPerDay);
  }

  const breakPeriods = Array.isArray(time.breakPeriods) ? time.breakPeriods : [];
  if (
    breakPeriods.length === 0 ||
    breakPeriods.some((period) => !Number.isInteger(period) || period < 1 || period > periodsPerDay)
  ) {
    addReview("time", "", "breakPeriods", "คาบพักต้องอยู่ภายในช่วงคาบเรียนของวัน", time.breakPeriods);
  } else if (!breakPeriods.every((period, index) => period === breakPeriods[0] + index)) {
    addReview("time", "", "breakPeriods", "คาบพักต้องเรียงต่อเนื่องกัน", time.breakPeriods);
  }

  function checkRange(section, recordId, field, range) {
    if (isRecord(range)) checkKeys(range, ["day", "start", "end"], section, recordId);
    if (
      !isRecord(range) ||
      !Number.isInteger(range.day) ||
      range.day < 0 ||
      range.day >= days.length ||
      !Number.isInteger(range.start) ||
      !Number.isInteger(range.end) ||
      range.start < 1 ||
      range.end < range.start ||
      range.end > periodsPerDay
    ) {
      addReview(section, recordId, field, "วันหรือช่วงคาบอยู่นอกเวลาที่กำหนด", range);
      return false;
    }
    return true;
  }

  if (!Array.isArray(time.finishLimits)) {
    addReview("time", "", "finishLimits", "ขีดจำกัดคาบเลิกเรียนต้องเป็นรายการ", time.finishLimits);
  }
  const finishLimits = Array.isArray(time.finishLimits) ? time.finishLimits : [];
  const limitYears = new Set();
  for (const [index, limit] of finishLimits.entries()) {
    if (!isRecord(limit)) {
      addReview("time", "", "finishLimits", "ขีดจำกัดคาบเลิกเรียนมีรูปแบบไม่ถูกต้อง", limit ?? index);
      continue;
    }
    checkKeys(limit, ["year", "lastPeriod"], "time", "");
    if (typeof limit.year !== "string" || limit.year.trim() === "") {
      addReview("time", "", "finishLimits", "กรุณาระบุชั้นปีของขีดจำกัดเวลา", limit.year);
    } else if (limitYears.has(limit.year)) {
      addReview("time", "", "finishLimits", "ชั้นปีมีขีดจำกัดเวลาเลิกเรียนซ้ำกัน", limit.year);
    } else {
      limitYears.add(limit.year);
    }
    if (!Number.isInteger(limit.lastPeriod) || limit.lastPeriod < 1 || limit.lastPeriod > periodsPerDay) {
      addReview("time", "", "finishLimits", "คาบเลิกเรียนต้องอยู่ภายในช่วงคาบเรียนของวัน", limit.lastPeriod);
    }
  }

  checkRange("time", "", "activitySlot", time.activitySlot);
  if (!Array.isArray(time.fromGuideline)) {
    addReview("time", "", "fromGuideline", "รายการค่าจากแนวทางต้องเป็นรายการข้อความ", time.fromGuideline);
  } else {
    for (const field of time.fromGuideline) {
      if (typeof field !== "string" || !timeFields.has(field)) {
        addReview("time", "", "fromGuideline", "พบชื่อค่าจากแนวทางที่ไม่รองรับ", field);
      }
    }
  }

  const sectionArrays = new Map();
  for (const section of ["groups", "courses", "teachers", "rooms", "off"]) {
    if (!Array.isArray(input[section])) {
      addReview(section, "", section, "ข้อมูลส่วนนี้ต้องเป็นรายการ", input[section]);
      sectionArrays.set(section, []);
      continue;
    }
    sectionArrays.set(section, input[section]);
    if (["groups", "courses", "teachers"].includes(section) && input[section].length === 0) {
      addReview(section, "", section, "ต้องมีข้อมูลอย่างน้อยหนึ่งรายการ", input[section]);
    }
  }

  if (!Array.isArray(input.review)) {
    addReview("review", "", "review", "รายการตรวจสอบต้องเป็นรายการ", input.review);
  }
  if (typeof input.confirmed !== "boolean") {
    addReview("input", "", "confirmed", "สถานะยืนยันต้องเป็นจริงหรือเท็จ", input.confirmed);
  }

  const ids = new Set();
  function checkId(record, section, index) {
    const recordId = typeof record.id === "string" ? record.id : "";
    if (!idPattern.test(recordId)) {
      addReview(section, recordId, "id", "รหัสต้องใช้ตัวอักษรภาษาอังกฤษ ตัวเลข หรือเครื่องหมายขีดกลาง", record.id);
      return recordId;
    }
    if (ids.has(recordId)) {
      addReview(section, recordId, "id", "รหัสรายการต้องไม่ซ้ำกัน", record.id);
    }
    ids.add(recordId);
    return recordId;
  }

  function checkText(record, section, recordId, field) {
    const value = record[field];
    if (typeof value !== "string" || value.trim() === "") {
      addReview(section, recordId, field, "กรุณาระบุข้อความในช่องนี้", value);
    }
  }

  function checkSource(record, section, recordId) {
    const source = record.source;
    if (
      !isRecord(source) ||
      !["file", "paste", "form", "ai"].includes(source.how) ||
      typeof source.confirmed !== "boolean"
    ) {
      addReview(section, recordId, "source", "แหล่งที่มาของข้อมูลมีรูปแบบไม่ถูกต้อง", source);
      return;
    }
    checkKeys(
      source,
      source.how === "file" ? ["how", "file", "sheet", "row", "confirmed"] : ["how", "confirmed"],
      section,
      recordId,
    );
    if (
      source.how === "file" &&
      (typeof source.file !== "string" ||
        source.file.trim() === "" ||
        typeof source.sheet !== "string" ||
        source.sheet.trim() === "" ||
        !Number.isInteger(source.row) ||
        source.row < 1)
    ) {
      addReview(section, recordId, "source", "ข้อมูลไฟล์ต้นทางไม่ครบถ้วน", source);
    }
  }

  function checkExtra(record, section, recordId) {
    if (!Array.isArray(record.extra)) {
      addReview(section, recordId, "extra", "ข้อมูลคอลัมน์เพิ่มเติมต้องเป็นรายการ", record.extra);
      return;
    }
    for (const item of record.extra) {
      if (!isRecord(item) || typeof item.header !== "string" || typeof item.value !== "string") {
        addReview(section, recordId, "extra", "คอลัมน์เพิ่มเติมต้องมีหัวข้อและข้อความ", item);
      } else {
        checkKeys(item, ["header", "value"], section, recordId);
      }
    }
  }

  const groups = sectionArrays.get("groups");
  const courses = sectionArrays.get("courses");
  const teachers = sectionArrays.get("teachers");
  const rooms = sectionArrays.get("rooms");
  const years = new Set();
  const teacherIds = new Set();

  for (const [index, group] of groups.entries()) {
    if (!isRecord(group)) {
      addReview("groups", "", "record", "ข้อมูลกลุ่มเรียนมีรูปแบบไม่ถูกต้อง", group ?? index);
      continue;
    }
    const recordId = checkId(group, "groups", index);
    checkKeys(group, ["id", "name", "year"], "groups", recordId);
    checkText(group, "groups", recordId, "name");
    checkText(group, "groups", recordId, "year");
    if (typeof group.year === "string" && group.year.trim() !== "") years.add(group.year);
  }

  for (const [index, teacher] of teachers.entries()) {
    if (!isRecord(teacher)) {
      addReview("teachers", "", "record", "ข้อมูลผู้สอนมีรูปแบบไม่ถูกต้อง", teacher ?? index);
      continue;
    }
    const recordId = checkId(teacher, "teachers", index);
    checkKeys(
      teacher,
      ["id", "name", "position", "minPeriods", "maxPeriods", "unavailable", "source", "extra"],
      "teachers",
      recordId,
    );
    checkText(teacher, "teachers", recordId, "name");
    if (!["head", "instructor", "other"].includes(teacher.position)) {
      addReview("teachers", recordId, "position", "ตำแหน่งผู้สอนไม่อยู่ในรายการที่กำหนด", teacher.position);
    }
    for (const field of ["minPeriods", "maxPeriods"]) {
      if (!Number.isInteger(teacher[field]) || teacher[field] < 0) {
        addReview("teachers", recordId, field, "จำนวนคาบงานต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป", teacher[field]);
      }
    }
    if (
      Number.isInteger(teacher.minPeriods) &&
      Number.isInteger(teacher.maxPeriods) &&
      teacher.minPeriods > teacher.maxPeriods
    ) {
      addReview("teachers", recordId, "maxPeriods", "คาบงานสูงสุดต้องไม่น้อยกว่าคาบงานขั้นต่ำ", teacher.maxPeriods);
    }
    if (!Array.isArray(teacher.unavailable)) {
      addReview("teachers", recordId, "unavailable", "เวลาที่ผู้สอนไม่ว่างต้องเป็นรายการ", teacher.unavailable);
    } else {
      for (const range of teacher.unavailable) {
        checkRange("teachers", recordId, "unavailable", range);
      }
    }
    checkSource(teacher, "teachers", recordId);
    checkExtra(teacher, "teachers", recordId);
    if (typeof teacher.id === "string" && idPattern.test(teacher.id)) teacherIds.add(teacher.id);
  }

  for (const [index, course] of courses.entries()) {
    if (!isRecord(course)) {
      addReview("courses", "", "record", "ข้อมูลรายวิชามีรูปแบบไม่ถูกต้อง", course ?? index);
      continue;
    }
    const recordId = checkId(course, "courses", index);
    checkKeys(
      course,
      ["id", "code", "name", "year", "periods", "kind", "category", "fixed", "roomType", "teacherId", "source", "extra"],
      "courses",
      recordId,
    );
    for (const field of ["code", "name", "year"]) checkText(course, "courses", recordId, field);
    if (typeof course.year === "string" && course.year.trim() !== "" && !years.has(course.year)) {
      addReview("courses", recordId, "year", "ชั้นปีของรายวิชาไม่มีอยู่ในข้อมูลกลุ่มเรียน", course.year);
    }
    if (!Number.isInteger(course.periods) || course.periods < 1) {
      addReview("courses", recordId, "periods", "จำนวนคาบรายสัปดาห์ต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป", course.periods);
    }
    if (!["theory", "practical"].includes(course.kind)) {
      addReview("courses", recordId, "kind", "ประเภทวิชาต้องเป็นทฤษฎีหรือปฏิบัติ", course.kind);
    }
    if (!["general", "department", "activity"].includes(course.category)) {
      addReview("courses", recordId, "category", "หมวดวิชาไม่อยู่ในรายการที่กำหนด", course.category);
    }
    if (course.fixed !== null && course.fixed !== "") {
      if (checkRange("courses", recordId, "fixed", course.fixed) &&
        Number.isInteger(course.periods) &&
        course.periods >= 1 &&
        course.fixed.end - course.fixed.start + 1 !== course.periods) {
        addReview("courses", recordId, "fixed", "ช่วงคาบที่กำหนดต้องยาวเท่ากับจำนวนคาบของรายวิชา", course.fixed);
      }
    } else if (course.fixed === undefined) {
      addReview("courses", recordId, "fixed", "กรุณาระบุช่วงคาบหรือเว้นว่าง", course.fixed);
    }
    if (!["", "computer", "lab", "computerOrLab", "general"].includes(course.roomType)) {
      addReview("courses", recordId, "roomType", "ประเภทห้องไม่อยู่ในรายการที่กำหนด", course.roomType);
    }
    if (typeof course.teacherId !== "string" || (course.teacherId !== "" && !idPattern.test(course.teacherId))) {
      addReview("courses", recordId, "teacherId", "รหัสผู้สอนไม่ถูกต้อง", course.teacherId);
    } else if (course.teacherId !== "" && !teacherIds.has(course.teacherId)) {
      addReview("courses", recordId, "teacherId", "ไม่พบผู้สอนตามรหัสที่ระบุ", course.teacherId);
    }
    if (course.category === "general" && typeof course.teacherId === "string" && course.teacherId !== "") {
      addReview("courses", recordId, "teacherId", "รายวิชาสามัญไม่กำหนดผู้สอนจากแผนก", course.teacherId);
    }
    checkSource(course, "courses", recordId);
    checkExtra(course, "courses", recordId);
  }

  for (const [index, room] of rooms.entries()) {
    if (!isRecord(room)) {
      addReview("rooms", "", "record", "ข้อมูลห้องเรียนมีรูปแบบไม่ถูกต้อง", room ?? index);
      continue;
    }
    const recordId = checkId(room, "rooms", index);
    checkKeys(room, ["id", "name", "type", "size", "unavailable"], "rooms", recordId);
    checkText(room, "rooms", recordId, "name");
    if (!["computer", "lab", "general"].includes(room.type)) {
      addReview("rooms", recordId, "type", "ประเภทห้องไม่อยู่ในรายการที่กำหนด", room.type);
    }
    if (
      room.size !== "" &&
      room.size !== null &&
      (!Number.isInteger(room.size) || room.size < 0)
    ) {
      addReview("rooms", recordId, "size", "ขนาดห้องต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไปหรือเว้นว่าง", room.size);
    }
    if (!Array.isArray(room.unavailable)) {
      addReview("rooms", recordId, "unavailable", "เวลาที่ห้องไม่ว่างต้องเป็นรายการ", room.unavailable);
    } else {
      for (const range of room.unavailable) checkRange("rooms", recordId, "unavailable", range);
    }
  }

  const off = sectionArrays.get("off");
  for (const [index, item] of off.entries()) {
    if (!isRecord(item) || typeof item.section !== "string" || typeof item.field !== "string") {
      addReview("off", "", "off", "รายการส่วนที่ปิดใช้งานมีรูปแบบไม่ถูกต้อง", item ?? index);
    } else {
      checkKeys(item, ["section", "field"], "off", "");
    }
  }
  if (
    off.some((item) => isRecord(item) && item.section === "rooms" && item.field === "") &&
    rooms.length > 0
  ) {
    addReview("rooms", "", "rooms", "เมื่อปิดส่วนห้องเรียน ต้องไม่มีรายการห้อง", rooms);
  }

  for (const year of years) {
    if (!limitYears.has(year)) {
      addReview("time", "", "finishLimits", "ไม่พบขีดจำกัดคาบเลิกเรียนของชั้นปี", year);
    }
  }

  const seenCourseCodes = new Map();
  for (const course of courses) {
    if (!isRecord(course) || typeof course.code !== "string" || course.code.trim() === "") continue;
    const normalizedCode = course.code.replace(/\s/g, "");
    if (seenCourseCodes.has(normalizedCode)) {
      addReview("courses", typeof course.id === "string" ? course.id : "", "code", "พบรหัสวิชาซ้ำกัน", course.code);
    } else {
      seenCourseCodes.set(normalizedCode, course.id);
    }
  }

  return reviewItems;
}

module.exports = { validateInput };
