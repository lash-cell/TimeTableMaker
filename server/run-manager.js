"use strict";

const { randomUUID } = require("node:crypto");
const { compareRuns } = require("../output/history");

class RunManager {
  constructor({ store, solver, logger = console, timeLimitMs = 30000 }) {
    this.store = store;
    this.solver = solver;
    this.logger = logger;
    this.timeLimitMs = timeLimitMs;
    this.active = new Map();
    this.closed = false;
  }

  start(input) {
    if (this.active.size) return null;
    const run = this.store.create({
      id: `run-${randomUUID()}`,
      createdAt: new Date().toISOString(),
      input: JSON.parse(JSON.stringify(input)),
    });
    const controller = new AbortController();
    const activeRun = { controller, startedAt: performance.now() };
    this.active.set(run.id, activeRun);
    this.log(run.id, activeRun, "INFO", "Plan", "เริ่มรับข้อมูลสำหรับการจัดตาราง", {
      groups: input.groups.length,
      courses: input.courses.length,
      teachers: input.teachers.length,
      rooms: input.rooms.length,
    });
    setImmediate(() => this.execute(run, activeRun));
    return { ...run, logs: this.store.getLogs(run.id) };
  }

  log(id, activeRun, level, phase, message, details = null) {
    if (this.closed) return;
    this.store.addLog(id, {
      timestamp: new Date().toISOString(),
      elapsedMs: Math.max(0, performance.now() - activeRun.startedAt),
      level,
      phase,
      message,
      details,
    });
  }

  async execute(run, activeRun) {
    const { controller } = activeRun;
    try {
      const result = await this.solver(run.input, {
        signal: controller.signal,
        timeLimitMs: this.timeLimitMs,
        onProgress: (event) => this.log(
          run.id,
          activeRun,
          event.level,
          event.phase,
          event.message,
          event.details,
        ),
      });
      this.store.finish(run.id, result);
      const feasible = result.status === "feasible" &&
        Array.isArray(result.report?.violations) &&
        result.report.violations.length === 0;
      this.log(
        run.id,
        activeRun,
        feasible ? "SUCCESS" : result.status === "invalidInput" ? "ERROR" : "WARNING",
        "Validate",
        feasible
          ? "Engine และ Validator ตรวจผลลัพธ์ผ่านแล้ว"
          : `Engine จบการทำงานด้วยสถานะ ${result.status}`,
        {
          status: result.status,
          violations: result.report?.violations?.length ?? null,
          solverStatus: result.stats?.solverStatus ?? null,
          elapsedMs: result.stats?.bridgeMs ?? result.stats?.ms ?? null,
        },
      );
    } catch (error) {
      if (!controller.signal.aborted) {
        this.logger.error("Timetable run failed:", error);
        this.log(run.id, activeRun, "ERROR", "Engine", error.message, {
          name: error.name,
          violations: error.violations ?? [],
          cause: error.cause?.message ?? null,
        });
        this.store.fail(run.id, "Timetable generation failed. Check the server log for details.");
      } else {
        this.log(run.id, activeRun, "WARNING", "Engine", "การทำงานถูกยกเลิกตามคำขอ", {
          status: "cancelled",
        });
      }
    } finally {
      this.active.delete(run.id);
    }
  }

  get(id) {
    return this.store.get(id);
  }

  getLogs(id, after = 0) {
    return this.store.getLogs(id, after);
  }

  list() {
    return this.store.list();
  }

  choose(id) {
    return this.store.choose(id);
  }

  compare(aId, bId) {
    const a = this.store.get(aId);
    const b = this.store.get(bId);
    return a && b ? compareRuns(a, b) : null;
  }

  cancel(id) {
    const run = this.store.cancel(id);
    const activeRun = this.active.get(id);
    if (activeRun) {
      this.log(id, activeRun, "WARNING", "Engine", "ได้รับคำขอยกเลิกการจัดตาราง");
      activeRun.controller.abort();
    }
    return run;
  }

  close() {
    this.closed = true;
    for (const { controller } of this.active.values()) controller.abort();
    this.store.close();
  }
}

module.exports = { RunManager };
