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
const backendEventPrefix = "TIMETABLEMAKER_EVENT ";

function emitProgress(onProgress, level, phase, message, details = null) {
  onProgress?.({ level, phase, message, details });
}

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
  if (fs.existsSync(virtualEnvPython)) return virtualEnvPython;
  return process.platform === "win32" ? "python" : "python3";
}

function runBackend(request, timeLimitMs, signal, onProgress) {
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
    let stderrBuffer = "";
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
    const processStderrLine = (line) => {
      if (!line.startsWith(backendEventPrefix)) {
        stderr += `${line}\n`;
        return;
      }
      try {
        const event = JSON.parse(line.slice(backendEventPrefix.length));
        const messages = {
          model_built: "แบบจำลอง CP-SAT จากข้อมูลจริงสร้างเสร็จแล้ว",
          search_started: "เริ่มค้นหาตำแหน่งจัดตารางด้วย CP-SAT",
          solution_found: `CP-SAT พบคำตอบระหว่างค้นหา ${event.solutions} ครั้ง`,
        };
        onProgress?.({
          level: event.level ?? "INFO",
          phase: event.phase ?? "Act",
          message: messages[event.event] ?? `Engine: ${event.event}`,
          details: event,
        });
      } catch (error) {
        if (error instanceof SyntaxError) {
          stderr += `${line}\n`;
          return;
        }
        fail(error);
        child.kill();
      }
    };
    const readStderr = (chunk, flush = false) => {
      stderrBuffer += chunk;
      const lines = stderrBuffer.split(/\r?\n/u);
      stderrBuffer = lines.pop() ?? "";
      if (flush && stderrBuffer) lines.push(stderrBuffer);
      if (flush) stderrBuffer = "";
      for (const line of lines) processStderrLine(line);
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
      readStderr(chunk);
    });
    child.on("error", (error) => {
      fail(new Error(`Unable to start the CP-SAT backend: ${error.message}`, { cause: error }));
    });
    child.on("close", (code) => {
      cleanup();
      readStderr("", true);
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
  onProgress,
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
  emitProgress(onProgress, "INFO", "Plan", "เริ่มตรวจสอบความเป็นไปได้ของข้อมูล", {
    groups: input?.groups?.length ?? 0,
    courses: input?.courses?.length ?? 0,
    teachers: input?.teachers?.length ?? 0,
    rooms: input?.rooms?.length ?? 0,
  });
  const analysis = analyzeInput(input);
  emitProgress(
    onProgress,
    analysis.status === "ok" ? "SUCCESS" : "WARNING",
    "Plan",
    `ตรวจความเป็นไปได้เสร็จ: ${analysis.status}`,
    {
      groups: analysis.groups,
      teachers: analysis.teachers,
      causes: analysis.causes,
      elapsedMs: performance.now() - started,
    },
  );
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
  emitProgress(onProgress, "INFO", "Plan", "ขยายรายวิชาเป็นงานจัดตาราง");
  const built = createLessonsToPlace(input);
  emitProgress(
    onProgress,
    built.conflicts.length ? "ERROR" : "SUCCESS",
    "Plan",
    built.conflicts.length
      ? `พบข้อขัดแย้งของข้อมูล ${built.conflicts.length} รายการ`
      : `เตรียมงานจัดตาราง ${built.lessons.length} รายการเสร็จ`,
    { lessons: built.lessons.length, conflicts: built.conflicts },
  );
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
  emitProgress(onProgress, "INFO", "Act", "ส่งข้อมูลให้ CP-SAT ค้นหาตำแหน่งจัดตาราง", {
    timeLimitMs: remainingMs,
    stepLimit: stepLimit ?? null,
  });
  const result = await runBackend({
    input,
    timeLimitSeconds: remainingMs / 1000,
    stepLimit,
  }, remainingMs, signal, onProgress);
  if (!["feasible", "infeasible", "searchLimit"].includes(result.status)) {
    throw new Error(`CP-SAT backend returned unexpected status "${result.status}"`);
  }
  const completeResult = { ...result, analysis };
  if (result.status !== "feasible") {
    const likelyCauses = result.status === "infeasible"
      ? await findLikelyCauses(input, timeLimitMs, started, signal)
      : [];
    emitProgress(
      onProgress,
      result.status === "invalidInput" ? "ERROR" : "WARNING",
      "Act",
      `CP-SAT จบการค้นหาด้วยสถานะ ${result.status}`,
      { stats: result.stats, likelyCauses },
    );
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
  emitProgress(onProgress, "INFO", "Validate", "ตรวจสอบคำตอบจาก CP-SAT ด้วย Validator อิสระ");
  const checked = checkTimetable(input, result.lessons);
  emitProgress(
    onProgress,
    checked.violations.length ? "ERROR" : "SUCCESS",
    "Validate",
    checked.violations.length
      ? `Validator พบข้อขัดแย้ง ${checked.violations.length} รายการ`
      : "คำตอบเริ่มต้นผ่าน Validator",
    { violations: checked.violations },
  );
  if (checked.violations.length) {
    const error = new Error(
      `CP-SAT returned a schedule rejected by the independent checker (${checked.violations.length} violations)`,
    );
    error.violations = checked.violations;
    throw error;
  }
  emitProgress(onProgress, "INFO", "Act", "เริ่มปรับปรุงคุณภาพตารางด้วย seeded search", {
    seed,
  });
  const improved = improveTimetable(
    input,
    result.lessons,
    seed,
    started + timeLimitMs,
    signal,
    (progress) => emitProgress(onProgress, "INFO", "Act", progress.message, progress.details),
  );
  emitProgress(onProgress, "SUCCESS", "Act", "ปรับปรุงคุณภาพตารางเสร็จ", {
    stats: improved.stats,
    initialScore: improved.scoreHistory[0]?.total ?? null,
    finalScore: improved.scoreHistory.at(-1)?.total ?? null,
  });
  if (signal?.aborted) throw abortError();
  emitProgress(onProgress, "INFO", "Validate", "ตรวจสอบผลลัพธ์สุดท้ายหลังการปรับปรุง");
  const finalCheck = checkTimetable(input, improved.lessons);
  for (const item of finalCheck.items) {
    emitProgress(
      onProgress,
      item.result === "failed" ? "ERROR" : item.result === "passed" ? "SUCCESS" : "INFO",
      "Validate",
      `กฎ ${item.rubricId}: ${item.result}`,
      { rubricId: item.rubricId, result: item.result, count: item.count },
    );
  }
  emitProgress(
    onProgress,
    finalCheck.violations.length ? "ERROR" : "SUCCESS",
    "Validate",
    finalCheck.violations.length
      ? `Validator ตรวจผลสุดท้ายพบข้อขัดแย้ง ${finalCheck.violations.length} รายการ`
      : "Validator ตรวจผลสุดท้ายผ่านทุกกฎที่เปิดใช้งาน",
    { violations: finalCheck.violations.length },
  );
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
