"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

class RunStore {
  constructor(databasePath) {
    if (databasePath !== ":memory:") {
      fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    }
    this.database = new DatabaseSync(databasePath);
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('running', 'finished', 'cancelled', 'failed')),
        input_json TEXT NOT NULL,
        result_json TEXT,
        error TEXT,
        chosen INTEGER NOT NULL DEFAULT 0 CHECK (chosen IN (0, 1))
      )
    `);
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS app_data (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL
      )
    `);
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS data_imports (
        id TEXT PRIMARY KEY,
        sha256 TEXT NOT NULL UNIQUE,
        file_name TEXT NOT NULL,
        imported_at TEXT NOT NULL,
        groups_count INTEGER NOT NULL,
        courses_count INTEGER NOT NULL,
        teachers_count INTEGER NOT NULL
      )
    `);
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS run_logs (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        elapsed_ms REAL NOT NULL,
        level TEXT NOT NULL CHECK (level IN ('INFO', 'SUCCESS', 'WARNING', 'ERROR')),
        phase TEXT NOT NULL,
        message TEXT NOT NULL,
        details_json TEXT
      )
    `);
    this.database.exec(`
      CREATE INDEX IF NOT EXISTS run_logs_by_run
      ON run_logs (run_id, sequence)
    `);
    this.database.prepare(`
      UPDATE runs
      SET state = 'failed', error = 'The app stopped before this run finished.'
      WHERE state = 'running'
    `).run();
  }

  create(run) {
    this.database.prepare(`
      INSERT INTO runs (id, created_at, state, input_json, result_json, error, chosen)
      VALUES (?, ?, 'running', ?, NULL, NULL, 0)
    `).run(run.id, run.createdAt, JSON.stringify(run.input));
    return this.get(run.id);
  }

  getInput() {
    const row = this.database.prepare("SELECT value_json FROM app_data WHERE key = 'input'").get();
    return row ? JSON.parse(row.value_json) : null;
  }

  saveInput(input) {
    this.database.prepare(`
      INSERT INTO app_data (key, value_json) VALUES ('input', ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json
    `).run(JSON.stringify(input));
    return this.getInput();
  }

  findImportByHash(sha256) {
    const row = this.database.prepare("SELECT * FROM data_imports WHERE sha256 = ?").get(sha256);
    return row ? this.importRecord(row) : null;
  }

  listImports() {
    return this.database.prepare(`
      SELECT * FROM data_imports ORDER BY imported_at DESC, id DESC
    `).all().map((row) => this.importRecord(row));
  }

  saveImportedInput(input, record) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.findImportByHash(record.sha256);
      if (existing) {
        this.database.exec("ROLLBACK");
        return { duplicate: existing, input: this.getInput() };
      }
      this.database.prepare(`
        INSERT INTO data_imports (
          id, sha256, file_name, imported_at, groups_count, courses_count, teachers_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        record.id,
        record.sha256,
        record.fileName,
        record.importedAt,
        record.groups,
        record.courses,
        record.teachers,
      );
      this.writeInput(input);
      this.database.exec("COMMIT");
      return { duplicate: null, input, import: this.importRecord(record) };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  deleteImport(id, emptyInput) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const imported = this.database.prepare("SELECT * FROM data_imports WHERE id = ?").get(id);
      if (!imported) {
        this.database.exec("ROLLBACK");
        return null;
      }
      const input = this.getInput() ?? emptyInput;
      const courseIds = new Set(input.courses
        .filter((course) => course.source?.importId === id)
        .map((course) => course.id));
      const remainingCourses = input.courses.filter((course) => !courseIds.has(course.id));
      const teacherReferences = new Set(remainingCourses.map((course) => course.teacherId).filter(Boolean));
      const removedTeachers = new Set(input.teachers
        .filter((teacher) => teacher.source?.importId === id && !teacherReferences.has(teacher.id))
        .map((teacher) => teacher.id));
      let removedGroups = 0;
      input.courses = remainingCourses;
      input.teachers = input.teachers
        .filter((teacher) => !removedTeachers.has(teacher.id))
        .map((teacher) => {
          if (teacher.source?.importId !== id) return teacher;
          const { importId, ...source } = teacher.source;
          return { ...teacher, source };
        });
      input.groups = input.groups.flatMap((group) => {
        if (group.importId !== id) return [group];
        if (remainingCourses.some((course) => course.year === group.year)) {
          const { importId, ...remaining } = group;
          return [remaining];
        }
        removedGroups += 1;
        return [];
      });
      input.review = input.review.filter((item) =>
        item.importId !== id && !courseIds.has(item.recordId) && !removedTeachers.has(item.recordId));
      const years = new Set(input.groups.map((group) => group.year));
      input.time.finishLimits = input.time.finishLimits.filter((limit) => years.has(limit.year));
      input.confirmed = false;
      this.writeInput(input);
      this.database.prepare("DELETE FROM data_imports WHERE id = ?").run(id);
      this.database.exec("COMMIT");
      return {
        input,
        deleted: {
          groups: removedGroups,
          courses: courseIds.size,
          teachers: removedTeachers.size,
        },
      };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  resetData(input) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.writeInput(input);
      this.database.prepare("DELETE FROM data_imports").run();
      this.database.exec("COMMIT");
      return input;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  importRecord(row) {
    return {
      id: row.id,
      fileName: row.fileName ?? row.file_name,
      importedAt: row.importedAt ?? row.imported_at,
      groups: row.groups ?? row.groups_count,
      courses: row.courses ?? row.courses_count,
      teachers: row.teachers ?? row.teachers_count,
    };
  }

  writeInput(input) {
    this.database.prepare(`
      INSERT INTO app_data (key, value_json) VALUES ('input', ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json
    `).run(JSON.stringify(input));
  }

  finish(id, result) {
    this.database.prepare(`
      UPDATE runs SET state = 'finished', result_json = ?, error = NULL
      WHERE id = ? AND state = 'running'
    `).run(JSON.stringify(result), id);
    return this.get(id);
  }

  fail(id, error) {
    this.database.prepare(`
      UPDATE runs SET state = 'failed', result_json = NULL, error = ?
      WHERE id = ? AND state = 'running'
    `).run(error, id);
    return this.get(id);
  }

  cancel(id) {
    this.database.prepare(`
      UPDATE runs SET state = 'cancelled', result_json = NULL, error = NULL
      WHERE id = ? AND state = 'running'
    `).run(id);
    return this.get(id);
  }

  addLog(id, entry) {
    this.database.prepare(`
      INSERT INTO run_logs (run_id, timestamp, elapsed_ms, level, phase, message, details_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      entry.timestamp,
      entry.elapsedMs,
      entry.level,
      entry.phase,
      entry.message,
      entry.details ? JSON.stringify(entry.details) : null,
    );
  }

  getLogs(id, after = 0) {
    return this.database.prepare(`
      SELECT sequence, timestamp, elapsed_ms, level, phase, message, details_json
      FROM run_logs
      WHERE run_id = ? AND sequence > ?
      ORDER BY sequence
    `).all(id, after).map((row) => ({
      sequence: row.sequence,
      timestamp: row.timestamp,
      elapsedMs: row.elapsed_ms,
      level: row.level,
      phase: row.phase,
      message: row.message,
      details: row.details_json ? JSON.parse(row.details_json) : null,
    }));
  }

  choose(id) {
    const run = this.get(id);
    if (!run) return null;
    const violations = run.result?.report?.violations;
    if (
      run.state !== "finished" ||
      run.result?.status !== "feasible" ||
      !Array.isArray(violations) ||
      violations.length > 0
    ) {
      const error = new Error("Only a finished feasible run can be chosen");
      error.code = "not_feasible";
      throw error;
    }

    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare("UPDATE runs SET chosen = 0").run();
      this.database.prepare("UPDATE runs SET chosen = 1 WHERE id = ?").run(id);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return this.get(id);
  }

  get(id) {
    const row = this.database.prepare("SELECT * FROM runs WHERE id = ?").get(id);
    return row ? {
      id: row.id,
      createdAt: row.created_at,
      state: row.state,
      input: JSON.parse(row.input_json),
      result: row.result_json ? JSON.parse(row.result_json) : null,
      error: row.error,
      chosen: Boolean(row.chosen),
    } : null;
  }

  list() {
    return this.database.prepare(`
      SELECT id, created_at, state, result_json, error, chosen
      FROM runs ORDER BY created_at DESC, id DESC
    `).all().map((row) => {
      const result = row.result_json ? JSON.parse(row.result_json) : null;
      return {
        id: row.id,
        createdAt: row.created_at,
        state: row.state,
        status: result?.status ?? null,
        total: result?.scoreHistory?.at(-1)?.total ?? null,
        itemsPassed: result?.report?.items?.filter((item) => item.result === "passed").length ?? 0,
        chosen: Boolean(row.chosen),
        error: row.error,
      };
    });
  }

  close() {
    this.database.close();
  }
}

module.exports = { RunStore };
