"use strict";

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { analyzeInput } = require("./analysis");
const { checkTimetable } = require("./checker");
const { improveTimetable } = require("./improvement");
const { createLessonsToPlace } = require("./lesson-builder");
const { buildAssumptions, buildReport } = require("./report");

const projectRoot = path.join(__dirname, "..");
const solverScript = path.join(__dirname, "cpsat_solver.py");
const maxOutputBytes = 16 * 1024 * 1024;

function abortError() {
  const error = new Error("Timetable generation was cancelled");
  error.name = "AbortError";
  return error;
}

function withReport(input, result, validation) {
  return {
    ...result,
    report: buildReport(input, result, validation),
    assumptions: buildAssumptions(input),
  };
}

function pythonExecutable() {
  const configured = process.env.TIMETABLEMAKER_PYTHON;
  if (configured) return configured;
  const virtualEnvPython = process.platform === "win32"
    ? path.join(projectRoot, ".venv", "Scripts", "python.exe")
    : path.join(projectRoot, ".venv", "bin", "python");
  return fs.existsSync(virtualEnvPython) ? virtualEnvPython : "python3";
}

function runBackend(request, timeLimitMs, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const child = spawn(pythonExecutable(), [solverScript], {
      cwd: projectRoot,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let settled = false;
    let timer;

    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      child.kill();
      reject(abortError());
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes > maxOutputBytes) {
        child.kill();
        fail(new Error("CP-SAT backend exceeded the response size limit"));
        return;
      }
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      fail(new Error(`Unable to start the CP-SAT backend: ${error.message}`, { cause: error }));
    });
    child.on("close", (code) => {
      cleanup();
      if (settled) return;
      if (code !== 0) {
        fail(new Error(
          `CP-SAT backend exited with code ${code}${stderr ? `: ${stderr.trim()}` : ""}`,
        ));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        fail(new Error(
          `CP-SAT backend returned invalid JSON${stderr ? `: ${stderr.trim()}` : ""}`,
          { cause: error },
        ));
      }
    });

    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      child.kill();
      resolve({
        status: "searchLimit",
        lessons: [],
        stats: {
          ms: timeLimitMs,
          steps: 0,
          limitHit: "time",
          rejections: [],
          solverStatus: "TERMINATED",
        },
      });
    }, timeLimitMs);
    signal?.addEventListener("abort", onAbort, { once: true });

    child.stdin.on("error", (error) => {
      if (error.code !== "EPIPE") fail(error);
    });
    child.stdin.end(JSON.stringify(request));
  });
}

const diagnosticGroups = [
  ["fixed", "fixed slots", (input) => input.courses
    .filter((course) => course.fixed && course.category !== "activity")
    .map((course) => course.name)],
  ["teacherAvailability", "teacher unavailability", (input) => input.teachers
    .filter((teacher) => teacher.unavailable?.length)
    .map((teacher) => teacher.name)],
  ["givenTeachers", "given teachers", (input) => input.courses
    .filter((course) => course.teacherId)
    .map((course) => course.name)],
  ["workload", "teacher workload limits", (input) => input.teachers
    .filter((teacher) => teacher.minPeriods || teacher.maxPeriods)
    .map((teacher) => teacher.name)],
  ["rooms", "room availability and types", (input) => input.courses
    .filter((course) => course.roomType && course.roomType !== "general")
    .map((course) => course.roomType)],
];

async function findLikelyCauses(input, timeLimitMs, started, signal) {
  const likelyCauses = [];
  for (const [relax, label, describe] of diagnosticGroups) {
    const remainingMs = timeLimitMs - (performance.now() - started);
    if (remainingMs < 50) break;
    const result = await runBackend({
      input,
      relax,
      timeLimitSeconds: Math.min(5000, remainingMs) / 1000,
    }, Math.min(5000, remainingMs), signal);
    if (result.status === "feasible") {
      const details = [...new Set(describe(input))];
      likelyCauses.push(
        `Likely cause, not proof: ${label}${details.length ? ` (${details.join(", ")})` : ""}.`,
      );
    }
  }
  return likelyCauses;
}

