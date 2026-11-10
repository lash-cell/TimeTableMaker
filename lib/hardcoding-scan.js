"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ignoredDirectories = new Set([".git", "data", "node_modules", "tests"]);

function findTerms(text, terms) {
  return terms.filter((term) => term && text.includes(term));
}

function listSourceFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        files.push(...listSourceFiles(path.join(directory, entry.name)));
      }
    } else if (entry.isFile() && /\.(?:c|m)?js$/.test(entry.name)) {
      files.push(path.join(directory, entry.name));
    }
  }
  return files;
}

function scanSource(root, terms) {
  const matches = [];
  for (const file of listSourceFiles(root)) {
    const text = fs.readFileSync(file, "utf8");
    for (const term of findTerms(text, terms)) {
      matches.push({ file: path.relative(root, file), term });
    }
  }
  return matches;
}

module.exports = { findTerms, scanSource };
