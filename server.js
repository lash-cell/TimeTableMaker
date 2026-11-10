"use strict";

const http = require("node:http");
const { createHash, randomUUID } = require("node:crypto");
const path = require("node:path");
const { analyzeInput } = require("./engine/analysis");
const { checkTimetable } = require("./engine/checker");
const { generateTimetable } = require("./engine/solver");
const { buildReport } = require("./engine/report");
const { createExcelBuffer } = require("./output/excel");
const { createPdfBuffer } = require("./output/pdf");
const { buildView } = require("./output/views");
const { removeResolvedEmptySectionReviews, validateInput } = require("./lib/input-validation");
const { WorkbookReadError } = require("./lib/workbook-reader");
const { RunManager } = require("./server/run-manager");
const { RunStore } = require("./server/run-store");
const {
  applyMatchProposal,
  createTemplateBuffer,
  emptyInput,
  getDataGuide,
  proposePaste,
  proposeWorkbook,
  workflowError,
} = require("./server/data-workflows");

const defaultDatabasePath = path.join(__dirname, "data", "timetablemaker.sqlite");
const maxJsonBytes = 30 * 1024 * 1024;
const idPattern = /^[A-Za-z0-9-]+$/u;
const errorMessages = {
  bad_input: "ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบแล้วลองอีกครั้ง",
  not_found: "ไม่พบข้อมูลที่ต้องการ",
  not_confirmed: "กรุณาตรวจสอบและยืนยันข้อมูลก่อนสร้างตาราง",
  not_feasible: "ไม่มีตารางที่จัดได้สำหรับข้อมูลนี้",
  ai_off: "ยังไม่ได้เปิดใช้ AI",
  busy: "กำลังประมวลผลตารางอื่น โปรดลองอีกครั้งภายหลัง",
  too_large: "ข้อมูลมีขนาดใหญ่เกินกำหนด",
  unsupported_file: "รองรับเฉพาะไฟล์ Excel .xlsx",
  unreadable_file: "ไม่สามารถอ่านไฟล์ได้ กรุณาตรวจสอบไฟล์",
  internal: "เกิดข้อผิดพลาดภายใน กรุณาลองใหม่อีกครั้ง",
};
const statusCodes = {
  bad_input: 400,
  not_found: 404,
  not_confirmed: 409,
  not_feasible: 409,
  ai_off: 409,
  busy: 409,
  too_large: 413,
  unsupported_file: 415,
  unreadable_file: 422,
  internal: 500,
};

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function sendError(response, code, message = errorMessages[code]) {
  sendJson(response, statusCodes[code] ?? 500, {
    error: { code: statusCodes[code] ? code : "internal", message: message ?? errorMessages.internal },
  });
}

function readBody(request, limit = maxJsonBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    request.on("data", (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        settled = true;
        reject(Object.assign(new Error("Body exceeds limit"), { code: "too_large" }));
        request.resume();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (settled) return;
      resolve(Buffer.concat(chunks));
    });
    request.on("error", (error) => {
      if (!settled) reject(error);
    });
  });
}

async function readJsonBody(request) {
  const body = await readBody(request);
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    throw workflowError("bad_input", "รูปแบบข้อมูลไม่ใช่ JSON ที่ถูกต้อง");
  }
}

function decodedHeader(value) {
  if (typeof value !== "string" || !value) {
    throw workflowError("bad_input", "กรุณาระบุชื่อไฟล์");
  }
  try {
    return decodeURIComponent(value);
  } catch {
    throw workflowError("bad_input", "ชื่อไฟล์ไม่ถูกต้อง");
  }
}

function decodedId(value) {
  let id;
  try {
    id = decodeURIComponent(value);
  } catch {
    throw workflowError("bad_input", "รหัสข้อมูลไม่ถูกต้อง");
  }
  if (!idPattern.test(id)) throw workflowError("bad_input", "รหัสข้อมูลไม่ถูกต้อง");
  return id;
}

function requireRun(runs, id) {
  const run = runs.get(id);
  if (!run) throw workflowError("not_found", errorMessages.not_found);
  return run;
}

function requireFeasible(run) {
  const violations = run.result?.report?.violations;
  if (
    run.state !== "finished" ||
    run.result?.status !== "feasible" ||
    !Array.isArray(violations) ||
    violations.length > 0
  ) {
    throw workflowError("not_feasible", errorMessages.not_feasible);
  }
}

function sendDownload(response, buffer, filename, contentType) {
  response.writeHead(200, {
    "content-type": contentType,
    "content-disposition": `attachment; filename="${filename}"`,
    "content-length": buffer.length,
  });
  response.end(buffer);
}

function mapError(error, logger, response) {
  if (error instanceof WorkbookReadError) {
    sendError(response, error.code, error.message);
    return;
  }
  if (error.code && statusCodes[error.code]) {
    sendError(response, error.code);
    return;
  }
  logger.error("Request failed:", error);
  sendError(response, "internal");
}

