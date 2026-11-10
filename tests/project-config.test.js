"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("gitignore excludes installed libraries, runtime data, and local keys", () => {
  const projectRoot = path.resolve(__dirname, "..");
  const ignoredPatterns = fs.readFileSync(path.join(projectRoot, ".gitignore"), "utf8")
    .split(/\r?\n/)
    .filter(Boolean);

  for (const requiredPattern of [
    "node_modules/",
    ".venv/",
    "__pycache__/",
    "/data/",
    ".env",
    ".env.*",
    "*.key",
    "*.pem",
  ]) {
    assert.ok(ignoredPatterns.includes(requiredPattern), `missing ignore pattern: ${requiredPattern}`);
  }
});

test("OR-Tools backend dependency is pinned", () => {
  const projectRoot = path.resolve(__dirname, "..");
  const requirements = fs.readFileSync(path.join(projectRoot, "requirements.txt"), "utf8");

  assert.match(requirements, /^ortools==9\.15\.6755$/m);
});
