"use strict";

const sections = [
  {
    section: "groups",
    label: "กลุ่มผู้เรียน",
    fields: [
      { field: "name", label: "ชื่อกลุ่ม", required: true, allowed: "ข้อความ" },
      { field: "year", label: "ชั้นปี", required: true, allowed: "ข้อความ" },
    ],
  },
  {
    section: "courses",
    label: "รายวิชา",
    fields: [
      { field: "code", label: "รหัสวิชา", required: true, allowed: "ข้อความ" },
      { field: "name", label: "ชื่อวิชา", required: true, allowed: "ข้อความ" },
      { field: "year", label: "ชั้นปี", required: true, allowed: "ข้อความ" },
      { field: "periods", label: "คาบต่อสัปดาห์", required: true, allowed: "จำนวนเต็มตั้งแต่ 1" },
      { field: "kind", label: "ประเภทวิชา", required: true, allowed: "theory หรือ practical" },
      { field: "category", label: "หมวดวิชา", required: true, allowed: "general, department หรือ activity" },
      { field: "fixed", label: "วันและคาบที่กำหนด", required: false, allowed: "ช่วงวันและคาบ หรือเว้นว่าง" },
      { field: "roomType", label: "ประเภทห้อง", required: false, allowed: "computer, lab, computerOrLab, general หรือเว้นว่าง" },
    ],
    uploadFields: [
      { field: "courseCode", label: "Course Code", required: true, allowed: "ข้อความ" },
      { field: "courseName", label: "Course Name", required: true, allowed: "ข้อความ" },
      { field: "periodsPerWeek", label: "Periods", required: true, allowed: "จำนวนเต็มตั้งแต่ 1" },
      { field: "kind", label: "Course Type", required: true, allowed: "theory หรือ practical" },
      { field: "requirement", label: "Requirement", required: false, allowed: "วันและช่วงคาบ หรือเว้นว่าง" },
      { field: "roomDescription", label: "Room", required: false, allowed: "คำอธิบายห้อง หรือเว้นว่าง" },
    ],
  },
  {
    section: "teachers",
    label: "ผู้สอน",
    fields: [
      { field: "name", label: "ชื่อผู้สอน", required: true, allowed: "ข้อความ" },
      { field: "position", label: "ตำแหน่ง", required: true, allowed: "head, instructor หรือ other" },
      { field: "minPeriods", label: "คาบขั้นต่ำ", required: true, allowed: "จำนวนเต็มตั้งแต่ 0" },
      { field: "maxPeriods", label: "คาบสูงสุด", required: true, allowed: "จำนวนเต็มตั้งแต่ 0" },
      { field: "unavailable", label: "เวลาที่ไม่ว่าง", required: false, allowed: "วันและช่วงคาบ หรือเว้นว่าง" },
    ],
    uploadFields: [
      { field: "teacherName", label: "Teacher Name", required: true, allowed: "ข้อความ" },
      { field: "position", label: "Position", required: true, allowed: "head หรือ instructor" },
      { field: "teacherNote", label: "Availability", required: false, allowed: "วันและช่วงคาบ หรือเว้นว่าง" },
    ],
  },
  {
    section: "rooms",
    label: "ห้องเรียน",
    fields: [
      { field: "name", label: "ชื่อห้อง", required: true, allowed: "ข้อความ" },
      { field: "type", label: "ประเภทห้อง", required: true, allowed: "computer, lab หรือ general" },
      { field: "size", label: "ขนาดห้อง", required: false, allowed: "จำนวนเต็มตั้งแต่ 0 หรือเว้นว่าง" },
      { field: "unavailable", label: "เวลาที่ไม่ว่าง", required: false, allowed: "วันและช่วงคาบ หรือเว้นว่าง" },
    ],
  },
  {
    section: "time",
    label: "เวลาและขีดจำกัด",
    fields: [
      { field: "days", label: "วันเรียน", required: true, allowed: "รายการข้อความ ไม่ซ้ำกัน" },
      { field: "periodsPerDay", label: "คาบต่อวัน", required: true, allowed: "จำนวนเต็มตั้งแต่ 1" },
      { field: "breakPeriods", label: "คาบพัก", required: true, allowed: "รายการคาบต่อเนื่อง" },
      { field: "finishLimits", label: "คาบเลิกเรียนแยกตามชั้นปี", required: true, allowed: "รายการชั้นปีและคาบสุดท้าย" },
      { field: "activitySlot", label: "ช่วงเวลากิจกรรม", required: true, allowed: "ช่วงวันและคาบ" },
    ],
  },
];

function getDataGuide() {
  return {
    sections: sections.map(({ section, fields }) => ({
      section,
      fields: fields.map((field) => ({ ...field })),
    })),
  };
}

function getUploadFields(section) {
  const definition = sections.find((item) => item.section === section);
  return definition?.uploadFields?.map((field) => ({ ...field })) ?? [];
}

module.exports = { getDataGuide, getUploadFields };
