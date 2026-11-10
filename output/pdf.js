"use strict";

const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ExcelJS = require("exceljs");
const { addGridSheet } = require("./excel");
const { buildView } = require("./views");

const execFileAsync = promisify(execFile);

async function createPdfBuffer(input, result) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "TimeTableMaker";
  const usedNames = new Set();
  const groupView = buildView(input, result, "group");
  if (!groupView.keys.length) {
    throw new Error("PDF export requires at least one group");
  }
  for (const group of groupView.keys) {
    addGridSheet(workbook, input, result, "group", group.id, group.label, usedNames, { pdf: true });
  }

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "timetablemaker-pdf-"));
  const workbookPath = path.join(directory, "timetable.xlsx");
  const pdfPath = path.join(directory, "timetable.pdf");
  try {
    const data = await workbook.xlsx.writeBuffer();
    fs.writeFileSync(workbookPath, data);
    const executable = process.env.TIMETABLEMAKER_LIBREOFFICE || "libreoffice";
    let conversion;
    try {
      conversion = await execFileAsync(
        executable,
        ["--headless", "--convert-to", "pdf", "--outdir", directory, workbookPath],
        { timeout: 60000, maxBuffer: 2 * 1024 * 1024 },
      );
    } catch (error) {
      throw new Error(
        `LibreOffice PDF export failed${error.stderr ? `: ${error.stderr.trim()}` : ""}`,
        { cause: error },
      );
    }
    if (!fs.existsSync(pdfPath)) {
      throw new Error(
        `LibreOffice did not create the expected PDF${conversion.stderr ? `: ${conversion.stderr.trim()}` : ""}`,
      );
    }
    return fs.readFileSync(pdfPath);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

module.exports = { createPdfBuffer };
