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

  choose(id) {
    const run = this.get(id);
    if (!run) return null;
    if (run.state !== "finished" || run.result?.status !== "feasible") {
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
