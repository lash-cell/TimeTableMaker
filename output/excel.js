"use strict";

const ExcelJS = require("exceljs");
const { buildView } = require("./views");

function uniqueSheetName(label, usedNames, fallback) {
  const cleaned = String(label || fallback)
    .replace(/[\\/?*[\]:]/g, "-")
    .replace(/^'+|'+$/g, "")
    .trim()
    .slice(0, 31) || fallback;
  let name = cleaned;
  let suffixNumber = 2;
  while (usedNames.has(name.toLocaleLowerCase())) {
    const suffix = ` (${suffixNumber})`;
    name = `${cleaned.slice(0, 31 - suffix.length)}${suffix}`;
    suffixNumber += 1;
  }
  usedNames.add(name.toLocaleLowerCase());
  return name;
}

function lessonText(kind, lesson) {
  const parts = [`${lesson.code} ${lesson.name}`];
  if (kind === "group" && lesson.teacherName) parts.push(lesson.teacherName);
  if (kind === "teacher") parts.push(lesson.groupNames.join(", "));
  if (kind === "room") {
    parts.push(lesson.groupNames.join(", "));
    if (lesson.teacherName) parts.push(lesson.teacherName);
  }
  if (kind !== "room" && lesson.roomName) parts.push(lesson.roomName);
  return parts.filter(Boolean).join(" / ");
}

function addGridSheet(workbook, input, result, kind, key, label, usedNames, { pdf = false } = {}) {
  const view = buildView(input, result, kind, key);
  const worksheet = workbook.addWorksheet(uniqueSheetName(label, usedNames, kind));
  if (pdf) {
    worksheet.addRow([label]);
    worksheet.mergeCells(1, 1, 1, input.time.periodsPerDay + 1);
    worksheet.getRow(1).font = { name: "Noto Sans Thai", bold: true, size: 14 };
    worksheet.getRow(1).alignment = { horizontal: "center", vertical: "middle" };
    worksheet.getRow(1).height = 28;
  }
  const header = worksheet.addRow(["วัน", ...Array.from(
    { length: input.time.periodsPerDay },
    (_, index) => index + 1,
  )]);
  const headerRow = header.number;
  worksheet.views = [{ state: "frozen", xSplit: 1, ySplit: headerRow }];
  header.font = { name: pdf ? "Noto Sans Thai" : undefined, bold: true };
  worksheet.getColumn(1).width = pdf ? 15 : 18;
  for (let period = 1; period <= input.time.periodsPerDay; period += 1) {
    worksheet.getColumn(period + 1).width = pdf ? 9 : 18;
  }

  for (const day of view.rows) {
    const row = worksheet.addRow([day.dayName, ...Array(input.time.periodsPerDay).fill(null)]);
    for (const cell of day.cells) {
      const startColumn = cell.start + 1;
      const endColumn = cell.end + 1;
      if (cell.type === "lesson") {
        if (endColumn > startColumn) {
          worksheet.mergeCells(row.number, startColumn, row.number, endColumn);
        }
        row.getCell(startColumn).value = lessonText(kind, cell.lesson);
        row.getCell(startColumn).alignment = {
          horizontal: "center",
          vertical: "middle",
          wrapText: true,
        };
      } else if (cell.type === "break") {
        row.getCell(startColumn).value = "พัก";
      }
    }
    row.height = pdf ? 48 : 36;
    if (pdf) {
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.font = { name: "Noto Sans Thai", size: 8 };
        cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      });
    }
  }
  if (pdf) {
    worksheet.pageSetup = {
      paperSize: 9,
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 1,
      margins: { left: 0.2, right: 0.2, top: 0.25, bottom: 0.25, header: 0.1, footer: 0.1 },
    };
    worksheet.pageSetup.printArea = `A1:${worksheet.getColumn(input.time.periodsPerDay + 1).letter}${worksheet.rowCount}`;
  }
  return worksheet;
}

async function createExcelBuffer(input, result) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "TimeTableMaker";
  const usedNames = new Set();

  for (const kind of ["group", "teacher", "room"]) {
    const view = buildView(input, result, kind);
    for (const key of view.keys) {
      addGridSheet(workbook, input, result, kind, key.id, key.label, usedNames);
    }
  }

  const courseView = buildView(input, result, "course");
  const allLessons = workbook.addWorksheet(uniqueSheetName("ทุกรายวิชา", usedNames, "Lessons"));
  allLessons.addRow(["วัน", "คาบ", "รหัสวิชา", "รายวิชา", "กลุ่ม", "ผู้สอน", "ห้อง"]);
  allLessons.getRow(1).font = { bold: true };
  for (const lesson of courseView.lessons) {
    allLessons.addRow([
      input.time.days[lesson.day],
      `${lesson.start}-${lesson.end}`,
      lesson.code,
      lesson.name,
      lesson.groupNames.join(", "),
      lesson.teacherName,
      lesson.roomName,
    ]);
  }
  allLessons.columns.forEach((column, index) => {
    column.width = [16, 10, 18, 30, 24, 24, 18][index];
  });
  allLessons.views = [{ state: "frozen", ySplit: 1 }];

  const output = await workbook.xlsx.writeBuffer();
  return Buffer.isBuffer(output) ? output : Buffer.from(output);
}

module.exports = { addGridSheet, createExcelBuffer, uniqueSheetName };
