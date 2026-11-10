"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ExcelJS = require("exceljs");
const { readWorkbook } = require("../lib/workbook-reader");

const f1Path = path.join(__dirname, "fixtures/F1/source.xlsx");
const f1EnglishPath = path.join(__dirname, "fixtures/F1/source-en.xlsx");
const englishText = new Map([
  ["รหัสวิชา", "Course Code"],
  ["รายวิชา", "Course Name"],
  ["ชั่วโมง", "Hours"],
  ["ประเภทวิชา", "Course Type"],
  ["ข้อกำหนด", "Requirements"],
  ["ห้องที่ใช้สอน", "Required Room"],
  ["รายชื่อครู", "Teacher Name"],
  ["ตำแหน่ง", "Position"],
  ["ข้อกำหนดเพิ่มเติม", "Additional Requirements"],
  ["รายวิชาสามัญ", "General Education Courses"],
  ["รายวิชาของแผนกวิชา", "Department Courses"],
  ["ทฤษฎี", "Theory"],
  ["ปฏิบัติ", "Practical"],
  ["หัวหน้าแผนก", "Department Head"],
  ["หัวหน้างาน", "Work-unit Head"],
  ["ครูประจำแผนก", "Department Teacher"],
  ["ห้องเรียนภาษาไทย", "Thai classroom"],
  ["ห้องเรียนภาษาอังกฤษ", "English classroom"],
  ["ห้องเรียนคณิตศาสตร์", "Mathematics classroom"],
  ["ห้องเรียนสังคม", "Social studies classroom"],
  ["ห้องเรียนพลศึกษา", "Physical education classroom"],
  ["ใช้ห้องปฏิบัติการ", "Use a laboratory"],
  ["ใช้ห้องคอมพิวเตอร์", "Use a computer room"],
  ["ใช้ห้องคอมพิวเตอร์หรือห้องปฏิบัติการ", "Use a computer room or laboratory"],
  ["แผนกวิชา", "Department"],
]);
const englishDays = new Map([
  ["จันทร์", "Monday"],
  ["อังคาร", "Tuesday"],
  ["พุธ", "Wednesday"],
  ["พฤหัสบดี", "Thursday"],
  ["พฤหัส", "Thursday"],
  ["ศุกร์", "Friday"],
]);

function translateSourceText(text) {
  if (englishText.has(text)) return englishText.get(text);
  if (text.startsWith("2 กลุ่ม ")) return text.replace(/^2 กลุ่ม /u, "2 Groups ").replace("ทค.", "TC.");
  const fixed = /^จัดอยู่ในวัน(จันทร์|อังคาร|พุธ|พฤหัสบดี|พฤหัส|ศุกร์)คาบที่\s*(\d+)-(\d+)$/u.exec(text);
  if (fixed) return `Schedule ${englishDays.get(fixed[1])}, periods ${fixed[2]}-${fixed[3]}`;
  const unavailable = /^ต้องว่างวัน(จันทร์|อังคาร|พุธ|พฤหัสบดี|พฤหัส|ศุกร์)คาบที่\s*(\d+)-(\d+)$/u.exec(text);
  if (unavailable) {
    return `Must not be scheduled ${englishDays.get(unavailable[1])}, periods ${unavailable[2]}-${unavailable[3]}`;
  }
  return text;
}

function plainCellValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value.richText)) return value.richText.map((item) => item.text ?? "").join("");
  return "";
}

test("F1 Thai workbook becomes plain-text rows and uses its cached formula results", async () => {
  const result = await readWorkbook(fs.readFileSync(f1Path));
  assert.equal(result.sheets.length, 4);
  assert.ok(result.sheets.every((sheet) =>
    sheet.rows.every((row) => row.cells.every((cell) => typeof cell === "string"))));
  assert.deepEqual(result.reviewItems, []);
});

