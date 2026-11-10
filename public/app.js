"use strict";

const state = {
  data: null,
  section: "groups",
  page: "data",
  resultTab: "timetable",
  kind: "group",
  runs: [],
  selectedRunId: "",
  selectedRun: null,
  activeRunId: "",
  pollTimer: null,
  elapsedTimer: null,
  runStartedAt: 0,
  proposal: null,
  editing: null,
  historySelection: new Set(),
  lessonById: new Map(),
  toastTimer: null,
};

const sectionInfo = {
  groups: {
    title: "กลุ่มเรียน",
    description: "ระบุกลุ่มผู้เรียนและชั้นปีที่ต้องจัดตาราง",
    prefix: "g",
    columns: [["name", "ชื่อกลุ่ม"], ["year", "ชั้นปี"]],
    fields: [
      { name: "name", label: "ชื่อกลุ่ม", required: true },
      { name: "year", label: "ชั้นปี", required: true },
    ],
  },
  courses: {
    title: "รายวิชา",
    description: "กำหนดรายวิชา จำนวนคาบ ประเภท และข้อกำหนดเฉพาะ",
    prefix: "c",
    columns: [["code", "รหัสวิชา"], ["name", "ชื่อวิชา"], ["year", "ชั้นปี"], ["periods", "คาบ"], ["kind", "ประเภท"], ["category", "หมวด"], ["roomType", "ประเภทห้อง"], ["roomDescription", "ห้องตามไฟล์"]],
    fields: [
      { name: "code", label: "รหัสวิชา", required: true },
      { name: "name", label: "ชื่อวิชา", required: true },
      { name: "year", label: "ชั้นปี", required: true },
      { name: "periods", label: "คาบต่อสัปดาห์", type: "number", min: 1, required: true },
      { name: "kind", label: "ทฤษฎี / ปฏิบัติ", type: "select", options: [["theory", "ทฤษฎี"], ["practical", "ปฏิบัติ"]], required: true },
      { name: "category", label: "หมวดวิชา", type: "select", options: [["general", "สามัญ"], ["department", "แผนกวิชา"], ["activity", "กิจกรรม"]], required: true },
      { name: "fixed", label: "วันและคาบที่กำหนด (JSON หรือ null)", type: "json", wide: true },
      { name: "roomType", label: "ประเภทห้อง", type: "select", options: [["", "ไม่ระบุ"], ["computer", "คอมพิวเตอร์"], ["lab", "ห้องปฏิบัติการ"], ["computerOrLab", "คอมพิวเตอร์หรือปฏิบัติการ"], ["general", "ห้องทั่วไป"]] },
      { name: "roomDescription", label: "คำอธิบายห้องตามไฟล์ต้นทาง" },
      { name: "teacherId", label: "รหัสผู้สอน (เว้นว่างเพื่อให้ระบบเลือก)" },
    ],
  },
  teachers: {
    title: "ผู้สอน",
    description: "กำหนดตำแหน่ง ภาระสอน และเวลาที่ผู้สอนไม่ว่าง",
    prefix: "t",
    columns: [["name", "ชื่อผู้สอน"], ["position", "ตำแหน่ง"], ["minPeriods", "ขั้นต่ำ"], ["maxPeriods", "สูงสุด"]],
    fields: [
      { name: "name", label: "ชื่อผู้สอน", required: true },
      { name: "position", label: "ตำแหน่ง", type: "select", options: [["head", "หัวหน้า"], ["instructor", "ผู้สอนประจำ"], ["other", "อื่น ๆ"]], required: true },
      { name: "minPeriods", label: "คาบขั้นต่ำ", type: "number", min: 0, required: true },
      { name: "maxPeriods", label: "คาบสูงสุด", type: "number", min: 0, required: true },
      { name: "unavailable", label: "ช่วงเวลาที่ไม่ว่าง (JSON list)", type: "json", wide: true },
    ],
  },
  rooms: {
    title: "ห้องเรียน",
    description: "กำหนดประเภทห้องและช่วงเวลาที่ไม่พร้อมใช้งาน",
    prefix: "r",
    columns: [["name", "ชื่อห้อง"], ["type", "ประเภท"], ["size", "ขนาด"]],
    fields: [
      { name: "name", label: "ชื่อห้อง", required: true },
      { name: "type", label: "ประเภทห้อง", type: "select", options: [["computer", "คอมพิวเตอร์"], ["lab", "ห้องปฏิบัติการ"], ["general", "ห้องทั่วไป"]], required: true },
      { name: "size", label: "ขนาดห้อง (เว้นว่างได้)", type: "number", min: 0 },
      { name: "unavailable", label: "ช่วงเวลาที่ไม่ว่าง (JSON list)", type: "json", wide: true },
    ],
  },
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/gu, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function showToast(message, isError = false) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.toggle("error", isError);
  toast.classList.add("show");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove("show"), 3200);
}

function setSystemStatus(message, status = "") {
  const element = $("#system-status");
  element.className = `system-status ${status}`.trim();
  element.lastElementChild.textContent = message;
}

async function api(url, options = {}) {
  let response;
  try {
    response = await fetch(url, options);
  } catch {
    setSystemStatus("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้", "error");
    throw new Error("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบว่า backend ทำงานอยู่ที่ 127.0.0.1:5000");
  }
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json") ? await response.json() : null;
  if (!response.ok) {
    const message = body?.error?.message ?? `คำขอไม่สำเร็จ (${response.status})`;
    const error = new Error(message);
    error.code = body?.error?.code ?? "";
    error.status = response.status;
    throw error;
  }
  setSystemStatus("เชื่อมต่อแล้ว", "ok");
  return { response, body };
}

