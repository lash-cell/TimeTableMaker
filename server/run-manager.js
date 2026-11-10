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
  }

  start(input) {
    if (this.active.size) return null;
    const run = this.store.create({
      id: `run-${randomUUID()}`,
      createdAt: new Date().toISOString(),
      input: JSON.parse(JSON.stringify(input)),
    });
    const controller = new AbortController();
    this.active.set(run.id, controller);
    setImmediate(() => this.execute(run, controller));
    return run;
  }

  async execute(run, controller) {
    try {
      const result = await this.solver(run.input, {
        signal: controller.signal,
        timeLimitMs: this.timeLimitMs,
      });
      this.store.finish(run.id, result);
    } catch (error) {
      if (!controller.signal.aborted) {
        this.logger.error("Timetable run failed:", error);
        this.store.fail(run.id, "Timetable generation failed. Check the server log for details.");
      }
    } finally {
      this.active.delete(run.id);
    }
  }

  get(id) {
    return this.store.get(id);
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
    this.active.get(id)?.abort();
    return run;
  }

  close() {
    for (const controller of this.active.values()) controller.abort();
    this.store.close();
  }
}

module.exports = { RunManager };