test("English workbook is derived from the Thai source and becomes plain-text rows", async () => {
  const thai = new ExcelJS.Workbook();
  await thai.xlsx.readFile(f1Path);
  const english = new ExcelJS.Workbook();
  await english.xlsx.readFile(f1EnglishPath);
  const result = await readWorkbook(fs.readFileSync(f1EnglishPath));
  assert.deepEqual(result.sheets.map((sheet) => sheet.name), ["Year 1", "Year 2", "Year 3", "Teachers"]);
  assert.ok(result.sheets.every((sheet) =>
    sheet.rows.every((row) => row.cells.every((cell) => typeof cell === "string"))));
  assert.equal(result.reviewItems.length, 2);

  const formulasWithoutCachedResults = [];
  for (const [index, thaiSheet] of thai.worksheets.entries()) {
    const englishSheet = english.worksheets[index];
    assert.deepEqual(
      [...englishSheet.model.merges].sort(),
      [...thaiSheet.model.merges].sort(),
    );
    for (let row = 1; row <= thaiSheet.rowCount; row += 1) {
      for (let column = 1; column <= thaiSheet.columnCount; column += 1) {
        const sourceCell = thaiSheet.getCell(row, column);
        const outputCell = englishSheet.getCell(row, column);
        if (sourceCell.value?.formula || sourceCell.value?.sharedFormula) {
          assert.equal(outputCell.value.formula, sourceCell.value.formula);
          assert.equal(outputCell.value.result, undefined);
          formulasWithoutCachedResults.push(`${englishSheet.name}!${outputCell.address}`);
          continue;
        }
        assert.equal(
          plainCellValue(outputCell.value),
          translateSourceText(plainCellValue(sourceCell.value)),
          `${thaiSheet.name}!${sourceCell.address}`,
        );
      }
    }
  }
  assert.deepEqual(formulasWithoutCachedResults, ["Year 1!D18", "Year 3!C16"]);
  assert.deepEqual(result.reviewItems.map(({ original }) => original), [
    "Year 1!D18: SUM(C11:C16)*2+2",
    "Year 3!C16: SUM(C12:C14,C9:C10)*2+6",
  ]);
  assert.equal(result.sheets[0].rows[1].cells[0], "Course Code");
  assert.equal(result.sheets[3].rows[0].cells[0], "Teacher Name");
});

test("rich text, hyperlinks, dates, formulas, and merged cells become text or ReviewItems", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("English");
  sheet.mergeCells("A1:C1");
  sheet.getCell("A1").value = {
    richText: [{ text: "Merged " }, { text: "title" }],
  };
  sheet.getCell("A2").value = {
    richText: [{ text: "Rich " }, { text: "text" }],
  };
  sheet.getCell("B2").value = {
    text: "Link label",
    hyperlink: "mailto:test@example.invalid",
  };
  sheet.getCell("C2").value = new Date("2025-03-04T00:00:00.000Z");
  sheet.getCell("D2").value = { formula: "1+1", result: 2 };
  sheet.getCell("E2").value = { formula: "1+2" };

  const result = await readWorkbook(await workbook.xlsx.writeBuffer());
  assert.deepEqual(result.sheets[0].rows[0].cells, ["Merged title", "Merged title", "Merged title", "", ""]);
  assert.deepEqual(result.sheets[0].rows[1].cells, [
    "Rich text",
    "Link label",
    "2025-03-04T00:00:00.000Z",
    "2",
    "",
  ]);
  assert.deepEqual(result.reviewItems, [{
    id: "review-1",
    section: "file",
    recordId: "",
    field: "E2",
    problem: "เซลล์สูตรไม่มีผลลัพธ์ที่บันทึกไว้ กรุณาตรวจสอบหรือบันทึกไฟล์ใหม่",
    original: "English!E2: 1+2",
  }]);
});

test("empty and corrupt files have distinct error codes", async () => {
  await assert.rejects(readWorkbook(Buffer.alloc(0)), { code: "bad_input" });
  await assert.rejects(readWorkbook(Buffer.from("not an xlsx")), { code: "unreadable_file" });
});

test("a valid but empty workbook is bad_input", async () => {
  const workbook = new ExcelJS.Workbook();
  await assert.rejects(readWorkbook(await workbook.xlsx.writeBuffer()), { code: "bad_input" });
});