function jsonOptions(method, body) {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

function showPage(name) {
  state.page = name;
  $$(".page").forEach((page) => page.classList.toggle("active", page.id === `page-${name}`));
  $$(".nav-button").forEach((button) => button.classList.toggle("active", button.dataset.page === name));
  if (name === "results") refreshRuns().catch((error) => showToast(error.message, true));
}

function setResultTab(name) {
  state.resultTab = name;
  $$(".result-tabs [data-result-tab]").forEach((button) =>
    button.classList.toggle("active", button.dataset.resultTab === name));
  $$(".result-panel").forEach((panel) =>
    panel.classList.toggle("active", panel.id === `result-${name}`));
  if (name === "history") renderHistory();
}

function isOff(section, field = "") {
  return state.data.off.some((item) =>
    item.section === section && (item.field === "" || item.field === field));
}

function sectionRecords(section) {
  return state.data[section] ?? [];
}

function renderCounts() {
  for (const section of ["groups", "courses", "teachers", "rooms"]) {
    $(`#count-${section}`).textContent = sectionRecords(section).length;
  }
}

function renderDataSection() {
  if (!state.data) return;
  renderCounts();
  const info = sectionInfo[state.section];
  $("#section-title").textContent = state.section === "time" ? "เวลาและขีดจำกัด" : info.title;
  $("#section-description").textContent = state.section === "time"
    ? "กำหนดวันเรียน ช่วงคาบ คาบพัก เวลาเลิก และช่วงกิจกรรม"
    : info.description;
  $("#rooms-toggle-wrap").classList.toggle("hidden", state.section !== "rooms");
  $("#edit-time").classList.toggle("hidden", state.section !== "time");
  $("#add-record").classList.toggle("hidden", state.section === "time");

  if (state.section === "time") {
    $("#data-table-wrap").innerHTML = renderTimeSummary();
    return;
  }

  const records = sectionRecords(state.section);
  const disabled = state.section === "rooms" && isOff("rooms");
  if (!records.length) {
    $("#data-table-wrap").innerHTML = `<div class="empty-state">${disabled
      ? "ยังไม่มีรายการห้อง ส่วนห้องเรียนปิดอยู่"
      : "ยังไม่มีข้อมูลในส่วนนี้ เพิ่มรายการหรือใช้ปุ่มนำเข้า"}</div>`;
    return;
  }
  const headers = info.columns.map(([, label]) => `<th>${escapeHtml(label)}</th>`).join("");
  const rows = records.map((record) => `
    <tr>
      ${info.columns.map(([field]) => `<td>${escapeHtml(formatCell(record[field]))}</td>`).join("")}
      <td class="actions"><button class="text-button" data-edit-record="${escapeHtml(record.id)}">แก้ไข</button><button class="text-button delete" data-delete-record="${escapeHtml(record.id)}">ลบ</button></td>
    </tr>`).join("");
  const roomStatus = disabled
    ? '<div class="empty-state">พบรายการห้องแล้ว แต่ยังไม่ใช้ในการจัดตาราง เปิด “ใช้กฎห้องเรียน” เมื่อต้องการให้ตัวจัดตารางกำหนดห้อง</div>'
    : "";
  $("#data-table-wrap").innerHTML = `${roomStatus}<table><thead><tr>${headers}<th></th></tr></thead><tbody>${rows}</tbody></table>`;
}

function formatCell(value) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value);
  const labels = {
    theory: "ทฤษฎี", practical: "ปฏิบัติ", general: "สามัญ", department: "แผนกวิชา",
    activity: "กิจกรรม", head: "หัวหน้า", instructor: "ผู้สอนประจำ", other: "อื่น ๆ",
    computer: "คอมพิวเตอร์", lab: "ปฏิบัติการ", computerOrLab: "คอมพิวเตอร์/ปฏิบัติการ",
  };
  return labels[value] ?? value;
}

function renderTimeSummary() {
  const time = state.data.time;
  return `<div class="time-summary">
    <div><span>วันเรียน</span><strong>${escapeHtml(time.days.join(", "))}</strong></div>
    <div><span>คาบต่อวัน</span><strong>${escapeHtml(time.periodsPerDay)}</strong></div>
    <div><span>คาบพักที่เลือกได้</span><strong>${escapeHtml(time.breakPeriods.join(", "))}</strong></div>
    <div><span>คาบเลิกตามชั้นปี</span><strong>${escapeHtml(JSON.stringify(time.finishLimits))}</strong></div>
    <div><span>ช่วงกิจกรรม</span><strong>${escapeHtml(JSON.stringify(time.activitySlot))}</strong></div>
    <button class="button secondary" id="edit-time-inline">แก้ไขข้อมูลเวลา</button>
  </div>`;
}

function renderReview() {
  const review = state.data?.review ?? [];
  const readyToConfirm = state.data.groups.length > 0 &&
    state.data.courses.length > 0 && state.data.teachers.length > 0;
  $("#review-count").textContent = `${review.length} รายการ`;
  $("#review-count").classList.toggle("success", review.length === 0);
  $("#review-count").classList.toggle("warning", review.length > 0);
  $("#confirmation-title").textContent = state.data?.confirmed ? "ยืนยันข้อมูลแล้ว" : "ตรวจข้อมูลก่อนยืนยัน";
  $("#confirmation-copy").textContent = review.length
    ? `ยังมี ${review.length} รายการที่ต้องตรวจ แก้ไขข้อมูลให้ถูกต้องก่อนจึงจะยืนยันได้`
    : !readyToConfirm
      ? "เพิ่มกลุ่มเรียน รายวิชา และผู้สอนให้ครบก่อนยืนยัน"
    : state.data?.confirmed
      ? "ข้อมูลพร้อมสำหรับตรวจความเป็นไปได้และจัดตาราง"
      : "ถ้าตรวจข้อมูลครบแล้ว ยืนยันเพื่อเริ่มขั้นตอนจัดตาราง";
  const confirmationDisabled = Boolean(state.data?.confirmed || review.length || !readyToConfirm);
  $("#confirm-data").disabled = confirmationDisabled;
  $("#confirm-data").classList.toggle("disabled", confirmationDisabled);
  $("#start-run").disabled = !state.data.confirmed;
  if (!review.length) {
    $("#review-list").innerHTML = '<div class="empty-state">ไม่มีรายการค้างตรวจ</div>';
    return;
  }
  $("#review-list").innerHTML = review.map((item) => `
    <article class="review-item">
      <div><strong>${escapeHtml(item.problem)}</strong><p>${escapeHtml(item.section)} · ${escapeHtml(item.field)} · ข้อมูลเดิม: ${escapeHtml(item.original)}</p></div>
      <div class="button-row">${item.recordId ? `<button class="text-button" data-review-edit="${escapeHtml(item.recordId)}" data-review-section="${escapeHtml(item.section)}">แก้รายการ</button>` : ""}<button class="text-button" data-review-dismiss="${escapeHtml(item.id)}">ตรวจแล้ว</button></div>
    </article>`).join("");
}

function renderRoomsToggle() {
  $("#rooms-enabled").checked = !isOff("rooms");
}

async function loadData() {
  const { body } = await api("/api/data");
  state.data = body;
  renderDataSection();
  renderReview();
  renderRoomsToggle();
}

async function saveData() {
  const { body } = await api("/api/data", jsonOptions("PUT", state.data));
  state.data = body;
  renderDataSection();
  renderReview();
  renderRoomsToggle();
}

function nextId(prefix, records) {
  const max = records.reduce((current, record) => {
    const match = new RegExp(`^${prefix}-(\\d+)$`).exec(record.id ?? "");
    return match ? Math.max(current, Number(match[1])) : current;
  }, 0);
  return `${prefix}-${max + 1}`;
}

function newRecord(section) {
  const info = sectionInfo[section];
  const record = { id: nextId(info.prefix, sectionRecords(section)) };
  for (const field of info.fields) {
    if (field.type === "json") record[field.name] = field.name === "fixed" ? null : [];
    else if (field.type === "number") record[field.name] = "";
    else if (field.type === "select") record[field.name] = field.options[0][0];
    else record[field.name] = "";
  }
  if (section === "courses" || section === "teachers") {
    record.source = { how: "form", confirmed: false };
    record.extra = [];
  }
  return record;
}

