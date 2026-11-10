"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createPdfBuffer } = require("../output/pdf");
const { generateTimetable } = require("../engine/solver");

function fixture(name) {
  return JSON.parse(fs.readFileSync(
    path.join(__dirname, "fixtures", name, "problem.json"),
    "utf8",
  ));
}

test("F1 PDF export writes one landscape page per group with codes visible", async (t) => {
  const input = fixture("F1");
  const result = await generateTimetable(input);
  const pdf = await createPdfBuffer(input, result);
  assert.equal(pdf.subarray(0, 5).toString("ascii"), "%PDF-");

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "timetablemaker-pdf-check-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const pdfPath = path.join(directory, "f1.pdf");
  fs.writeFileSync(pdfPath, pdf);
  const info = execFileSync("pdfinfo", [pdfPath], { encoding: "utf8" });
  assert.match(info, new RegExp(`Pages:\\s+${input.groups.length}\\b`));
  const text = execFileSync("pdftotext", [pdfPath, "-"], { encoding: "utf8" });
  assert.match(text, /20000/);
  assert.match(text, /ทค/);
});