async function generateTimetable(input, {
  timeLimitMs = 30000,
  stepLimit,
  seed = 1,
  signal,
} = {}) {
  if (!Number.isFinite(timeLimitMs) || timeLimitMs <= 0) {
    throw new RangeError("timeLimitMs must be a positive finite number");
  }
  if (stepLimit !== undefined && (!Number.isInteger(stepLimit) || stepLimit < 1)) {
    throw new RangeError("stepLimit must be a positive integer");
  }
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new RangeError("seed must be an unsigned 32-bit integer");
  }

  const started = performance.now();
  if (signal?.aborted) throw abortError();
  const analysis = analyzeInput(input);
  if (analysis.status !== "ok") {
    return withReport(input, {
      status: analysis.status === "invalidInput" ? "invalidInput" : "infeasible",
      lessons: [],
      analysis,
      causes: analysis.causes ?? [],
      likelyCauses: [],
      scoreHistory: [],
      seed,
      stats: {
        steps: 0,
        ms: performance.now() - started,
        limitHit: "",
        rejections: [],
        bridgeMs: performance.now() - started,
      },
    });
  }
  const built = createLessonsToPlace(input);
  if (built.conflicts.length) {
    return withReport(input, {
      status: "invalidInput",
      lessons: [],
      analysis,
      causes: built.conflicts,
      likelyCauses: [],
      scoreHistory: [],
      seed,
      stats: {
        steps: 0,
        ms: performance.now() - started,
        limitHit: "",
        rejections: [],
        bridgeMs: performance.now() - started,
      },
    });
  }
  const remainingMs = timeLimitMs - (performance.now() - started);
  if (remainingMs <= 0) {
    return withReport(input, {
      status: "searchLimit",
      lessons: [],
      analysis,
      likelyCauses: [],
      scoreHistory: [],
      seed,
      causes: [{
        layer: 3,
        message: "The run reached its time limit before search began; this is not proof of infeasibility.",
        refs: [],
      }],
      stats: {
        steps: 0,
        ms: performance.now() - started,
        limitHit: "time",
        rejections: [],
        solverStatus: "NOT_STARTED",
        bridgeMs: performance.now() - started,
      },
    });
  }
  const result = await runBackend({
    input,
    timeLimitSeconds: remainingMs / 1000,
    stepLimit,
  }, remainingMs, signal);
  if (!["feasible", "infeasible", "searchLimit"].includes(result.status)) {
    throw new Error(`CP-SAT backend returned unexpected status "${result.status}"`);
  }
  const completeResult = { ...result, analysis };
  if (result.status !== "feasible") {
    const likelyCauses = result.status === "infeasible"
      ? await findLikelyCauses(input, timeLimitMs, started, signal)
      : [];
    return withReport(input, {
      ...completeResult,
      stats: { ...result.stats, bridgeMs: performance.now() - started },
      likelyCauses,
      scoreHistory: [],
      seed,
      causes: [{
        layer: 3,
        message: result.status === "searchLimit"
          ? `CP-SAT reached the ${result.stats?.limitHit ?? "configured"} search limit without finding a timetable; this is not proof of infeasibility.`
          : "CP-SAT proved that no timetable satisfies the enabled scheduling rules.",
        refs: [],
      }],
    });
  }
  if (signal?.aborted) throw abortError();
  const checked = checkTimetable(input, result.lessons);
  if (checked.violations.length) {
    const error = new Error(
      `CP-SAT returned a schedule rejected by the independent checker (${checked.violations.length} violations)`,
    );
    error.violations = checked.violations;
    throw error;
  }
  const improved = improveTimetable(input, result.lessons, seed, started + timeLimitMs, signal);
  if (signal?.aborted) throw abortError();
  const finalCheck = checkTimetable(input, improved.lessons);
  if (finalCheck.violations.length) {
    const error = new Error(
      `The improved schedule failed the independent checker (${finalCheck.violations.length} violations)`,
    );
    error.violations = finalCheck.violations;
    throw error;
  }
  return withReport(input, {
    ...completeResult,
    lessons: improved.lessons,
    scoreHistory: improved.scoreHistory,
    seed,
    stats: {
      ...result.stats,
      ...improved.stats,
      bridgeMs: performance.now() - started,
    },
    validation: finalCheck,
  }, finalCheck);
}

module.exports = { generateTimetable };
