"use strict";

const words = require("../words.json");

const sheetFields = {
  courses: ["courseCode", "courseName", "periodsPerWeek", "kind", "requirement", "roomDescription"],
  teachers: ["teacherName", "position", "teacherNote"],
};

function normalizeHeader(value) {
  return String(value ?? "").toLocaleLowerCase().replace(/\s/gu, "");
}

function matchHeader(header, fields) {
  const normalizedHeader = normalizeHeader(header);
  let longest = 0;
  let matchedFields = [];

  for (const field of fields) {
    for (const synonym of words.headerSynonyms[field]) {
      const normalizedSynonym = normalizeHeader(synonym);
      if (!normalizedSynonym || !normalizedHeader.includes(normalizedSynonym)) continue;

      if (normalizedSynonym.length > longest) {
        longest = normalizedSynonym.length;
        matchedFields = [field];
      } else if (normalizedSynonym.length === longest && !matchedFields.includes(field)) {
        matchedFields.push(field);
      }
    }
  }

  if (matchedFields.length !== 1) return { field: "", sure: "no" };
  return { field: matchedFields[0], sure: "yes" };
}

function scoreRow(row) {
  const fields = {};
  for (const type of Object.keys(sheetFields)) {
    fields[type] = new Set(
      row.cells
        .map((header) => matchHeader(header, sheetFields[type]))
        .filter((match) => match.field)
        .map((match) => match.field),
    );
  }
  return fields;
}

function selectHeader(rows) {
  let selected = null;
  for (const row of rows) {
    const scores = scoreRow(row);
    const courseCount = scores.courses.size;
    const teacherCount = scores.teachers.size;
    const score = Math.max(courseCount, teacherCount);
    if (score === 0) continue;

    if (!selected || score > selected.score) {
      selected = { row, scores, score };
    }
  }
  return selected;
}

function proposeSheet(sheet) {
  const rows = [...sheet.rows].sort((a, b) => a.row - b.row);
  const selected = selectHeader(rows);
  if (!selected) {
    return {
      name: sheet.name,
      sheetType: "document",
      headerRow: null,
      columns: [],
      sampleRows: [],
    };
  }

  const courseCount = selected.scores.courses.size;
  const teacherCount = selected.scores.teachers.size;
  const sheetType = courseCount > teacherCount
    ? "courses"
    : teacherCount > courseCount
      ? "teachers"
      : "document";
  if (sheetType === "document") {
    return {
      name: sheet.name,
      sheetType,
      headerRow: selected.row.row,
      columns: selected.row.cells.map((header, index) => ({
        index: index + 1,
        header,
        samples: [],
        field: "",
        sure: "no",
      })),
      sampleRows: [],
    };
  }

  const fields = sheetFields[sheetType];
  const columns = selected.row.cells.map((header, index) => {
    const match = matchHeader(header, fields);
    const samples = rows
      .filter((row) => row.row > selected.row.row)
      .slice(0, 3)
      .map((row) => row.cells[index] ?? "")
      .filter((value) => value !== "");
    return { index: index + 1, header, samples, ...match };
  });
  const sampleRows = rows
    .filter((row) => row.row > selected.row.row)
    .slice(0, 3)
    .map((row) => ({ row: row.row, cells: [...row.cells] }));

  return {
    name: sheet.name,
    sheetType,
    headerRow: selected.row.row,
    columns,
    sampleRows,
  };
}

function proposeMatches(sheets) {
  if (!Array.isArray(sheets)) {
    throw new TypeError("sheets must be an array of workbook sheets");
  }
  return {
    sheets: sheets.map(proposeSheet),
    skipped: [],
    warnings: [],
  };
}

module.exports = { proposeMatches };
