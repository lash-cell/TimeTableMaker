"use strict";

const path = require("node:path");
const ExcelJS = require("exceljs");
const { proposeMatches } = require("../lib/column-matcher");
const { convertMatchesToInput } = require("../lib/row-converter");
const { readWorkbook } = require("../lib/workbook-reader");
const { getDataGuide, getUploadFields } = require("../data/form-definition");
const defaults = require("../defaults.json");

const uploadLimitBytes = 30 * 1024 * 1024;
const badInputMessage = "กรุณาตรวจสอบข้อมูลที่ส่งมา";

function workflowError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function emptyInput() {
  const { time } = defaults;
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

function safeFileName(fileName) {
  return path.posix.basename(String(fileName).replaceAll("\\", "/"));
}

async function proposeWorkbook(buffer, fileName) {
  if (buffer.byteLength > uploadLimitBytes) {
    throw workflowError("too_large", "ไฟล์มีขนาดเกิน 30 MB");
  }
  if (path.extname(fileName).toLocaleLowerCase() !== ".xlsx") {
    throw workflowError("unsupported_file", "รองรับเฉพาะไฟล์ .xlsx");
  }
  const workbook = await readWorkbook(buffer);
  return {
    ...proposeMatches(workbook.sheets),
    fileName: safeFileName(fileName),
    sourceSheets: workbook.sheets,
    readerReviewItems: workbook.reviewItems,
  };
}

function proposePaste(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw workflowError("bad_input", badInputMessage);
  }
  const { section, year, text } = value;
  if (!["courses", "teachers"].includes(section) || typeof text !== "string" || !text.trim()) {
    throw workflowError("bad_input", badInputMessage);
  }
  if (section === "courses" && (typeof year !== "string" || !year.trim())) {
    throw workflowError("bad_input", "กรุณาระบุชั้นปีของรายวิชา");
  }
  const lines = text.replace(/\r\n?/gu, "\n").split("\n");
  const rows = lines
    .map((line, index) => ({ row: index + 1, cells: line.split("\t").map((cell) => cell.trim()) }))
    .filter((row) => row.cells.some(Boolean));
  if (!rows.length) throw workflowError("bad_input", badInputMessage);
  const sheet = {
    name: section === "courses" ? year.trim() : "Teachers",
    rows,
  };
  const proposal = proposeMatches([sheet]);
  const match = proposal.sheets[0];
  if (match.sheetType !== section) {
    throw workflowError("bad_input", "ไม่พบแถวหัวตารางที่ตรงกับส่วนข้อมูลที่เลือก");
  }
  return {
    ...proposal,
    sourceSheets: [sheet],
    fileName: section === "courses" ? `${year.trim()}.xlsx` : "Pasted Teachers.xlsx",
    readerReviewItems: [],
  };
}

function applyMatchProposal(proposal, existingInput) {
  if (
    !proposal ||
    !Array.isArray(proposal.sheets) ||
    !Array.isArray(proposal.sourceSheets) ||
    typeof proposal.fileName !== "string"
  ) {
    throw workflowError("bad_input", badInputMessage);
  }
  try {
    const converted = convertMatchesToInput(proposal, {
      fileName: proposal.fileName,
      importId: proposal.importId,
      sourceSheets: proposal.sourceSheets,
      readerReviewItems: proposal.readerReviewItems ?? [],
      existingInput,
    });
    return { input: converted.input, warnings: converted.warnings, skipped: converted.skipped };
  } catch (error) {
    if (error instanceof TypeError || error instanceof RangeError) {
      throw workflowError("bad_input", badInputMessage);
    }
    throw error;
  }
}

async function createTemplateBuffer() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "TimeTableMaker";
  for (const section of ["courses", "teachers"]) {
    const fields = getUploadFields(section);
    const worksheet = workbook.addWorksheet(section === "courses" ? "Courses" : "Teachers");
    worksheet.addRow(fields.map((field) => field.label));
    worksheet.getRow(1).font = { bold: true };
    worksheet.views = [{ state: "frozen", ySplit: 1 }];
    worksheet.columns = fields.map(() => ({ width: 24 }));
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
}

module.exports = {
  applyMatchProposal,
  createTemplateBuffer,
  emptyInput,
  getDataGuide,
  proposePaste,
  proposeWorkbook,
  safeFileName,
  workflowError,
};
