"use strict";

const RUBRIC_IDS = ["1.1", "1.2", "1.3", "1.4", "1.5", "1.6", "1.7", "1.8", "1.9", "1.10", "1.11", "1.12", "2.1"];

function isOff(input, section, field = "") {
  return input.off.some((item) =>
    item.section === section && (item.field === "" || item.field === field));
}

function teacherLoadPeriods(lesson, course) {
  return course.category === "general" ? 0 : lesson.end - lesson.start + 1;
}

function violation(rubricId, constraint, message, details = {}) {
  return {
    rubricId,
    constraint,
    message,
    groupIds: details.groupIds ?? [],
    teacherId: details.teacherId ?? "",
    roomId: details.roomId ?? "",
    day: details.day ?? null,
    start: details.start ?? null,
    end: details.end ?? null,
  };
}

function checkTimetable(input, lessons) {
  if (!input || !Array.isArray(input.groups) || !Array.isArray(input.courses) ||
      !Array.isArray(input.teachers) || !Array.isArray(input.rooms) ||
      !Array.isArray(input.time?.days) || !Array.isArray(input.time?.breakPeriods) ||
      !Array.isArray(input.time?.finishLimits) || !Array.isArray(input.off) ||
      !Array.isArray(lessons)) {
    throw new TypeError("checkTimetable requires input data and a lessons array");
  }

  const violations = [];
  const groups = new Map(input.groups.map((group) => [group.id, group]));
  const courses = new Map(input.courses.map((course) => [course.id, course]));
  const teachers = new Map(input.teachers.map((teacher) => [teacher.id, teacher]));
  const rooms = new Map(input.rooms.map((room) => [room.id, room]));
  const finishLimits = new Map(input.time.finishLimits.map((limit) => [limit.year, limit.lastPeriod]));
  const teacherLoads = new Map(input.teachers.map((teacher) => [teacher.id, 0]));
  const periodsByGroup = new Map(input.groups.map((group) => [group.id, new Map()]));
  const periodsByTeacher = new Map(input.teachers.map((teacher) => [teacher.id, new Map()]));
  const periodsByRoom = new Map(input.rooms.map((room) => [room.id, new Map()]));
  const lessonsByCourse = new Map(input.courses.map((course) => [course.id, []]));
  const lessonsByGroupDay = new Map();
  const roomsOff = isOff(input, "rooms") || isOff(input, "courses", "roomType");
  const teacherWorkloadOff = isOff(input, "teachers", "minPeriods") ||
    isOff(input, "teachers", "maxPeriods") || isOff(input, "teachers");
  const teacherAvailabilityOff = isOff(input, "teachers", "unavailable") || isOff(input, "teachers");
  const roomAvailabilityOff = isOff(input, "rooms", "unavailable") || roomsOff;

  const add = (rubricId, constraint, message, details) => {
    violations.push(violation(rubricId, constraint, message, details));
  };
  const occupiedPeriods = (map, start, end, lesson, rubricId, constraint, message) => {
    for (let period = start; period <= end; period += 1) {
      const current = map.get(period);
      if (current) {
        add(rubricId, constraint, message, {
          groupIds: [...new Set([...(current.groupIds ?? []), ...(lesson.groupIds ?? [])])],
          teacherId: lesson.teacherId || current.teacherId || "",
          roomId: lesson.roomId || current.roomId || "",
          day: lesson.day,
          start: period,
          end: period,
        });
      } else {
        map.set(period, lesson);
      }
    }
  };

  for (const lesson of lessons) {
    const course = courses.get(lesson.courseId);
    if (!course) {
      add("2.1", "H3", "พบคาบเรียนที่ไม่อ้างถึงรายวิชาในข้อมูล", {
        groupIds: lesson.groupIds,
        teacherId: lesson.teacherId,
        roomId: lesson.roomId,
        day: lesson.day,
        start: lesson.start,
        end: lesson.end,
      });
      continue;
    }

    lessonsByCourse.get(course.id).push(lesson);
    const duration = Number.isInteger(lesson.start) && Number.isInteger(lesson.end)
      ? lesson.end - lesson.start + 1
      : 0;
    if (duration !== course.periods) {
      add("1.7", "H3", `รายวิชา ${course.code} ต้องเป็นบล็อกต่อเนื่อง ${course.periods} คาบ`, {
        groupIds: lesson.groupIds,
        teacherId: lesson.teacherId,
        roomId: lesson.roomId,
        day: lesson.day,
        start: lesson.start,
        end: lesson.end,
      });
    }

    const yearGroups = input.groups.filter((group) => group.year === course.year);
    const expectedGroupIds = course.kind === "theory"
      ? yearGroups.map((group) => group.id).sort()
      : (lesson.groupIds ?? []).filter((id) => groups.has(id)).sort();
    const actualGroupIds = [...new Set(lesson.groupIds ?? [])].sort();
    if (!actualGroupIds.length || actualGroupIds.some((id) => !groups.has(id)) ||
        (course.kind === "theory" && JSON.stringify(actualGroupIds) !== JSON.stringify(expectedGroupIds)) ||
        (course.kind === "practical" && actualGroupIds.length !== 1)) {
      add("1.4", "H4", `การแบ่งกลุ่มของรายวิชา ${course.code} ไม่ตรงกับประเภทวิชา`, {
        groupIds: actualGroupIds,
        teacherId: lesson.teacherId,
        roomId: lesson.roomId,
        day: lesson.day,
        start: lesson.start,
        end: lesson.end,
      });
    }

    if (course.category === "activity" &&
        (lesson.day !== input.time.activitySlot.day ||
         lesson.start !== input.time.activitySlot.start ||
         lesson.end !== input.time.activitySlot.end)) {
      add("1.3", "H6", `รายวิชากิจกรรม ${course.code} ไม่อยู่ในช่วงกิจกรรมที่กำหนด`, {
        groupIds: lesson.groupIds,
        teacherId: lesson.teacherId,
        roomId: lesson.roomId,
        day: lesson.day,
        start: lesson.start,
        end: lesson.end,
      });
    }

    if (course.fixed && (lesson.day !== course.fixed.day ||
        lesson.start !== course.fixed.start || lesson.end !== course.fixed.end)) {
      add("1.12", "H5", `รายวิชา ${course.code} ไม่ตรงกับวันและคาบที่กำหนด`, {
        groupIds: lesson.groupIds,
        teacherId: lesson.teacherId,
        roomId: lesson.roomId,
        day: lesson.day,
        start: lesson.start,
        end: lesson.end,
      });
    }

    if (course.teacherId && lesson.teacherId !== course.teacherId) {
      add("1.12", "H7", `รายวิชา ${course.code} ต้องสอนโดยผู้สอนที่กำหนด`, {
        groupIds: lesson.groupIds,
        teacherId: lesson.teacherId,
        roomId: lesson.roomId,
        day: lesson.day,
        start: lesson.start,
        end: lesson.end,
      });
    }

    if (course.category === "general") {
      if (lesson.teacherId) {
        add("1.5", "H12", `รายวิชาสามัญ ${course.code} ต้องไม่มีผู้สอนประจำแผนก`, {
          groupIds: lesson.groupIds,
          teacherId: lesson.teacherId,
          roomId: lesson.roomId,
          day: lesson.day,
          start: lesson.start,
          end: lesson.end,
        });
      }
    } else if (!lesson.teacherId || !teachers.has(lesson.teacherId)) {
      add("1.5", "H7", `รายวิชา ${course.code} ต้องมีผู้สอนที่อยู่ในข้อมูล`, {
        groupIds: lesson.groupIds,
        teacherId: lesson.teacherId,
        roomId: lesson.roomId,
        day: lesson.day,
        start: lesson.start,
        end: lesson.end,
      });
    } else {
      teacherLoads.set(
        lesson.teacherId,
        (teacherLoads.get(lesson.teacherId) ?? 0) + teacherLoadPeriods(lesson, course),
      );
    }

    for (const groupId of new Set(lesson.groupIds ?? [])) {
      if (!groups.has(groupId)) continue;
      const groupPeriods = periodsByGroup.get(groupId);
      const groupDayKey = `${groupId}:${lesson.day}`;
      const groupDay = lessonsByGroupDay.get(groupDayKey) ?? [];
      groupDay.push(lesson);
      lessonsByGroupDay.set(groupDayKey, groupDay);
      const dayPeriods = groupPeriods.get(lesson.day) ?? new Map();
      occupiedPeriods(dayPeriods, lesson.start, lesson.end, lesson, "1.9", "H1", `กลุ่มเรียน ${groups.get(groupId).name} มีคาบเรียนซ้อนกัน`);
      groupPeriods.set(lesson.day, dayPeriods);
    }

    if (lesson.teacherId && teachers.has(lesson.teacherId)) {
      const dayPeriods = periodsByTeacher.get(lesson.teacherId).get(lesson.day) ?? new Map();
      occupiedPeriods(dayPeriods, lesson.start, lesson.end, lesson, "1.8", "H7", "ผู้สอนมีคาบเรียนซ้อนกัน");
      periodsByTeacher.get(lesson.teacherId).set(lesson.day, dayPeriods);
    }

    if (!roomsOff && !lesson.roomId && course.roomType && course.roomType !== "general") {
      add("1.6", "H9", `รายวิชา ${course.code} ต้องใช้ห้องตามประเภทที่กำหนด`, {
        groupIds: lesson.groupIds,
        teacherId: lesson.teacherId,
        day: lesson.day,
        start: lesson.start,
        end: lesson.end,
      });
    } else if (!roomsOff && lesson.roomId) {
      const room = rooms.get(lesson.roomId);
      if (!room) {
        add("1.6", "H9", "คาบเรียนอ้างถึงห้องที่ไม่มีอยู่ในข้อมูล", {
          groupIds: lesson.groupIds,
          teacherId: lesson.teacherId,
          roomId: lesson.roomId,
          day: lesson.day,
          start: lesson.start,
          end: lesson.end,
        });
      } else {
        const allowed = course.roomType === "" || course.roomType === room.type ||
          (course.roomType === "computerOrLab" && ["computer", "lab"].includes(room.type));
        if (!allowed) {
          add("1.6", "H9", `ห้อง ${room.name} ไม่ตรงกับประเภทห้องของรายวิชา ${course.code}`, {
            groupIds: lesson.groupIds,
            teacherId: lesson.teacherId,
            roomId: lesson.roomId,
            day: lesson.day,
            start: lesson.start,
            end: lesson.end,
          });
        }
        const dayPeriods = periodsByRoom.get(lesson.roomId).get(lesson.day) ?? new Map();
        occupiedPeriods(dayPeriods, lesson.start, lesson.end, lesson, "1.6", "H9", `ห้อง ${room.name} ถูกใช้ซ้อนกัน`);
        periodsByRoom.get(lesson.roomId).set(lesson.day, dayPeriods);
      }
    }
  }

  for (const course of input.courses) {
    const courseLessons = lessonsByCourse.get(course.id);
    const expectedGroups = input.groups
      .filter((group) => group.year === course.year)
      .map((group) => group.id);
    const actualCounts = new Map(expectedGroups.map((id) => [id, 0]));
    for (const lesson of courseLessons) {
      for (const groupId of lesson.groupIds ?? []) {
        if (actualCounts.has(groupId)) actualCounts.set(groupId, actualCounts.get(groupId) + 1);
      }
    }
    const missingOrDuplicate = [...actualCounts.values()].some((count) => count !== 1);
    if (missingOrDuplicate) {
      add("2.1", "H3", `รายวิชา ${course.code} ยังจัดไม่ครบหนึ่งครั้งต่อกลุ่ม`, {
        groupIds: expectedGroups,
      });
    }
  }

  for (const group of input.groups) {
    const finishLimit = finishLimits.get(group.year) ?? input.time.periodsPerDay;
    for (let day = 0; day < input.time.days.length; day += 1) {
      const dayLessons = lessonsByGroupDay.get(`${group.id}:${day}`) ?? [];
      const occupied = periodsByGroup.get(group.id).get(day) ?? new Map();
      if (dayLessons.length === 0) {
        add("1.11", "H2", `กลุ่มเรียน ${group.name} ไม่มีคาบเรียนวัน${input.time.days[day]}`, {
          groupIds: [group.id],
          day,
        });
      } else {
        const firstPeriod = Math.min(...dayLessons.map((lesson) => lesson.start));
        const lastPeriod = Math.max(...dayLessons.map((lesson) => lesson.end));
        if (firstPeriod !== 1) {
          add("1.11", "H2", `กลุ่มเรียน ${group.name} ต้องเริ่มคาบ 1 วัน${input.time.days[day]}`, {
            groupIds: [group.id],
            day,
            start: firstPeriod,
            end: firstPeriod,
          });
        }
        for (let period = 1; period <= lastPeriod; period += 1) {
          if (!occupied.has(period) && !input.time.breakPeriods.includes(period)) {
            add("1.11", "H2", `กลุ่มเรียน ${group.name} มีคาบว่างแทรกวัน${input.time.days[day]}`, {
              groupIds: [group.id],
              day,
              start: period,
              end: period,
            });
          }
        }
        if (lastPeriod > finishLimit) {
          add("1.1", "H2", `กลุ่มเรียน ${group.name} เรียนเกินคาบสุดท้ายที่กำหนดวัน${input.time.days[day]}`, {
            groupIds: [group.id],
            day,
            start: finishLimit + 1,
            end: lastPeriod,
          });
        }
      }

      const freeBreaks = input.time.breakPeriods.filter((period) => !occupied.has(period));
      if (freeBreaks.length !== 1) {
        add("1.2", "H2", `กลุ่มเรียน ${group.name} ต้องมีคาบพักว่างหนึ่งคาบในช่วงพักที่กำหนดวัน${input.time.days[day]}`, {
          groupIds: [group.id],
          day,
          start: freeBreaks[0] ?? null,
          end: freeBreaks.at(-1) ?? null,
        });
      }
    }
  }

  if (!teacherAvailabilityOff) {
    for (const teacher of input.teachers) {
      for (const range of teacher.unavailable ?? []) {
        const occupied = periodsByTeacher.get(teacher.id);
        for (let period = range.start; period <= range.end; period += 1) {
          if (occupied.get(range.day)?.has(period)) {
            add("1.10", "H8", `ผู้สอน ${teacher.name} ถูกจัดในช่วงเวลาที่ไม่ว่าง`, {
              teacherId: teacher.id,
              day: range.day,
              start: period,
              end: period,
            });
          }
        }
      }
    }
  }

  if (!roomsOff && !roomAvailabilityOff) {
    for (const room of input.rooms) {
      for (const range of room.unavailable ?? []) {
        const occupied = periodsByRoom.get(room.id);
        for (let period = range.start; period <= range.end; period += 1) {
          if (occupied.get(range.day)?.has(period)) {
            add("1.10", "H10", `ห้อง ${room.name} ถูกใช้ในช่วงเวลาที่ไม่ว่าง`, {
              roomId: room.id,
              day: range.day,
              start: period,
              end: period,
            });
          }
        }
      }
    }
  }

  if (!teacherWorkloadOff) {
    for (const teacher of input.teachers) {
      const periods = teacherLoads.get(teacher.id) ?? 0;
      if (periods < teacher.minPeriods || periods > teacher.maxPeriods) {
        add("1.5", "H11", `ภาระสอนของผู้สอน ${teacher.name} อยู่นอกช่วงที่กำหนด`, {
          teacherId: teacher.id,
        });
      }
    }
  }

  const items = RUBRIC_IDS.map((rubricId) => {
    const count = violations.filter((item) => item.rubricId === rubricId).length;
    const notApplied = (rubricId === "1.6" && roomsOff) ||
      (rubricId === "1.5" && teacherWorkloadOff);
    return {
      rubricId,
      result: count ? "failed" : notApplied ? "notApplied" : "passed",
      count: notApplied && !count ? 0 : count,
    };
  });
  const teacherLoadReport = input.teachers.map((teacher) => ({
    teacherId: teacher.id,
    periods: teacherLoads.get(teacher.id) ?? 0,
    minPeriods: teacher.minPeriods,
    maxPeriods: teacher.maxPeriods,
  }));
  return {
    items,
    violations,
    teacherLoads: teacherLoadReport,
    causes: [],
    likelyCauses: [],
  };
}

module.exports = { checkTimetable };