function createServer({
  databasePath = defaultDatabasePath,
  solver = generateTimetable,
  logger = console,
  timeLimitMs = 30000,
} = {}) {
  const store = new RunStore(databasePath);
  const runs = new RunManager({ store, solver, logger, timeLimitMs });
  const server = http.createServer(async (request, response) => {
    try {
      const rawPath = String(request.url ?? "/").split("?", 1)[0];
      const url = new URL(request.url, "http://127.0.0.1");
      const pathname = rawPath;

      if (request.method === "GET" && pathname === "/api/health") {
        sendJson(response, 200, { ok: true, version: require("./package.json").version });
        return;
      }

      if (request.method === "GET" && pathname === "/api/data/imports") {
        sendJson(response, 200, store.listImports());
        return;
      }

      if (request.method === "POST" && pathname === "/api/data/reset") {
        const input = store.resetData(emptyInput());
        sendJson(response, 200, input);
        return;
      }

      const deleteImportMatch = /^\/api\/data\/imports\/([^/]+)$/u.exec(pathname);
      if (request.method === "DELETE" && deleteImportMatch) {
        const id = decodedId(deleteImportMatch[1]);
        const deleted = store.deleteImport(id, emptyInput());
        if (!deleted) throw workflowError("not_found", errorMessages.not_found);
        sendJson(response, 200, deleted);
        return;
      }

      if (request.method === "GET" && pathname === "/api/data") {
        const input = store.getInput() ?? emptyInput();
        const reviewCount = Array.isArray(input.review) ? input.review.length : null;
        removeResolvedEmptySectionReviews(input);
        if (reviewCount !== null && input.review.length !== reviewCount) store.saveInput(input);
        sendJson(response, 200, input);
        return;
      }

      if (request.method === "PUT" && pathname === "/api/data") {
        const submitted = await readJsonBody(request);
        if (!submitted || typeof submitted !== "object" || Array.isArray(submitted)) {
          throw workflowError("bad_input", errorMessages.bad_input);
        }
        const input = structuredClone(submitted);
        input.confirmed = false;
        input.review = validateInput(input);
        store.saveInput(input);
        sendJson(response, 200, input);
        return;
      }

      if (request.method === "POST" && pathname === "/api/data/upload") {
        const fileName = decodedHeader(request.headers["x-file-name"]);
        const bytes = await readBody(request, 30 * 1024 * 1024);
        const sha256 = createHash("sha256").update(bytes).digest("hex");
        const existing = store.findImportByHash(sha256);
        if (existing) {
          sendJson(response, 200, { alreadyImported: true, import: existing });
          return;
        }
        const proposal = await proposeWorkbook(bytes, fileName);
        sendJson(response, 200, { ...proposal, sha256, importId: randomUUID() });
        return;
      }

      if (request.method === "POST" && pathname === "/api/data/paste") {
        const proposal = proposePaste(await readJsonBody(request));
        sendJson(response, 200, proposal);
        return;
      }

      if (request.method === "POST" && pathname === "/api/data/match") {
        const proposal = await readJsonBody(request);
        const converted = applyMatchProposal(proposal, store.getInput() ?? emptyInput());
        let input = converted.input;
        let importedFile = null;
        if (proposal.sha256 !== undefined || proposal.importId !== undefined) {
          if (!/^[a-f0-9]{64}$/u.test(proposal.sha256 ?? "") || !idPattern.test(proposal.importId ?? "")) {
            throw workflowError("bad_input", errorMessages.bad_input);
          }
          const saved = store.saveImportedInput(converted.input, {
            id: proposal.importId,
            sha256: proposal.sha256,
            fileName: proposal.fileName,
            importedAt: new Date().toISOString(),
            groups: converted.input.groups.filter((group) => group.importId === proposal.importId).length,
            courses: converted.input.courses.filter((course) => course.source?.importId === proposal.importId).length,
            teachers: converted.input.teachers.filter((teacher) => teacher.source?.importId === proposal.importId).length,
          });
          if (saved.duplicate) {
            sendJson(response, 200, {
              ...saved.input,
              importReport: {
                fileName: proposal.fileName,
                alreadyImported: true,
                existingImport: saved.duplicate,
              },
            });
            return;
          }
          input = saved.input;
          importedFile = saved.import;
        } else {
          removeResolvedEmptySectionReviews(input);
          store.saveInput(input);
        }
        sendJson(response, 200, {
          ...input,
          importReport: {
            fileName: proposal.fileName,
            warnings: converted.warnings,
            skipped: converted.skipped,
            importedFile,
          },
        });
        return;
      }

      if (request.method === "GET" && pathname === "/api/data/template") {
        const template = await createTemplateBuffer();
        sendDownload(
          response,
          template,
          "timetable-template.xlsx",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        );
        return;
      }

      if (request.method === "GET" && pathname === "/api/data/guide") {
        sendJson(response, 200, getDataGuide());
        return;
      }

      if (request.method === "POST" && pathname === "/api/data/confirm") {
        const input = store.getInput() ?? emptyInput();
        removeResolvedEmptySectionReviews(input);
        if (input.review.length) throw workflowError("not_confirmed", errorMessages.not_confirmed);
        const validation = validateInput(input);
        if (validation.length) {
          input.review = validation;
          store.saveInput(input);
          throw workflowError("not_confirmed", errorMessages.not_confirmed);
        }
        input.confirmed = true;
        for (const record of [...input.groups, ...input.courses, ...input.teachers]) {
          if (record.source) record.source.confirmed = true;
        }
        store.saveInput(input);
        sendJson(response, 200, input);
        return;
      }

      if (request.method === "POST" && pathname === "/api/check") {
        sendJson(response, 200, analyzeInput(store.getInput() ?? emptyInput()));
        return;
      }

      if (request.method === "POST" && pathname === "/api/ai/propose") {
        throw workflowError("ai_off", errorMessages.ai_off);
      }

      if (request.method === "GET" && pathname === "/api/runs/compare") {
        const a = decodedId(url.searchParams.get("a") ?? "");
        const b = decodedId(url.searchParams.get("b") ?? "");
        const comparison = runs.compare(a, b);
        if (!comparison) throw workflowError("not_found", errorMessages.not_found);
        sendJson(response, 200, comparison);
        return;
      }

      if (request.method === "GET" && pathname === "/api/runs") {
        sendJson(response, 200, runs.list());
        return;
      }

      if (request.method === "POST" && pathname === "/api/runs") {
        const input = store.getInput();
        if (!input?.confirmed || input.review.length) {
          throw workflowError("not_confirmed", errorMessages.not_confirmed);
        }
        if (runs.active.size) throw workflowError("busy", errorMessages.busy);
        const run = runs.start(input);
        if (!run) throw workflowError("busy", errorMessages.busy);
        sendJson(response, 202, run);
        return;
      }

      const runPath = pathname.match(/^\/api\/runs\/([^/]+)(?:\/(.*))?$/u);
      if (runPath) {
        const id = decodedId(runPath[1]);
        const action = runPath[2] ?? "";
        const run = requireRun(runs, id);

        if (request.method === "GET" && action === "") {
          const after = url.searchParams.has("after")
            ? Number(url.searchParams.get("after"))
            : 0;
          if (!Number.isSafeInteger(after) || after < 0) {
            throw workflowError("bad_input", errorMessages.bad_input);
          }
          sendJson(response, 200, {
            ...run,
            logs: runs.getLogs(id, after),
          });
          return;
        }
        if (request.method === "POST" && action === "cancel") {
          sendJson(response, 200, runs.cancel(id));
          return;
        }
        if (request.method === "POST" && action === "choose") {
          sendJson(response, 200, runs.choose(id));
          return;
        }
        if (request.method === "POST" && action === "recheck") {
          if (run.state !== "finished") throw workflowError("busy", errorMessages.busy);
          const report = buildReport(
            run.input,
            run.result ?? { status: run.state === "finished" ? "infeasible" : run.state },
            run.result?.status === "feasible"
              ? checkTimetable(run.input, run.result.lessons)
              : undefined,
          );
          sendJson(response, 200, report);
          return;
        }
        if (request.method === "GET" && action === "view") {
          requireFeasible(run);
          const kind = url.searchParams.get("kind") ?? "";
          const key = url.searchParams.get("key") ?? "";
          if (!["group", "teacher", "room", "course"].includes(kind)) {
            throw workflowError("bad_input", errorMessages.bad_input);
          }
          if (key) decodedId(key);
          sendJson(response, 200, buildView(run.input, run.result, kind, key));
          return;
        }
        if (request.method === "GET" && action === "export.xlsx") {
          requireFeasible(run);
          const workbook = await createExcelBuffer(run.input, run.result);
          sendDownload(
            response,
            workbook,
            `${id}.xlsx`,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          );
          return;
        }
        if (request.method === "GET" && action === "export.pdf") {
          requireFeasible(run);
          const pdf = await createPdfBuffer(run.input, run.result);
          sendDownload(response, pdf, `${id}.pdf`, "application/pdf");
          return;
        }
      }

      if (request.method === "POST" && pathname === "/api/timetable") {
        const input = await readJsonBody(request);
        const result = await solver(input, { timeLimitMs });
        sendJson(response, result.status === "invalidInput" ? 422 : 200, result);
        return;
      }

      sendError(response, "not_found");
    } catch (error) {
      mapError(error, logger, response);
    }
  });
  server.on("close", () => runs.close());
  return server;
}

if (require.main === module) {
  const server = createServer();
  const port = Number(process.env.PORT ?? 5000);
  server.listen(port, "127.0.0.1", () => {
    console.log(`TimeTableMaker listening on http://127.0.0.1:${port}`);
  });
}

module.exports = { createServer };
