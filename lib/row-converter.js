"use strict";

const defaultWords = require("../words.json");
const defaultGuidelines = require("../defaults.json");

const REVIEW_MESSAGES = {
  category: "ไม่สามารถระบุหมวดวิชาได้แน่ชัด กรุณาตรวจสอบ",
  fixed: "ไม่สามารถอ่านวันและช่วงคาบจากข้อกำหนดได้ กรุณาตรวจสอบ",
  groups: "ไม่สามารถอ่านรายชื่อกลุ่มจากหัวตารางได้ กรุณาตรวจสอบ",
  kind: "ไม่สามารถระบุประเภททฤษฎีหรือปฏิบัติได้ กรุณาตรวจสอบ",
  periods: "จำนวนคาบรายสัปดาห์ไม่ใช่จำนวนเต็มบวก กรุณาตรวจสอบ",
  position: "ไม่พบคำบอกตำแหน่งผู้สอน กรุณากำหนดตำแหน่งและคาบงาน",
  teacherNote: "ไม่สามารถอ่านวันและช่วงเวลาว่างของผู้สอนได้ กรุณาตรวจสอบ",
  year: "ไม่สามารถระบุชั้นปีจากชื่อแผ่นงานได้ กรุณาตรวจสอบ",
  row: "แถวนี้มีข้อมูลแต่ไม่ครบพอที่จะจัดประเภท กรุณาตรวจสอบ",
};

function normalizeText(value) {
  return String(value ?? "").trim().toLocaleLowerCase().replace(/\s/gu, "");
}

function sourceText(value) {
  return String(value ?? "").trim();
}

function textIncludesAny(value, terms) {
  const normalized = normalizeText(value);
  return terms.some((term) => normalized.includes(normalizeText(term)));
}

function dayInText(value, words, days) {
  const text = normalizeText(value);
  const matches = [];
  for (const [day, synonyms] of Object.entries(words.dayWords)) {
    if (!days.includes(day)) continue;
    const matchingWords = synonyms
      .filter((synonym) => text.includes(normalizeText(synonym)))
      .sort((left, right) => normalizeText(right).length - normalizeText(left).length);
    if (matchingWords.length) matches.push({ day, length: normalizeText(matchingWords[0]).length });
  }
  const longest = Math.max(0, ...matches.map((match) => match.length));
  const best = matches.filter((match) => match.length === longest);
  return best.length === 1 ? best[0].day : "";
}

function periodRange(value) {
  const match = /(?:คาบ(?:ที่)?|periods?)\s*(\d+)\s*-\s*(\d+)/iu.exec(String(value ?? ""));
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start) return null;
  return { start, end };
}

function parseRange(value, words, days) {
  const day = dayInText(value, words, days);
  const range = periodRange(value);
  if (!day || !range) return null;
  return { day: days.indexOf(day), ...range };
}

function parseYear(sheetName) {
  const match = /(?:ปวช\.|vocational\s+certificate\s+year|year)\s*(\d+)/iu.exec(sheetName);
  return match ? { value: sheetName, number: Number(match[1]) } : { value: "", number: null };
}

function parseGroups(title, year) {
  let text = sourceText(title);
  text = text.replace(/^\d+\s*(?:กลุ่ม|groups?)\s*:?\s*/iu, "").trim();
  const direct = text.split(/\s*,\s*/u);
  if (direct.length > 1 && direct.every((name) => /.+\/\d+$/u.test(name))) {
    return direct.map((name) => ({ name, year }));
  }

  const range = /^(.+\/)(\d+)\s*-\s*(\d+)$/u.exec(text);
  if (!range) return null;
  const first = Number(range[2]);
  const last = Number(range[3]);
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || last < first || last - first > 20) {
    return null;
  }
  return Array.from({ length: last - first + 1 }, (_, index) => ({
    name: `${range[1]}${first + index}`,
    year,
  }));
}

function categoryFromText(value, words) {
  const normalized = normalizeText(value);
  const matches = [];
  for (const [category, synonyms] of Object.entries(words.categoryWords)) {
    for (const synonym of synonyms) {
      const term = normalizeText(synonym);
      if (term && normalized.includes(term)) matches.push({ category, length: term.length });
    }
  }
  const longest = Math.max(0, ...matches.map((match) => match.length));
  const best = [...new Set(matches.filter((match) => match.length === longest).map((match) => match.category))];
  return best.length === 1 ? best[0] : "";
}