function fieldControl(field, record) {
  const value = record[field.name];
  const required = field.required ? "required" : "";
  if (field.name === "teacherId" && state.editing?.section === "courses") {
    const options = [["", "ให้ระบบเลือกผู้สอน"], ...state.data.teachers.map((teacher) =>
      [teacher.id, `${teacher.name} (${teacher.id})`])];
    return `<label>${escapeHtml(field.label)}<select name="${escapeHtml(field.name)}" ${required}>${options.map(([key, label]) =>
      `<option value="${escapeHtml(key)}" ${key === value ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}</select></label>`;
  }
  if (field.type === "select") {
    const options = field.options.map(([key, label]) =>
      `<option value="${escapeHtml(key)}" ${key === value ? "selected" : ""}>${escapeHtml(label)}</option>`).join("");
    return `<label class="${field.wide ? "wide" : ""}">${escapeHtml(field.label)}<select name="${escapeHtml(field.name)}" ${required}>${options}</select></label>`;
  }
  if (field.type === "json") {
    return `<label class="wide">${escapeHtml(field.label)}<textarea name="${escapeHtml(field.name)}" rows="3" ${required}>${escapeHtml(JSON.stringify(value ?? null, null, 2))}</textarea></label>`;
  }
  const type = field.type === "number" ? "number" : "text";
  const min = field.min === undefined ? "" : `min="${field.min}"`;
  return `<label>${escapeHtml(field.label)}<input name="${escapeHtml(field.name)}" type="${type}" value="${escapeHtml(value)}" ${min} ${required}></label>`;
}

function openRecordEditor(section, id = "") {
  if (section === "time") {
    state.editing = { section, id: "" };
    $("#record-dialog-title").textContent = "เวลาและขีดจำกัด";
    $("#record-fields").innerHTML = `<label class="wide">แก้ไขข้อมูลเวลาเป็น JSON<textarea name="timeJson" rows="18" required>${escapeHtml(JSON.stringify(state.data.time, null, 2))}</textarea></label>`;
    $("#record-dialog").showModal();
    return;
  }
  const original = id ? sectionRecords(section).find((record) => record.id === id) : null;
  if (id && !original) return;
  const record = original ? structuredClone(original) : newRecord(section);
  state.editing = { section, id: original?.id ?? "", record };
  $("#record-dialog-title").textContent = `${original ? "แก้ไข" : "เพิ่ม"}${sectionInfo[section].title}`;
  $("#record-fields").innerHTML = sectionInfo[section].fields.map((field) => fieldControl(field, record)).join("");
  $("#record-dialog").showModal();
}

function parseRecordForm(form) {
  const record = structuredClone(state.editing.record);
  for (const field of sectionInfo[state.editing.section].fields) {
    const control = form.elements.namedItem(field.name);
    if (field.type === "json") {
      try {
        record[field.name] = JSON.parse(control.value);
      } catch {
        throw new Error(`${field.label}: รูปแบบ JSON ไม่ถูกต้อง`);
      }
    } else if (field.type === "number") {
      record[field.name] = control.value === "" ? "" : Number(control.value);
    } else {
      record[field.name] = control.value.trim();
    }
  }
  return record;
}

async function commitRecordForm(form) {
  if (state.editing.section === "time") {
    try {
      state.data.time = JSON.parse(form.elements.namedItem("timeJson").value);
    } catch {
      throw new Error("ข้อมูลเวลา: รูปแบบ JSON ไม่ถูกต้อง");
    }
  } else {
    const { section, id } = state.editing;
    const updated = parseRecordForm(form);
    const list = sectionRecords(section);
    const index = id ? list.findIndex((record) => record.id === id) : -1;
    if (index >= 0) list[index] = updated;
    else list.push(updated);
  }
  await saveData();
  $("#record-dialog").close();
  showToast("บันทึกข้อมูลแล้ว ระบบตรวจข้อมูลให้อัตโนมัติ");
}

async function deleteRecord(section, id) {
  if (!confirm("ต้องการลบรายการนี้หรือไม่?")) return;
  state.data[section] = sectionRecords(section).filter((record) => record.id !== id);
  await saveData();
  showToast("ลบรายการแล้ว");
}

async function dismissReview(id) {
  state.data.review = state.data.review.filter((item) => item.id !== id);
  await saveData();
  showToast("ทำเครื่องหมายว่าตรวจรายการนี้แล้ว");
}

async function toggleRooms(enabled) {
  state.data.off = state.data.off.filter((item) => item.section !== "rooms");
  if (!enabled) {
    state.data.off.push({ section: "rooms", field: "" });
  }
  await saveData();
  showToast(enabled ? "เปิดใช้ข้อกำหนดห้องเรียนแล้ว" : "ปิดใช้ข้อกำหนดห้องเรียนแล้ว");
}

async function uploadWorkbook(file) {
  const proposal = await api("/api/data/upload", {
    method: "POST",
    headers: { "X-File-Name": encodeURIComponent(file.name) },
    body: await file.arrayBuffer(),
  });
  state.proposal = proposal.body;
  renderMatchProposal();
}

async function submitPaste() {
  const section = $("#paste-section").value;
  const proposal = await api("/api/data/paste", jsonOptions("POST", {
    section,
    year: $("#paste-year").value.trim(),
    text: $("#paste-text").value,
  }));
  state.proposal = proposal.body;
  $("#paste-dialog").close();
  renderMatchProposal();
}

function renderMatchProposal() {
  const proposal = state.proposal;
  if (!proposal) return;
  const sections = proposal.sheets.map((sheet, sheetIndex) => {
    const columns = sheet.columns.map((column, columnIndex) => {
      const fields = sheet.sheetType === "courses"
        ? ["", "courseCode", "courseName", "periodsPerWeek", "kind", "requirement", "roomDescription"]
        : sheet.sheetType === "teachers"
          ? ["", "teacherName", "position", "teacherNote"]
          : [""];
      return `<tr><td>${escapeHtml(column.header || `คอลัมน์ ${column.index}`)}</td><td>${escapeHtml(column.samples.join(" · "))}</td><td><select data-sheet="${sheetIndex}" data-column="${columnIndex}">${fields.map((field) =>
        `<option value="${field}" ${field === column.field ? "selected" : ""}>${escapeHtml(field || "ไม่ใช้")}</option>`).join("")}</select></td><td>${column.sure === "yes" ? "จับคู่อัตโนมัติ" : "ตรวจสอบ"}</td></tr>`;
    }).join("");
    return `<section class="match-sheet"><h3>${escapeHtml(sheet.name)} · ${escapeHtml(sheet.sheetType)}</h3>${sheet.columns.length
      ? `<div class="table-wrap"><table><thead><tr><th>หัวคอลัมน์</th><th>ตัวอย่าง</th><th>จับคู่กับ</th><th>ความมั่นใจ</th></tr></thead><tbody>${columns}</tbody></table></div>`
      : '<p class="muted small">ไม่พบคอลัมน์ที่จับคู่ได้</p>'}</section>`;
  }).join("");
  $("#record-dialog-title").textContent = "จับคู่คอลัมน์ก่อนนำเข้า";
  $("#record-fields").innerHTML = `<p class="muted small wide">ตรวจความหมายของแต่ละคอลัมน์ก่อนนำข้อมูลเข้าตาราง</p>${sections}  <div class="modal-actions wide"><button type="button" class="button secondary" id="cancel-match">ยกเลิก</button><button type="button" class="button primary" id="apply-match">นำเข้าข้อมูล</button></div>`;
  $("#record-dialog").showModal();
  $("#apply-match").addEventListener("click", () => applyProposal().catch((error) => showToast(error.message, true)));
  $("#cancel-match").addEventListener("click", () => {
    state.proposal = null;
    $("#record-dialog").close();
  });
}

async function applyProposal() {
  const proposal = state.proposal;
  if (!proposal) return;
  $$("#record-fields select[data-sheet]").forEach((select) => {
    proposal.sheets[Number(select.dataset.sheet)].columns[Number(select.dataset.column)].field = select.value;
  });
  const { body } = await api("/api/data/match", jsonOptions("POST", proposal));
  state.data = body;
  state.proposal = null;
  $("#record-dialog").close();
  renderDataSection();
  renderReview();
  renderRoomsToggle();
  showToast("นำเข้าข้อมูลแล้ว ตรวจรายการที่ต้องแก้ไข");
}

async function showGuide() {
  const { body } = await api("/api/data/guide");
  $("#guide-content").innerHTML = body.sections.map((section) => `
    <section class="guide-section"><h3>${escapeHtml(section.section)}</h3>
      <div class="guide-fields">${section.fields.map((field) =>
        `<strong>${escapeHtml(field.label)}</strong><span>${field.required ? "จำเป็น" : "ไม่บังคับ"}</span><span>${escapeHtml(field.allowed)}</span>`).join("")}</div>
    </section>`).join("");
  $("#guide-dialog").showModal();
}

function renderAnalysis(analysis) {
  if (!analysis) return;
  const box = $("#analysis-result");
  box.className = `analysis-result ${analysis.status === "ok" ? "good" : "bad"}`;
  const status = analysis.status === "ok" ? "ข้อมูลเบื้องต้นมีแนวโน้มจัดได้" :
    analysis.status === "infeasible" ? "พบข้อจำกัดที่ทำให้จัดไม่ได้" : "ข้อมูลยังไม่ครบหรือไม่ถูกต้อง";
  const groups = analysis.groups ?? [];
  const groupMetrics = groups.map((group) => {
    const record = state.data.groups.find((item) => item.id === group.groupId);
    return `<div class="stat-card"><strong>${escapeHtml(record?.name ?? group.groupId)}</strong><span>ต้องการ ${escapeHtml(group.needed)} คาบ · รองรับ ${escapeHtml(group.possibleMin)}–${escapeHtml(group.possibleMax)} คาบ</span></div>`;
  }).join("");
  const causes = (analysis.causes ?? []).map((cause) =>
    `<li>${escapeHtml(cause.message)}</li>`).join("");
  box.innerHTML = `<strong>${escapeHtml(status)}</strong>
    <div class="metric-strip">
      <div><strong>${escapeHtml(analysis.teachers?.counted ?? "—")}</strong><span>คาบสอนที่นับ</span></div>
      <div><strong>${escapeHtml(analysis.teachers?.minSum ?? "—")}–${escapeHtml(analysis.teachers?.maxSum ?? "—")}</strong><span>กรอบภาระสอนรวม</span></div>
      <div><strong>${groups.length}</strong><span>กลุ่มที่วิเคราะห์</span></div>
    </div>
    ${groupMetrics ? `<div class="stats-grid">${groupMetrics}</div>` : ""}
    ${causes ? `<ul class="cause-list">${causes}</ul>` : ""}`;
}

async function checkFeasibility() {
  $("#check-input").disabled = true;
  $("#analysis-result").textContent = "กำลังวิเคราะห์ข้อมูล…";
  try {
    const { body } = await api("/api/check", { method: "POST" });
    renderAnalysis(body);
  } finally {
    $("#check-input").disabled = false;
  }
}

function clearRunTimers() {
  clearInterval(state.pollTimer);
  clearInterval(state.elapsedTimer);
  state.pollTimer = null;
  state.elapsedTimer = null;
}

async function startRun() {
  $("#start-run").disabled = true;
  try {
    const { body: run } = await api("/api/runs", { method: "POST" });
    state.activeRunId = run.id;
    state.runStartedAt = Date.now();
    $("#run-result").className = "analysis-result";
    $("#run-result").textContent = "กำลังค้นหาตารางที่ผ่านข้อกำหนด…";
    $("#run-progress").classList.remove("hidden");
    $("#cancel-run").classList.remove("hidden");
    $("#start-run").classList.add("hidden");
    $("#open-run-result").classList.add("hidden");
    state.elapsedTimer = setInterval(() => {
      $("#run-elapsed").textContent = `เวลาที่ใช้ ${((Date.now() - state.runStartedAt) / 1000).toFixed(1)} วินาที`;
    }, 250);
    state.pollTimer = setInterval(() => pollRun().catch((error) => {
      clearRunTimers();
      showToast(error.message, true);
    }), 850);
    await pollRun();
  } catch (error) {
    $("#run-result").className = "analysis-result bad";
    $("#run-result").textContent = error.message;
    $("#start-run").disabled = false;
    showToast(error.message, true);
  }
}

async function pollRun() {
  const id = state.activeRunId;
  if (!id) return;
  const { body: run } = await api(`/api/runs/${encodeURIComponent(id)}`);
  if (state.activeRunId !== id || run.state === "running") return;
  await finishRun(run);
}

async function finishRun(run) {
  if (!run || state.activeRunId !== run.id) return;
  clearRunTimers();
  state.activeRunId = "";
  $("#run-progress").classList.add("hidden");
  $("#cancel-run").classList.add("hidden");
  $("#cancel-run").disabled = false;
  $("#cancel-run").textContent = "ยกเลิก";
  $("#start-run").classList.remove("hidden");
  $("#start-run").disabled = false;
  const result = run.result;
  const statusLabels = {
    feasible: "จัดตารางสำเร็จ และผลผ่านการตรวจสอบ",
    infeasible: "ไม่พบตารางที่เป็นไปได้",
    searchLimit: "หยุดค้นหาตามขีดจำกัด ยังสรุปไม่ได้ว่าจัดไม่ได้",
    invalidInput: "ข้อมูลไม่ถูกต้อง",
    validationFailed: "ผลตารางไม่ผ่านการตรวจสอบ",
  };
  $("#run-result").className = `analysis-result ${result?.status === "feasible" ? "good" : "bad"}`;
  $("#run-result").textContent = run.state === "failed"
    ? run.error
    : run.state === "cancelled"
      ? "ยกเลิกรอบจัดตารางแล้ว"
      : statusLabels[result?.status] ?? "รอบจัดตารางเสร็จแล้ว";
  if (run.state === "finished") {
    state.selectedRunId = run.id;
    $("#open-run-result").classList.remove("hidden");
  }
  await refreshRuns();
}

async function cancelRun() {
  if (!state.activeRunId || $("#cancel-run").disabled) return;
  const id = state.activeRunId;
  const button = $("#cancel-run");
  button.disabled = true;
  button.textContent = "กำลังยกเลิก…";
  try {
    const { body: run } = await api(`/api/runs/${encodeURIComponent(id)}/cancel`, { method: "POST" });
    if (run.state !== "running") await finishRun(run);
  } finally {
    if (state.activeRunId === id) {
      button.disabled = false;
      button.textContent = "ยกเลิก";
    }
  }
}

async function refreshRuns() {
  const { body } = await api("/api/runs");
  state.runs = body;
  const preferred = state.selectedRunId ||
    state.runs.find((run) => run.chosen)?.id ||
    state.runs[0]?.id || "";
  const select = $("#run-picker");
  select.innerHTML = `<option value="">เลือกรอบจัดตาราง</option>${state.runs.map((run) =>
    `<option value="${escapeHtml(run.id)}">${escapeHtml(formatDate(run.createdAt))} · ${escapeHtml(run.status ?? run.state)}${run.chosen ? " · เลือกไว้" : ""}</option>`).join("")}`;
  if (preferred && state.runs.some((run) => run.id === preferred)) {
    select.value = preferred;
    if (state.selectedRunId !== preferred || state.selectedRun?.id !== preferred) {
      await selectRun(preferred);
    }
  } else if (!state.runs.length) {
    state.selectedRun = null;
    state.selectedRunId = "";
    renderSelectedRun();
  }
  renderHistory();
}

function formatDate(value) {
  if (!value) return "เวลาไม่ระบุ";
  return new Date(value).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" });
}

async function selectRun(id) {
  if (!id) {
    state.selectedRunId = "";
    state.selectedRun = null;
    renderSelectedRun();
    return;
  }
  const { body } = await api(`/api/runs/${encodeURIComponent(id)}`);
  state.selectedRunId = id;
  state.selectedRun = body;
  renderSelectedRun();
}

function selectedResult() {
  return state.selectedRun?.result;
}

function setExportLinks(feasible) {
  for (const [selector, extension] of [["#export-xlsx", "xlsx"], ["#export-pdf", "pdf"]]) {
    const link = $(selector);
    if (feasible) {
      link.href = `/api/runs/${encodeURIComponent(state.selectedRunId)}/export.${extension}`;
      link.classList.remove("disabled");
      link.removeAttribute("aria-disabled");
      link.setAttribute("download", "");
    } else {
      link.removeAttribute("href");
      link.classList.add("disabled");
      link.setAttribute("aria-disabled", "true");
    }
  }
}

function renderSelectedRun() {
  const run = state.selectedRun;
  const result = selectedResult();
  const feasible = run?.state === "finished" && result?.status === "feasible";
  setExportLinks(Boolean(feasible));
  $("#result-summary").textContent = run
    ? `${formatDate(run.createdAt)} · ${run.state === "finished" ? result?.status : run.state}`
    : "เลือกผลการจัดตารางจากประวัติ";
  if (!run) {
    $("#timetable-content").innerHTML = '<div class="empty-state">ยังไม่มีตารางที่จัดสำเร็จ</div>';
    $("#report-content").innerHTML = '<div class="empty-state">เลือกรอบจัดตารางเพื่อดูรายงาน</div>';
    $("#statistics-content").innerHTML = '<div class="empty-state">เลือกรอบจัดตารางเพื่อดูสถิติ</div>';
    renderHistory();
    return;
  }
  renderReport(run);
  renderStatistics(run);
  if (feasible) loadTimetable().catch((error) => showToast(error.message, true));
  else $("#timetable-content").innerHTML = '<div class="empty-state">รอบนี้ไม่มีตารางที่จัดสำเร็จ ใช้แท็บรายงานเพื่อดูสาเหตุ</div>';
}

async function loadTimetable() {
  const run = state.selectedRun;
  if (!run || run.result?.status !== "feasible") return;
  const params = new URLSearchParams({ kind: state.kind });
  const key = $("#view-key").value;
  if (state.kind !== "course" && key) params.set("key", key);
  const { body } = await api(`/api/runs/${encodeURIComponent(run.id)}/view?${params}`);
  renderTimetable(body);
}

function renderTimetable(view) {
  const keys = view.keys ?? [];
  $("#view-key-wrap").classList.toggle("hidden", view.kind === "course" || !keys.length);
  $("#view-key-label").textContent = ({ group: "เลือกกลุ่ม", teacher: "เลือกผู้สอน", room: "เลือกห้อง" })[view.kind] ?? "";
  const keySelect = $("#view-key");
  keySelect.innerHTML = keys.map((item) =>
    `<option value="${escapeHtml(item.id)}" ${item.id === view.key ? "selected" : ""}>${escapeHtml(item.label)}</option>`).join("");
  if (view.kind === "course") {
    const lessons = view.lessons ?? [];
    state.lessonById = new Map(lessons.map((lesson) => [lesson.id, lesson]));
    $("#timetable-content").innerHTML = lessons.length
      ? `<table><thead><tr><th>วัน</th><th>คาบ</th><th>รหัสวิชา</th><th>รายวิชา</th><th>กลุ่ม</th><th>ผู้สอน</th><th>ห้อง</th></tr></thead><tbody>${lessons.map((lesson) =>
        `<tr><td>${escapeHtml(state.selectedRun.input.time.days[lesson.day])}</td><td>${escapeHtml(`${lesson.start}-${lesson.end}`)}</td><td>${escapeHtml(lesson.code)}</td><td><button class="text-button" data-lesson="${escapeHtml(lesson.id)}">${escapeHtml(lesson.name)}</button></td><td>${escapeHtml(lesson.groupNames.join(", "))}</td><td>${escapeHtml(lesson.teacherName)}</td><td>${escapeHtml(lesson.roomName)}</td></tr>`).join("")}</tbody></table>`
      : '<div class="empty-state">ไม่มีคาบเรียนในตารางนี้</div>';
    return;
  }
  if (!view.rows?.length) {
    $("#timetable-content").innerHTML = '<div class="empty-state">ไม่มีรายการที่แสดงได้ในมุมมองนี้</div>';
    return;
  }
  const days = state.selectedRun.input.time.days;
  const periods = state.selectedRun.input.time.periodsPerDay;
  const header = `<tr><th>วัน / คาบ</th>${Array.from({ length: periods }, (_, index) => `<th>${index + 1}</th>`).join("")}</tr>`;
  const body = view.rows.map((row) => {
    const cells = row.cells.map((cell) => {
      const span = cell.end - cell.start + 1;
      if (cell.type === "lesson") {
        state.lessonById.set(cell.lesson.id, cell.lesson);
        const label = view.kind === "group" ? cell.lesson.code : cell.lesson.code;
        const secondary = view.kind === "group"
          ? cell.lesson.name
          : `${cell.lesson.groupNames.join(", ")}${cell.lesson.teacherName ? ` · ${cell.lesson.teacherName}` : ""}`;
        return `<td class="lesson-cell" colspan="${span}"><button class="lesson-button" data-lesson="${escapeHtml(cell.lesson.id)}">${escapeHtml(label)}<small>${escapeHtml(secondary)}</small></button></td>`;
      }
      if (cell.type === "break") return `<td class="break-cell" colspan="${span}">พัก</td>`;
      return `<td class="free-cell" colspan="${span}">${span > 1 ? "ว่าง" : "—"}</td>`;
    }).join("");
    return `<tr><td>${escapeHtml(row.dayName || days[row.day])}</td>${cells}</tr>`;
  }).join("");
  $("#timetable-content").innerHTML = `<table class="timetable"><thead>${header}</thead><tbody>${body}</tbody></table>`;
}

function renderReport(run) {
  const result = run.result;
  if (!result) {
    $("#report-content").innerHTML = `<div class="report-wrap"><div class="empty-state">${escapeHtml(run.error ?? "รายงานจะพร้อมหลังจัดตารางเสร็จ")}</div></div>`;
    return;
  }
  const report = result.report ?? {};
  const items = report.items ?? [];
  const violations = report.violations ?? [];
  const itemCount = result.status === "feasible"
    ? items.filter((item) => item.result === "passed").length
    : 0;
  const causeList = [...(report.causes ?? []), ...(report.likelyCauses ?? [])];
  const rubricTable = items.length
    ? `<h3>ผลตามข้อกำหนด</h3><div class="table-wrap"><table class="rubric-table"><thead><tr><th>ข้อ</th><th>ผล</th><th>จำนวน</th></tr></thead><tbody>${items.map((item) =>
      `<tr><td>${escapeHtml(item.rubricId)}</td><td><span class="status-text ${escapeHtml(item.result)}">${({ passed: "ผ่าน", failed: "ไม่ผ่าน", notApplied: "ไม่ใช้" })[item.result] ?? escapeHtml(item.result)}</span></td><td>${escapeHtml(item.count)}</td></tr>`).join("")}</tbody></table></div>`
    : "";
  const violationList = violations.length
    ? `<h3 style="margin-top:22px">รายการขัดแย้ง</h3>${violations.map((item) =>
      `<article class="violation-card"><strong>ข้อ ${escapeHtml(item.rubricId)} · ${escapeHtml(item.constraint)}</strong><p>${escapeHtml(item.message)} · วัน ${escapeHtml(item.day === null ? "—" : (run.input.time.days[item.day] ?? item.day))} · คาบ ${escapeHtml(item.start ?? "—")}-${escapeHtml(item.end ?? "—")}</p></article>`).join("")}`
    : "";
  const causes = causeList.length
    ? `<h3 style="margin-top:22px">สาเหตุที่รายงาน</h3><ul class="cause-list">${causeList.map((cause) => `<li>${escapeHtml(cause)}</li>`).join("")}</ul>`
    : "";
  const teacherLoads = report.teacherLoads?.length
    ? `<h3 style="margin-top:22px">ภาระสอน</h3><table><thead><tr><th>รหัสผู้สอน</th><th>คาบ</th><th>ขั้นต่ำ</th><th>สูงสุด</th></tr></thead><tbody>${report.teacherLoads.map((teacher) =>
      `<tr><td>${escapeHtml(teacher.teacherId)}</td><td>${escapeHtml(teacher.periods)}</td><td>${escapeHtml(teacher.minPeriods)}</td><td>${escapeHtml(teacher.maxPeriods)}</td></tr>`).join("")}</tbody></table>`
    : "";
  $("#report-content").innerHTML = `<div class="report-wrap">
    <div class="button-row" style="justify-content:space-between;margin-bottom:16px"><div><h2>รายงานตรวจสอบ</h2><p class="muted small">${result.status === "feasible" ? "รายงานจากตัวตรวจสอบอิสระ" : "สาเหตุและสถานะจากตัววิเคราะห์"}</p></div><button id="recheck-run" class="button secondary">ตรวจซ้ำ</button></div>
    <div class="report-summary">
      <div class="summary-card"><strong>${escapeHtml(result.status)}</strong><span>สถานะตาราง</span></div>
      <div class="summary-card"><strong>${escapeHtml(itemCount)} / ${items.filter((item) => item.result !== "notApplied").length}</strong><span>ข้อกำหนดที่ผ่าน</span></div>
      <div class="summary-card"><strong>${escapeHtml(violations.length)}</strong><span>รายการขัดแย้ง</span></div>
    </div>
    ${rubricTable}
    ${violationList}
    ${causes}
    ${teacherLoads}
  </div>`;
  $("#recheck-run")?.addEventListener("click", () => recheckRun(run.id).catch((error) => showToast(error.message, true)));
}

async function recheckRun(id) {
  const button = $("#recheck-run");
  if (button) {
    button.disabled = true;
    button.textContent = "กำลังตรวจ…";
  }
  try {
    const { body } = await api(`/api/runs/${encodeURIComponent(id)}/recheck`, { method: "POST" });
    if (state.selectedRun?.id === id) {
      state.selectedRun.result.report = body;
      renderReport(state.selectedRun);
    }
    showToast("ตรวจตารางซ้ำแล้ว");
  } finally {
    if (button?.isConnected) {
      button.disabled = false;
      button.textContent = "ตรวจซ้ำ";
    }
  }
}

function renderStatistics(run) {
  const result = run.result;
  if (!result) {
    $("#statistics-content").innerHTML = '<div class="empty-state">สถิติจะพร้อมหลังจัดตารางเสร็จ</div>';
    return;
  }
  const stats = result.stats ?? {};
  const analysis = result.analysis ?? {};
  const groups = analysis.groups ?? [];
  const labels = {
    OPTIMAL: "พบค่าที่เหมาะสมที่สุด",
    FEASIBLE: "พบตารางที่เป็นไปได้",
    INFEASIBLE: "ไม่มีตารางที่เป็นไปได้",
    UNKNOWN: "ยังไม่สรุป",
    NOT_STARTED: "ยังไม่ได้เริ่ม solver",
    TERMINATED: "หยุดตามเวลา",
  };
  const groupRows = groups.map((group) => {
    const record = run.input.groups.find((item) => item.id === group.groupId);
    return `<tr><td>${escapeHtml(record?.name ?? group.groupId)}</td><td>${escapeHtml(group.needed)}</td><td>${escapeHtml(group.possibleMin)}–${escapeHtml(group.possibleMax)}</td><td>${escapeHtml(group.needed >= group.possibleMin && group.needed <= group.possibleMax ? "อยู่ในช่วง" : "นอกช่วง")}</td></tr>`;
  }).join("");
  const history = result.scoreHistory ?? [];
  const scoreValues = history.map((entry) => entry.total);
  const minScore = scoreValues.length ? Math.min(...scoreValues) : 0;
  const maxScore = scoreValues.length ? Math.max(...scoreValues) : 0;
  const scorePoints = history.map((entry, index) => {
    const x = history.length < 2 ? 320 : 12 + index * 616 / (history.length - 1);
    const range = maxScore - minScore || 1;
    const y = 128 - (entry.total - minScore) * 112 / range;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const finalScore = history.at(-1);
  const assumptions = result.assumptions ?? [];
  $("#statistics-content").innerHTML = `<div class="stats-wrap">
    <h2>สถิติรอบจัดตาราง</h2>
    <div class="stats-grid">
      <div class="stat-card"><strong>${formatMetric(stats.bridgeMs ?? stats.ms, " ms")}</strong><span>เวลารวมในแอป</span></div>
      <div class="stat-card"><strong>${escapeHtml(labels[stats.solverStatus] ?? stats.solverStatus ?? "—")}</strong><span>สถานะ CP-SAT</span></div>
      <div class="stat-card"><strong>${formatMetric(stats.branches)}</strong><span>จำนวน branches</span></div>
      <div class="stat-card"><strong>${formatMetric(stats.conflicts)}</strong><span>จำนวน conflicts</span></div>
    </div>
    <article class="algo-card"><h3>อัลกอริทึมที่ใช้</h3><p>OR-Tools CP-SAT สร้างตารางจากข้อจำกัดด้านเวลา กลุ่ม ผู้สอน และห้องพร้อมกัน จากนั้นใช้การปรับปรุงตารางแบบ seeded late-acceptance โดยรับเฉพาะการเปลี่ยนแปลงที่ยังผ่านตัวตรวจสอบอิสระ JavaScript</p></article>
    ${history.length ? `<section class="score-section"><div class="section-toolbar"><div><h3>คะแนนปรับปรุงตาราง</h3><p class="muted small">คะแนนต่ำลงหมายถึงค่า proxy ดีขึ้น ไม่ใช่คะแนนทางการของเกณฑ์</p></div><strong>${formatMetric(history[0].total)} → ${formatMetric(finalScore.total)}</strong></div><div class="score-chart"><svg viewBox="0 0 640 145" role="img" aria-label="กราฟคะแนนตามรอบการปรับปรุง"><line x1="12" y1="16" x2="628" y2="16"></line><line x1="12" y1="72" x2="628" y2="72"></line><line x1="12" y1="128" x2="628" y2="128"></line><polyline points="${scorePoints}"></polyline></svg></div><div class="score-terms">${Object.entries(finalScore.terms ?? {}).map(([term, value]) => `<span><strong>${escapeHtml(term)}</strong> ${formatMetric(value)}</span>`).join("")}</div></section>` : ""}
    <h3>จำนวนคาบของแต่ละกลุ่ม</h3>
    ${groupRows ? `<div class="table-wrap"><table><thead><tr><th>กลุ่ม</th><th>ต้องจัด</th><th>ช่วงที่รองรับ</th><th>ผลวิเคราะห์</th></tr></thead><tbody>${groupRows}</tbody></table></div>` : '<p class="muted small">ผลรอบนี้ไม่มีข้อมูลวิเคราะห์รายกลุ่ม</p>'}
    ${assumptions.length ? `<h3 style="margin-top:22px">สมมติฐานและการตั้งค่า</h3><ul class="assumption-list">${assumptions.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}
    <div class="small muted" style="margin-top:14px">เวลาของ solver ${formatMetric(stats.wallTimeSeconds, " วินาที")} · ตัวแปร ${formatMetric(stats.variables)} · ข้อจำกัด ${formatMetric(stats.constraints)} · รอบปรับปรุง ${formatMetric(stats.improvementRounds)} · สถานะผล ${escapeHtml(result.status)}</div>
    <button id="open-history-from-stats" class="text-button">ดูประวัติและเปรียบเทียบรอบ →</button>
  </div>`;
  $("#open-history-from-stats")?.addEventListener("click", () => setResultTab("history"));
}

function formatMetric(value, suffix = "") {
  if (value === undefined || value === null || value === "") return "—";
  const formatted = typeof value === "number" && Number.isFinite(value)
    ? new Intl.NumberFormat("th-TH", { maximumFractionDigits: 2 }).format(value)
    : value;
  return `${escapeHtml(formatted)}${suffix}`;
}

function renderHistory() {
  const runs = state.runs;
  if (!runs.length) {
    $("#history-content").innerHTML = '<div class="empty-state">ยังไม่มีประวัติการจัดตาราง</div>';
    return;
  }
  const selections = [...state.historySelection].filter((id) => runs.some((run) => run.id === id));
  state.historySelection = new Set(selections.slice(-2));
  $("#history-content").innerHTML = `<div class="history-wrap">
    <div class="compare-controls"><span>เลือกสองรอบเพื่อเปรียบเทียบ:</span>${runs.map((run) =>
      `<label><input type="checkbox" data-compare-run="${escapeHtml(run.id)}" ${state.historySelection.has(run.id) ? "checked" : ""} ${!state.historySelection.has(run.id) && state.historySelection.size >= 2 ? "disabled" : ""}> ${escapeHtml(formatDate(run.createdAt))}</label>`).join("")}<button id="compare-runs" class="button secondary" ${state.historySelection.size !== 2 ? "disabled" : ""}>เปรียบเทียบ</button></div>
    <div class="history-row header"><span></span><span>รอบจัดตาราง</span><span>สถานะ / คะแนน</span><span>ข้อกำหนดผ่าน</span><span>การเลือก</span></div>
    ${runs.map((run) => `<div class="history-row"><span><button class="text-button" data-select-run="${escapeHtml(run.id)}">เปิด</button></span><span><strong>${escapeHtml(formatDate(run.createdAt))}</strong><small>${escapeHtml(run.id)}</small></span><span>${escapeHtml(run.status ?? run.state)} · ${escapeHtml(run.total ?? "—")}</span><span>${escapeHtml(run.itemsPassed ?? 0)}</span><span>${run.chosen ? '<span class="pill success">ใช้งาน</span>' : `<button class="text-button" data-choose-run="${escapeHtml(run.id)}">ใช้รอบนี้</button>`}</span></div>`).join("")}
    <div id="compare-result" class="compare-result"></div>
  </div>`;
  $$("[data-compare-run]").forEach((checkbox) => checkbox.addEventListener("change", () => {
    if (checkbox.checked) state.historySelection.add(checkbox.dataset.compareRun);
    else state.historySelection.delete(checkbox.dataset.compareRun);
    if (state.historySelection.size > 2) state.historySelection.delete(state.historySelection.values().next().value);
    renderHistory();
  }));
  $("#compare-runs")?.addEventListener("click", () => compareSelectedRuns().catch((error) => showToast(error.message, true)));
  $$("[data-select-run]").forEach((button) => button.addEventListener("click", () =>
    selectRun(button.dataset.selectRun).catch((error) => showToast(error.message, true))));
  $$("[data-choose-run]").forEach((button) => button.addEventListener("click", () =>
    chooseRun(button.dataset.chooseRun).catch((error) => showToast(error.message, true))));
}

async function chooseRun(id) {
  await api(`/api/runs/${encodeURIComponent(id)}/choose`, { method: "POST" });
  state.selectedRunId = id;
  await refreshRuns();
  showToast("เลือกรอบจัดตารางนี้แล้ว");
}

async function compareSelectedRuns() {
  const [a, b] = [...state.historySelection];
  if (!a || !b) return;
  const { body } = await api(`/api/runs/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`);
  const score = (summary) => summary.score
    ? `คะแนนรวม ${summary.score.total} (S1 ${summary.score.terms.S1}, S2 ${summary.score.terms.S2}, S3 ${summary.score.terms.S3})`
    : "ไม่มีคะแนน";
  $("#compare-result").innerHTML = `<div class="report-summary"><div class="summary-card"><strong>${escapeHtml(body.a.status ?? body.a.state)}</strong><span>รอบ A · ${escapeHtml(score(body.a))}</span></div><div class="summary-card"><strong>${escapeHtml(body.b.status ?? body.b.state)}</strong><span>รอบ B · ${escapeHtml(score(body.b))}</span></div><div class="summary-card"><strong>${escapeHtml(body.dataChanges.length)}</strong><span>รายการข้อมูลที่เปลี่ยน</span></div></div><h3>ความแตกต่างของข้อมูล</h3>${body.dataChanges.length ? `<ul class="compare-list">${body.dataChanges.map((change) => `<li>${escapeHtml(change)}</li>`).join("")}</ul>` : '<p class="muted small">ข้อมูลเหมือนกัน</p>'}`;
}

function updatePasteSection() {
  $("#paste-year-wrap").classList.toggle("hidden", $("#paste-section").value !== "courses");
}

function bindEvents() {
  $$(".nav-button").forEach((button) => button.addEventListener("click", () => showPage(button.dataset.page)));
  $$(".section-tab").forEach((button) => button.addEventListener("click", () => {
    if (!button.dataset.section) return;
    state.section = button.dataset.section;
    $$(".section-tab[data-section]").forEach((tab) => tab.classList.toggle("active", tab === button));
    renderDataSection();
  }));
  $$(".result-tabs [data-result-tab]").forEach((button) =>
    button.addEventListener("click", () => setResultTab(button.dataset.resultTab)));
  $$(".kind-button").forEach((button) => button.addEventListener("click", () => {
    state.kind = button.dataset.kind;
    $$(".kind-button").forEach((item) => item.classList.toggle("active", item === button));
    loadTimetable().catch((error) => showToast(error.message, true));
  }));
  $("#view-key").addEventListener("change", () => loadTimetable().catch((error) => showToast(error.message, true)));
  $("#run-picker").addEventListener("change", () => selectRun($("#run-picker").value).catch((error) => showToast(error.message, true)));
  $("#data-table-wrap").addEventListener("click", (event) => {
    const edit = event.target.closest("[data-edit-record]");
    const remove = event.target.closest("[data-delete-record]");
    if (edit) openRecordEditor(state.section, edit.dataset.editRecord);
    if (remove) deleteRecord(state.section, remove.dataset.deleteRecord).catch((error) => showToast(error.message, true));
    if (event.target.closest("#edit-time-inline")) openRecordEditor("time");
  });
  $("#add-record").addEventListener("click", () => openRecordEditor(state.section));
  $("#edit-time").addEventListener("click", () => openRecordEditor("time"));
  $("#record-form").addEventListener("submit", (event) => {
    if (event.submitter?.value !== "save") return;
    event.preventDefault();
    commitRecordForm(event.currentTarget).catch((error) => showToast(error.message, true));
  });
  $("#rooms-enabled").addEventListener("change", (event) => toggleRooms(event.target.checked).catch((error) => showToast(error.message, true)));
  $("#review-list").addEventListener("click", (event) => {
    const edit = event.target.closest("[data-review-edit]");
    const dismiss = event.target.closest("[data-review-dismiss]");
    if (edit) {
      const section = edit.dataset.reviewSection;
      const mapped = section === "course" ? "courses" : section === "teacher" ? "teachers" : section;
      if (sectionInfo[mapped]) openRecordEditor(mapped, edit.dataset.reviewEdit);
      else showToast("รายการนี้ไม่มีระเบียนให้เปิดแก้ไข", true);
    }
    if (dismiss) dismissReview(dismiss.dataset.reviewDismiss).catch((error) => showToast(error.message, true));
  });
  $("#confirm-data").addEventListener("click", async () => {
    try {
      const { body } = await api("/api/data/confirm", { method: "POST" });
      state.data = body;
      renderReview();
      showToast("ยืนยันข้อมูลแล้ว");
    } catch (error) {
      await loadData();
      showToast(error.message, true);
    }
  });
  $("#upload-file").addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (file) uploadWorkbook(file).catch((error) => showToast(error.message, true));
    event.target.value = "";
  });
  $("#open-paste").addEventListener("click", () => $("#paste-dialog").showModal());
  $("#paste-section").addEventListener("change", updatePasteSection);
  $("#paste-form").addEventListener("submit", (event) => {
    if (event.submitter?.value !== "paste") return;
    event.preventDefault();
    submitPaste().catch((error) => showToast(error.message, true));
  });
  $("#open-guide").addEventListener("click", () => showGuide().catch((error) => showToast(error.message, true)));
  $("#check-input").addEventListener("click", () => checkFeasibility().catch((error) => showToast(error.message, true)));
  $("#start-run").addEventListener("click", () => startRun());
  $("#cancel-run").addEventListener("click", () => cancelRun().catch((error) => showToast(error.message, true)));
  $("#open-run-result").addEventListener("click", () => {
    showPage("results");
    setResultTab("timetable");
    refreshRuns().catch((error) => showToast(error.message, true));
  });
  $("#timetable-content").addEventListener("click", (event) => {
    const button = event.target.closest("[data-lesson]");
    if (!button) return;
    const lesson = state.lessonById.get(button.dataset.lesson);
    if (!lesson) return;
    const course = state.selectedRun.input.courses.find((item) => item.id === lesson.courseId);
    $("#lesson-title").textContent = `${lesson.code} · ${lesson.name}`;
    $("#lesson-details").innerHTML = `<p><strong>วันและคาบ:</strong> ${escapeHtml(state.selectedRun.input.time.days[lesson.day])} · ${escapeHtml(lesson.start)}-${escapeHtml(lesson.end)}</p><p><strong>กลุ่ม:</strong> ${escapeHtml(lesson.groupNames?.join(", ") ?? "")}</p><p><strong>ผู้สอน:</strong> ${escapeHtml(lesson.teacherName ?? "")}</p><p><strong>ห้อง:</strong> ${escapeHtml(lesson.roomName ?? "")}</p><p><strong>หมวดวิชา:</strong> ${escapeHtml(formatCell(course?.category))}</p>`;
    $("#lesson-dialog").showModal();
  });
  $$("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => $(`#${button.dataset.closeDialog}`).close()));
  $("#paste-form").addEventListener("click", (event) => {
    if (event.target.value === "cancel") $("#paste-dialog").close();
  });
}

async function init() {
  bindEvents();
  try {
    await Promise.all([loadData(), refreshRuns()]);
    setSystemStatus("เชื่อมต่อแล้ว", "ok");
  } catch (error) {
    setSystemStatus("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้", "error");
    showToast(error.message, true);
  }
}

init();
