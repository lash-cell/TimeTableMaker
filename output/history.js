"use strict";

function display(value) {
  if (value === undefined) return "(none)";
  if (value === null) return "(empty)";
  return typeof value === "string" ? value : JSON.stringify(value);
}

function findDataChanges(left, right, currentPath = "input") {
  if (Object.is(left, right)) return [];
  if (Array.isArray(left) && Array.isArray(right)) {
    const changes = [];
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
      changes.push(...findDataChanges(left[index], right[index], `${currentPath}[${index}]`));
    }
    return changes;
  }
  if (
    left && right &&
    typeof left === "object" && typeof right === "object" &&
    !Array.isArray(left) && !Array.isArray(right)
  ) {
    const changes = [];
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
    for (const key of keys) {
      changes.push(...findDataChanges(left[key], right[key], `${currentPath}.${key}`));
    }
    return changes;
  }
  return [`${currentPath}: ${display(left)} -> ${display(right)}`];
}

function runSummary(run) {
  const result = run.result;
  return {
    id: run.id,
    state: run.state,
    status: result?.status ?? null,
    score: result?.scoreHistory?.at(-1) ?? null,
    itemsPassed: result?.report?.items?.filter((item) => item.result === "passed").length ?? 0,
    itemsTotal: result?.report?.items?.length ?? 0,
  };
}

function compareRuns(a, b) {
  if (!a || !b) throw new TypeError("compareRuns requires two saved runs");
  return {
    a: runSummary(a),
    b: runSummary(b),
    dataChanges: findDataChanges(a.input, b.input),
  };
}

module.exports = { compareRuns };
