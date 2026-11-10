"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createServer } = require("../server");

function fixture(name) {
  return JSON.parse(fs.readFileSync(
    path.join(__dirname, "fixtures", name, "problem.json"),
    "utf8",
  ));
}

async function listen(t, options) {
  const server = createServer(options);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let closed = false;
  const close = () => {
    if (closed) return Promise.resolve();
    return new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        closed = true;
        resolve();
      });
    });
  };
  t.after(close);
  return {
    server,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close,
  };
}

async function waitForRun(baseUrl, id, expectedState) {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/runs/${id}`);
    const run = await response.json();
    if (run.state === expectedState) return run;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`run ${id} did not reach ${expectedState}`);
}

async function saveConfirmedInput(baseUrl, input) {
  const saved = await fetch(`${baseUrl}/api/data`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  assert.equal(saved.status, 200);
  const confirmed = await fetch(`${baseUrl}/api/data/confirm`, { method: "POST" });
  assert.equal(confirmed.status, 200);
  return confirmed.json();
}

test("runs solve outside the request handler, keep health responsive, and persist after restart", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "timetablemaker-runs-"));
  const databasePath = path.join(directory, "runs.sqlite");
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const firstServer = await listen(t, { databasePath });
  await fetch(`${firstServer.baseUrl}/api/health`);
  await saveConfirmedInput(firstServer.baseUrl, fixture("F1"));
  const start = await fetch(`${firstServer.baseUrl}/api/runs`, {
    method: "POST",
  });
  const startedRun = await start.json();
  assert.equal(start.status, 202);
  assert.equal(startedRun.state, "running");

  const healthStarted = performance.now();
  const health = await fetch(`${firstServer.baseUrl}/api/health`);
  assert.equal(health.status, 200);
  assert.ok(performance.now() - healthStarted < 50);

  const finishedRun = await waitForRun(firstServer.baseUrl, startedRun.id, "finished");
  assert.equal(finishedRun.result.status, "feasible");
  assert.ok(finishedRun.logs.some((entry) => entry.phase === "Plan"));
  assert.ok(finishedRun.logs.some((entry) => entry.phase === "Act"));
  assert.ok(finishedRun.logs.some((entry) => entry.phase === "Validate"));
  assert.ok(finishedRun.logs.some((entry) => entry.message.includes("1.1: passed")));
  assert.ok(finishedRun.logs.some((entry) => entry.message.includes("2.1: passed")));
  assert.ok(finishedRun.logs.some((entry) => entry.message.includes("Validator ตรวจผลสุดท้ายผ่าน")));
  assert.ok(finishedRun.logs.every((entry, index, entries) =>
    index === 0 || entry.sequence > entries[index - 1].sequence));
  const lastSequence = finishedRun.logs.at(-1).sequence;
  const newLogsResponse = await fetch(
    `${firstServer.baseUrl}/api/runs/${startedRun.id}?after=${lastSequence - 1}`,
  );
  const newLogsRun = await newLogsResponse.json();
  assert.equal(newLogsRun.logs.length, 1);
  assert.equal(newLogsRun.logs[0].sequence, lastSequence);
  await firstServer.close();

  const secondServer = await listen(t, { databasePath });
  const listed = await fetch(`${secondServer.baseUrl}/api/runs`);
  const runs = await listed.json();
  assert.ok(runs.some((run) => run.id === startedRun.id && run.state === "finished"));
});

test("cancelling an active run persists cancelled and does not overwrite it later", async (t) => {
  const solver = (_input, { signal }) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve({ status: "feasible", lessons: [] }), 5000);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      const error = new Error("cancelled");
      error.name = "AbortError";
      reject(error);
    }, { once: true });
  });
  const { baseUrl } = await listen(t, { databasePath: ":memory:", solver });
  await saveConfirmedInput(baseUrl, fixture("F2"));
  const started = await fetch(`${baseUrl}/api/runs`, {
    method: "POST",
  });
  const run = await started.json();
  assert.equal(started.status, 202);

  const cancelled = await fetch(`${baseUrl}/api/runs/${run.id}/cancel`, { method: "POST" });
  assert.equal((await cancelled.json()).state, "cancelled");
  await new Promise((resolve) => setTimeout(resolve, 20));
  const polled = await fetch(`${baseUrl}/api/runs/${run.id}`);
  const cancelledRun = await polled.json();
  assert.equal(cancelledRun.state, "cancelled");
  assert.ok(cancelledRun.logs.some((entry) => entry.level === "WARNING" && /ยกเลิก/u.test(entry.message)));
});

test("a crashing solver marks its run failed while the server stays responsive", async (t) => {
  const errors = [];
  const { baseUrl } = await listen(t, {
    databasePath: ":memory:",
    solver: async () => {
      throw new Error("simulated backend crash");
    },
    logger: { error: (...args) => errors.push(args) },
  });
  await saveConfirmedInput(baseUrl, fixture("F2"));
  const response = await fetch(`${baseUrl}/api/runs`, {
    method: "POST",
  });
  const started = await response.json();
  const failed = await waitForRun(baseUrl, started.id, "failed");
  assert.equal(failed.result, null);
  assert.match(failed.error, /server log/i);
  assert.equal(errors.length, 1);
  assert.equal((await fetch(`${baseUrl}/api/health`)).status, 200);
});
