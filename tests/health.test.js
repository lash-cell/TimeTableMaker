"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createServer } = require("../server");

test("GET /api/health returns the versioned health response on localhost", async (t) => {
  const server = createServer({ databasePath: ":memory:" });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  }));

  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, version: "1.0.0" });
});