function kindFromText(value, words) {
  const normalized = normalizeText(value);
  const matches = Object.entries(words.kindWords)
    .filter(([, synonyms]) => synonyms.some((word) => normalized.includes(normalizeText(word))))
    .map(([kind]) => kind);
  return matches.length === 1 ? matches[0] : "";
}

function roomTypeFromText(value, words) {
  const normalized = normalizeText(value);
  if (!normalized) return "";
  const hasComputer = words.roomWords.computer.some((word) => normalized.includes(normalizeText(word)));
  const hasLab = words.roomWords.lab.some((word) => normalized.includes(normalizeText(word)));
  if (hasComputer && hasLab) return "computerOrLab";
  if (hasComputer) return "computer";
  if (hasLab) return "lab";
  return "general";
}

function positionFromText(value, words) {
  const normalized = normalizeText(value);
  const matches = Object.entries(words.positionWords)
    .filter(([, synonyms]) => synonyms.some((word) => normalized.includes(normalizeText(word))))
    .map(([position]) => position);
  return matches.length === 1 ? matches[0] : "other";
}

function cellAt(row, index) {
  return index === undefined ? "" : sourceText(row.cells[index - 1]);
}

function columnFor(sheet, field) {
  return sheet.columns.find((column) => column.field === field);
}

function rowPreview(row) {
  return row.cells.map(sourceText).join(" | ");
}

function isEmptyRow(row) {
  return row.cells.every((cell) => sourceText(cell) === "");
}

function makeInput(defaults, existingInput) {
  if (existingInput) {
    return structuredClone(existingInput);
  }
  const time = defaults.time;
  return {
    format: 1,
    groups: [],
    courses: [],
    teachers: [],
    rooms: [],
    time: {
      days: [...time.days],
      periodsPerDay: time.periodsPerDay,
      breakPeriods: [...time.breakPeriods],
      finishLimits: [],
      activitySlot: { ...time.activitySlot },
      fromGuideline: ["days", "periodsPerDay", "breakPeriods", "finishLimits", "activitySlot"],
    },
    off: [{ section: "rooms", field: "" }],
    review: [],
    confirmed: false,
  };
}

function nextId(prefix, records) {
  const max = records.reduce((current, record) => {
    const match = new RegExp(`^${prefix}-(\\d+)$`).exec(record.id ?? "");
    return match ? Math.max(current, Number(match[1])) : current;
  }, 0);
  return `${prefix}-${max + 1}`;
}

function yearNumber(value) {
  return parseYear(value).number;
}

function groupIdentity(group) {
  const parsedYear = yearNumber(group.year);
  const tail = /\/(\d+)$/u.exec(group.name)?.[1];
  if (parsedYear !== null && tail) return `${parsedYear}:${tail}`;
  return `${group.year}:${group.name}`;
}

function courseIdentity(code) {
  return sourceText(code).replace(/\s/gu, "").toLocaleLowerCase();
}

function teacherIdentity(name) {
  return normalizeText(name);
}

function nextReviewId(review) {
  const max = review.reduce((current, item) => {
    const match = /^review-(\d+)$/u.exec(item.id ?? "");
    return match ? Math.max(current, Number(match[1])) : current;
  }, 0);
  return `review-${max + 1}`;
}

function buildTimeFinishLimits(input, defaults) {
  const years = [...new Set(input.groups.map((group) => group.year))];
  const existingLimits = new Map(input.time.finishLimits.map((limit) => [limit.year, limit]));
  for (const year of years) {
    if (!existingLimits.has(year)) {
      existingLimits.set(year, {
        year,
        lastPeriod: yearNumber(year) === 1
          ? defaults.time.finishLimits.vocationalCertificateYear1
          : defaults.time.finishLimits.otherYears,
      });
    }
  }
  input.time.finishLimits = years.map((year) => existingLimits.get(year));
}

function addReview(target, section, recordId, field, problem, original) {
  target.push({ section, recordId, field, problem, original: String(original ?? "") });
}

function mapExtra(sheet, row) {
  return sheet.columns
    .filter((column) => !column.field)
    .map((column) => ({ header: column.header, value: cellAt(row, column.index) }))
    .filter((item) => item.value !== "");
}

