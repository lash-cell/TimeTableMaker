"use strict";

function sortedKeys(items, id, label) {
  return items
    .map((item) => ({ id: item[id], label: item[label] }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

function buildView(input, result, kind, requestedKey = "") {
  if (result.status !== "feasible") {
    const error = new Error("A timetable view requires a feasible run");
    error.code = "not_feasible";
    throw error;
  }
  if (!["group", "teacher", "room", "course"].includes(kind)) {
    throw new RangeError(`Unknown view kind "${kind}"`);
  }

  const groups = new Map(input.groups.map((group) => [group.id, group]));
  const courses = new Map(input.courses.map((course) => [course.id, course]));
  const teachers = new Map(input.teachers.map((teacher) => [teacher.id, teacher]));
  const rooms = new Map(input.rooms.map((room) => [room.id, room]));
  const lessons = result.lessons.map((lesson) => {
    const course = courses.get(lesson.courseId);
    return {
      ...lesson,
      code: course.code,
      name: course.name,
      groupNames: lesson.groupIds.map((id) => groups.get(id).name).sort(),
      teacherName: teachers.get(lesson.teacherId)?.name ?? "",
      roomName: rooms.get(lesson.roomId)?.name ?? "",
    };
  });

  if (kind === "course") {
    return {
      kind,
      keys: [],
      key: "",
      lessons: lessons.sort((left, right) =>
        left.code.localeCompare(right.code) ||
        left.groupNames.join(", ").localeCompare(right.groupNames.join(", "))),
    };
  }

  let keys;
  if (kind === "group") {
    keys = sortedKeys(input.groups, "id", "name");
  } else if (kind === "teacher") {
    const assigned = new Set(lessons.map((lesson) => lesson.teacherId).filter(Boolean));
    keys = sortedKeys(input.teachers.filter((teacher) => assigned.has(teacher.id)), "id", "name");
  } else {
    const assigned = new Set(lessons.map((lesson) => lesson.roomId).filter(Boolean));
    keys = sortedKeys(input.rooms.filter((room) => assigned.has(room.id)), "id", "name");
  }

  if (!keys.length) return { kind, keys, key: "", rows: [] };
  const key = requestedKey || keys[0]?.id || "";
  if (!keys.some((item) => item.id === key)) {
    const error = new Error(`No ${kind} view exists for "${key}"`);
    error.code = "not_found";
    throw error;
  }

  const rows = input.time.days.map((dayName, day) => {
    const occupancy = Array(input.time.periodsPerDay + 1).fill(null);
    for (const lesson of lessons) {
      const matches = kind === "group"
        ? lesson.groupIds.includes(key)
        : kind === "teacher"
          ? lesson.teacherId === key
          : lesson.roomId === key;
      if (!matches || lesson.day !== day) continue;
      for (let period = lesson.start; period <= lesson.end; period += 1) {
        occupancy[period] = lesson;
      }
    }

    const breakPeriod = kind === "group"
      ? input.time.breakPeriods.find((period) => occupancy[period] === null)
      : undefined;
    const cells = [];
    for (let period = 1; period <= input.time.periodsPerDay;) {
      const lesson = occupancy[period];
      const type = lesson ? "lesson" : period === breakPeriod ? "break" : "free";
      const end = lesson ? lesson.end : period;
      if (lesson) {
        cells.push({ type, start: period, end, lesson });
        period = end + 1;
      } else {
        const cell = cells.at(-1);
        if (cell?.type === type && cell.end === period - 1) {
          cell.end = period;
        } else {
          cells.push({ type, start: period, end: period });
        }
        period += 1;
      }
    }
    return { day, dayName, cells };
  });

  return { kind, keys, key, rows };
}

module.exports = { buildView };
