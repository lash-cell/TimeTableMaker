"use strict";

const ExcelJS = require("exceljs");

class WorkbookReadError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = "WorkbookReadError";
    this.code = code;
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function columnNumber(letters) {
  let number = 0;
  for (const letter of letters) {
    number = number * 26 + letter.charCodeAt(0) - 64;
  }
  return number;
}

function mergeBounds(range) {
  const match = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(range);
  if (!match) return null;
  return {
    row: Number(match[4]),
    column: columnNumber(match[3]),
  };
}

function plainText(value, onMissingFormulaResult) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value.richText)) {
    return value.richText.map((segment) => segment.text ?? "").join("");
  }
  if (isRecord(value) && (value.formula || value.sharedFormula)) {
    if (!Object.hasOwn(value, "result") || value.result === undefined) {
      onMissingFormulaResult(value);
      return "";
    }
    return plainText(value.result, onMissingFormulaResult);
  }
  if (isRecord(value) && typeof value.error === "string") return value.error;
  if (isRecord(value) && typeof value.text === "string") return value.text;
  return String(JSON.stringify(value));
}

async function readWorkbook(buffer) {
  if (!(buffer instanceof Uint8Array) || buffer.byteLength === 0) {
    throw new WorkbookReadError("bad_input", "กรุณาเลือกไฟล์ Excel ที่มีข้อมูล");
  }

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch (error) {
    throw new WorkbookReadError("unreadable_file", "ไม่สามารถเปิดอ่านไฟล์ Excel ได้", { cause: error });
  }

  if (workbook.worksheets.length === 0) {
    throw new WorkbookReadError("bad_input", "ไฟล์ Excel ไม่มีแผ่นงานที่อ่านได้");
  }

  const reviewItems = [];
  const sheets = workbook.worksheets.map((worksheet) => {
    const merges = worksheet.model.merges ?? [];
    let rowCount = worksheet.rowCount;
    let columnCount = worksheet.columnCount;
    for (const merge of merges) {
      const bounds = mergeBounds(merge);
      if (bounds) {
        rowCount = Math.max(rowCount, bounds.row);
        columnCount = Math.max(columnCount, bounds.column);
      }
    }

    const rows = [];
    for (let rowNumber = 1; rowNumber <= rowCount; rowNumber += 1) {
      const cells = [];
      for (let column = 1; column <= columnCount; column += 1) {
        const cell = worksheet.getCell(rowNumber, column);
        cells.push(plainText(cell.value, (formula) => {
          const formulaText = formula.formula ?? formula.sharedFormula ?? "";
          reviewItems.push({
            id: `review-${reviewItems.length + 1}`,
            section: "file",
            recordId: "",
            field: cell.address,
            problem: "เซลล์สูตรไม่มีผลลัพธ์ที่บันทึกไว้ กรุณาตรวจสอบหรือบันทึกไฟล์ใหม่",
            original: `${worksheet.name}!${cell.address}: ${formulaText}`,
          });
        }));
      }
      rows.push({ row: rowNumber, cells });
    }
    return { name: worksheet.name, rows };
  });

  if (sheets.every((sheet) => sheet.rows.length === 0 || sheet.rows.every((row) => row.cells.every((cell) => cell === "")))) {
    throw new WorkbookReadError("bad_input", "ไฟล์ Excel ไม่มีข้อมูลให้อ่าน");
  }

  return { sheets, reviewItems };
}

module.exports = { readWorkbook, WorkbookReadError };