function isTotalRow(row, words) {
  const text = row.cells.map(sourceText).filter(Boolean).join(" ");
  return textIncludesAny(text, words.totalWords);
}

function isRepeatedHeader(row, sheet) {
  const mapped = sheet.columns.filter((column) => column.field);
  if (mapped.length < 2) return false;
  const matching = mapped.filter((column) =>
    normalizeText(cellAt(row, column.index)) === normalizeText(column.header));
  return matching.length >= 2;
}

function makeSource(fileName, sheetName, rowNumber, importId) {
  return {
    how: "file",
    file: fileName,
    sheet: sheetName,
    row: rowNumber,
    confirmed: false,
    ...(importId ? { importId } : {}),
  };
}

function convertMatchesToInput(matchProposal, options = {}) {
  if (!matchProposal || !Array.isArray(matchProposal.sheets)) {
    throw new TypeError("matchProposal.sheets must be an array");
  }
  if (typeof options.fileName !== "string" || options.fileName.trim() === "") {
    throw new TypeError("fileName must be a non-empty string");
  }
  const defaults = options.defaults ?? defaultGuidelines;
  const words = options.words ?? defaultWords;
  const sourceSheets = options.sourceSheets ?? [];
  if (!Array.isArray(sourceSheets)) {
    throw new TypeError("sourceSheets must be an array of workbook sheets");
  }
  const input = makeInput(defaults, options.existingInput);
  const skipped = [];
  const warnings = [];
  const pendingReviews = [];
  const existingCourseKeys = new Set(input.courses.map((course) => courseIdentity(course.code)));
  const existingTeacherKeys = new Set(input.teachers.map((teacher) => teacherIdentity(teacher.name)));
  const existingGroupKeys = new Set(input.groups.map(groupIdentity));
  const duplicateTeacherNames = new Set();
  const existingYearByNumber = new Map(
    input.groups
      .map((group) => [yearNumber(group.year), group.year])
      .filter(([number]) => number !== null),
  );
  const duplicateCourseCodes = new Set();
  const addedGroups = new Set();

  const addSkipped = (sheet, row, reason) => {
    skipped.push({ sheet: sheet.name, row: row.row, reason, preview: rowPreview(row) });
  };
  const recordReview = (section, recordId, field, original, reviews = pendingReviews) => {
    addReview(reviews, section, recordId, field, REVIEW_MESSAGES[field] ?? "กรุณาตรวจสอบข้อมูลนี้", original);
  };

  for (const sheet of matchProposal.sheets) {
    const sourceSheet = sourceSheets.find((candidate) => candidate.name === sheet.name);
    const rows = [...(sourceSheet?.rows ?? sheet.rows ?? [])].sort((left, right) => left.row - right.row);
    if (!rows.length && sheet.headerRow !== null) {
      throw new TypeError(`source rows are required for matched sheet: ${sheet.name}`);
    }
    if (sheet.sheetType !== "courses" && sheet.sheetType !== "teachers") {
      for (const row of rows) {
        addSkipped(sheet, row, isEmptyRow(row) ? "empty" : row.row === sheet.headerRow ? "header" : "heading");
      }
      continue;
    }

    const year = sheet.sheetType === "courses" ? parseYear(sheet.name) : null;
    const effectiveYear = year && year.number !== null
      ? existingYearByNumber.get(year.number) ?? year.value
      : year?.value ?? "";
    let category = "";
    const headersBeforeOrAt = rows.filter((row) => row.row <= (sheet.headerRow ?? 0));
    const titleRows = [];
    for (const row of headersBeforeOrAt) {
      if (row.row === sheet.headerRow) {
        addSkipped(sheet, row, "header");
        continue;
      }
      const rowText = row.cells.map(sourceText).filter(Boolean).join(" ");
      const rowCategory = categoryFromText(rowText, words);
      if (rowCategory) category = rowCategory;
      if (sheet.sheetType === "courses" && !isEmptyRow(row)) {
        titleRows.push({ row, groupTitle: row.cells.map(sourceText).find(Boolean) ?? "" });
      } else if (sheet.sheetType === "teachers" && !isEmptyRow(row)) {
        addSkipped(sheet, row, "title");
      } else {
        addSkipped(sheet, row, isEmptyRow(row) ? "empty" : rowCategory ? "heading" : "title");
      }
    }

    if (sheet.sheetType === "courses") {
      for (const { row, groupTitle } of titleRows) {
        const rowText = row.cells.map(sourceText).filter(Boolean).join(" ");
        if (categoryFromText(rowText, words)) {
          addSkipped(sheet, row, "heading");
          continue;
        }
        const groups = parseGroups(groupTitle, effectiveYear);
        if (!groups) {
          addSkipped(sheet, row, "title");
          recordReview("groups", "", "groups", groupTitle);
          continue;
        }
        for (const group of groups) {
          const identity = groupIdentity(group);
          if (existingGroupKeys.has(identity) || addedGroups.has(identity)) continue;
          input.groups.push({
            id: nextId("g", input.groups),
            name: group.name,
            year: group.year,
            ...(options.importId ? { importId: options.importId } : {}),
          });
          addedGroups.add(identity);
        }
        addSkipped(sheet, row, "title");
      }
      if (!year?.value) recordReview("courses", "", "year", sheet.name);
    }

    const headers = sheet.columns ?? [];
    const indices = Object.fromEntries(headers.map((column) => [column.field, column.index]));
    let activeCategory = category;
    for (const row of rows) {
      if (row.row <= (sheet.headerRow ?? 0)) continue;
      if (isEmptyRow(row)) {
        addSkipped(sheet, row, "empty");
        continue;
      }
      if (isRepeatedHeader(row, sheet)) {
        addSkipped(sheet, row, "repeatedHeader");
        continue;
      }
      if (isTotalRow(row, words)) {
        addSkipped(sheet, row, "total");
        continue;
      }

      const rowText = row.cells.map(sourceText).filter(Boolean).join(" ");
      if (sheet.sheetType === "courses") {
        const code = cellAt(row, indices.courseCode);
        const name = cellAt(row, indices.courseName);
        const periodsText = cellAt(row, indices.periodsPerWeek);
        const nonEmptyCells = row.cells.map(sourceText).filter(Boolean);
        if (!code && !name && nonEmptyCells.length === 1 && /^\d+$/u.test(nonEmptyCells[0])) {
          addSkipped(sheet, row, "total");
          continue;
        }
        const rowCategory = categoryFromText(rowText, words);
        const hasCourseRecordValues = Boolean(
          code || name || periodsText || cellAt(row, indices.kind),
        );
        const distinctRowValues = new Set(row.cells.map(normalizeText).filter(Boolean));
        if (rowCategory && (!hasCourseRecordValues || distinctRowValues.size === 1)) {
          activeCategory = rowCategory;
          addSkipped(sheet, row, "heading");
          continue;
        }
        const hasCourseFields = ["courseCode", "courseName", "periodsPerWeek", "kind", "requirement", "roomDescription"]
          .some((field) => cellAt(row, indices[field]) !== "") || mapExtra(sheet, row).length > 0;
        if (!hasCourseFields) {
          addSkipped(sheet, row, "heading");
          continue;
        }

        const periods = /^\d+$/u.test(periodsText) ? Number(periodsText) : 0;
        const kindText = cellAt(row, indices.kind);
        const requirement = cellAt(row, indices.requirement);
        const roomText = cellAt(row, indices.roomDescription);
        const recordId = nextId("c", input.courses);
        const localReviews = [];
        if (!year?.value) recordReview("courses", recordId, "year", sheet.name, localReviews);
        if (!Number.isInteger(periods) || periods < 1) {
          recordReview("courses", recordId, "periods", periodsText, localReviews);
        }
        const kind = kindFromText(kindText, words);
        if (!kind) recordReview("courses", recordId, "kind", kindText, localReviews);

        const nameSuggestsActivity = textIncludesAny(name, words.categoryWords.activity);
        const courseCategory = nameSuggestsActivity ? "activity" : activeCategory;
        if (!courseCategory) recordReview("courses", recordId, "category", name, localReviews);
        if (nameSuggestsActivity) {
          recordReview("courses", recordId, "category", name, localReviews);
        }

        let fixed = null;
        if (requirement) {
          fixed = parseRange(requirement, words, input.time.days);
          if (!fixed) recordReview("courses", recordId, "fixed", requirement, localReviews);
        } else if (courseCategory === "activity") {
          fixed = { ...input.time.activitySlot };
        }
        if (fixed && fixed.end - fixed.start + 1 !== periods) {
          recordReview("courses", recordId, "fixed", requirement || JSON.stringify(fixed), localReviews);
        }

        const course = {
          id: recordId,
          code,
          name,
          year: effectiveYear,
          periods,
          kind,
          category: courseCategory,
          fixed,
          roomType: roomTypeFromText(roomText, words),
          teacherId: "",
          source: makeSource(options.fileName.trim(), sheet.name, row.row, options.importId),
          extra: mapExtra(sheet, row),
        };
        if (!code || !name) recordReview("courses", recordId, "row", rowPreview(row), localReviews);

        const identity = courseIdentity(code);
        if (identity && existingCourseKeys.has(identity)) {
          duplicateCourseCodes.add(code);
          continue;
        }
        input.courses.push(course);
        if (identity) existingCourseKeys.add(identity);
        pendingReviews.push(...localReviews);
      } else {
        const name = cellAt(row, indices.teacherName);
        const recordId = nextId("t", input.teachers);
        const localReviews = [];
        const positionText = cellAt(row, indices.position);
        const position = positionFromText(positionText, words);
        const band = defaults.workloadBands[position];
        if (position === "other") recordReview("teachers", recordId, "position", positionText, localReviews);

        const note = cellAt(row, indices.teacherNote);
        const unavailable = [];
        if (note) {
          const availability = textIncludesAny(note, words.availabilityWords);
          const range = availability ? parseRange(note, words, input.time.days) : null;
          if (range) unavailable.push(range);
          else recordReview("teachers", recordId, "teacherNote", note, localReviews);
        }
        if (!name) recordReview("teachers", recordId, "row", rowPreview(row), localReviews);

        const identity = teacherIdentity(name);
        if (identity && existingTeacherKeys.has(identity)) {
          duplicateTeacherNames.add(name);
          continue;
        }
        input.teachers.push({
          id: recordId,
          name,
          position,
          minPeriods: band?.minPeriods ?? 0,
          maxPeriods: band?.maxPeriods ?? 0,
          unavailable,
          source: makeSource(options.fileName.trim(), sheet.name, row.row, options.importId),
          extra: mapExtra(sheet, row),
        });
        if (identity) existingTeacherKeys.add(identity);
        pendingReviews.push(...localReviews);
      }
    }

    if (sheet.sheetType === "courses" && sheet.headerRow == null) {
      recordReview("courses", "", "row", sheet.name);
    }
    if (sheet.sheetType === "teachers" && sheet.headerRow == null) {
      recordReview("teachers", "", "row", sheet.name);
    }
  }

  if (duplicateCourseCodes.size) {
    warnings.push(`พบรหัสวิชาซ้ำในข้อมูลเดิมหรือไฟล์ที่นำเข้า: ${[...duplicateCourseCodes].join(", ")} จึงไม่นำรายวิชาซ้ำเข้าระบบ`);
    if (matchProposal.sheets.some((sheet) => sheet.sheetType === "teachers")) {
      warnings.push("พบรายวิชาซ้ำและมีชีตผู้สอนในไฟล์นี้ รายชื่อผู้สอนอาจเป็นสำเนาชุดเดิม กรุณาตรวจสอบ");
    }
  }
  if (duplicateTeacherNames.size) {
    warnings.push(`พบรายชื่อผู้สอนซ้ำระหว่างไฟล์: ${[...duplicateTeacherNames].join(", ")} จึงไม่นำรายชื่อซ้ำเข้าระบบ`);
  }

  buildTimeFinishLimits(input, defaults);
  for (const item of options.readerReviewItems ?? []) {
    pendingReviews.push({
      section: "file",
      recordId: "",
      field: item.field,
      problem: item.problem,
      original: item.original,
    });
  }
  for (const review of pendingReviews) {
    input.review.push({
      id: nextReviewId(input.review),
      ...review,
      ...(options.importId ? { importId: options.importId } : {}),
    });
  }
  input.confirmed = false;
  return { input, skipped, warnings };
}

module.exports = { convertMatchesToInput };
