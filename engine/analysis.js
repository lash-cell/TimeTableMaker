"use strict";

function isOff(input, section, field = "") {
  return input.off.some((item) =>
    item.section === section && (item.field === "" || item.field === field));
}

function periodCount(range) {
  return range.end - range.start + 1;
}

function maxDayPeriods(limit, breaks) {
  return Math.max(...breaks.map((period) => Math.min(limit, period - 1 + limit - period)));
}

function possibleDayTotals(limit, breaks) {
  const possible = new Set();
  const lastBreak = Math.max(...breaks);
  for (const breakPeriod of breaks) {
    for (let afterBreak = lastBreak - breakPeriod;
      breakPeriod + afterBreak <= limit;
      afterBreak += 1) {
      possible.add(breakPeriod - 1 + afterBreak);
    }
  }
  return [...possible].sort((a, b) => a - b);
}

function possibleWeekTotals(dayTotals, days) {
  let totals = new Set([0]);
  for (let day = 0; day < days; day += 1) {
    const next = new Set();
    for (const total of totals) {
      for (const dayTotal of dayTotals) next.add(total + dayTotal);
    }
    totals = next;
  }
  return totals;
}

function addCause(causes, layer, message, refs = []) {
  causes.push({ layer, message, refs });
}

function invalidInputCause(input) {
  const arrays = ["groups", "courses", "teachers", "rooms", "off"];
  for (const field of arrays) {
    if (!Array.isArray(input[field])) {
      return { field, message: `Input field "${field}" must be a list` };
    }
  }
  if (!input.time || !Array.isArray(input.time.days) || !Array.isArray(input.time.breakPeriods) ||
      !Array.isArray(input.time.finishLimits) || !Number.isInteger(input.time.periodsPerDay)) {
    return { field: "time", message: 'Input field "time" is incomplete or invalid' };
  }
  if (!input.time.days.length || !input.time.breakPeriods.length ||
      input.time.breakPeriods.some((period) => !Number.isInteger(period) || period < 1) ||
      !Number.isInteger(input.time.periodsPerDay) || input.time.periodsPerDay < 1 ||
      input.time.breakPeriods.some((period) => period > input.time.periodsPerDay)) {
    return { field: "time", message: 'Input field "time" contains invalid periods' };
  }
  for (const course of input.courses) {
    if (!course || typeof course.id !== "string") {
      return { field: "courses", message: "A course record is invalid" };
    }
    if (!Number.isInteger(course.periods) || course.periods < 1) {
      return {
        field: `courses.${course.id}.periods`,
        message: `Course ${course.code ?? course.id} has an invalid period count`,
      };
    }
    if (!["theory", "practical"].includes(course.kind)) {
      return {
        field: `courses.${course.id}.kind`,
        message: `Course ${course.code ?? course.id} has an invalid kind`,
      };
    }
    if (!["general", "department", "activity"].includes(course.category)) {
      return {
        field: `courses.${course.id}.category`,
        message: `Course ${course.code ?? course.id} has an invalid category`,
      };
    }
  }
  return null;
}

function checkSizeLayer(input) {
  const causes = [];
  const breaks = input.time.breakPeriods;
  const dayCount = input.time.days.length;
  const limits = new Map(input.time.finishLimits.map((entry) => [entry.year, entry.lastPeriod]));
  const groupsByYear = new Map();
  for (const group of input.groups) {
    const list = groupsByYear.get(group.year) ?? [];
    list.push(group);
    groupsByYear.set(group.year, list);
  }

  for (const course of input.courses) {
    const limit = limits.get(course.year) ?? input.time.periodsPerDay;
    const longest = maxDayPeriods(limit, breaks);
    if (course.periods > longest) {
      addCause(
        causes,
        1,
        `Course ${course.code} needs ${course.periods} consecutive periods; the longest possible day has ${longest}.`,
        [{ courseId: course.id, needed: course.periods, possibleMax: longest }],
      );
    }
  }

  for (const [year, groups] of groupsByYear) {
    const limit = limits.get(year) ?? input.time.periodsPerDay;
    const dayTotals = possibleDayTotals(limit, breaks);
    const weeklyTotals = possibleWeekTotals(dayTotals, dayCount);
    for (const group of groups) {
      const needed = input.courses
        .filter((course) => course.year === group.year)
        .reduce((total, course) => total + course.periods, 0);
      if (!weeklyTotals.has(needed)) {
        addCause(
          causes,
          1,
          `Group ${group.name} needs ${needed} periods; its weekly day shapes cannot add up to that total.`,
          [{
            groupId: group.id,
            needed,
            possibleMin: Math.min(...weeklyTotals),
            possibleMax: Math.max(...weeklyTotals),
          }],
        );
      }
    }
  }
  return causes;
}

function fixedLessonCauseLayer(input) {
  const causes = [];
  const groupsById = new Map(input.groups.map((group) => [group.id, group]));
  const lessons = [];
  for (const course of input.courses) {
    const groups = input.groups.filter((group) => group.year === course.year);
    if (!course.fixed && course.category !== "activity") continue;
    const fixed = course.category === "activity" ? input.time.activitySlot : course.fixed;
    if (!fixed) continue;
    const groupSets = course.kind === "theory"
      ? [groups.map((group) => group.id)]
      : groups.map((group) => [group.id]);
    for (const groupIds of groupSets) lessons.push({ course, fixed, groupIds });
    const expectedLength = fixed.end - fixed.start + 1;
    if (expectedLength !== course.periods) {
      addCause(causes, 2, `Course ${course.code} has a fixed range whose length differs from its course periods.`, [
        { courseId: course.id, fixed, periods: course.periods },
      ]);
    }
    const finish = input.time.finishLimits.find((limit) => limit.year === course.year)?.lastPeriod ??
      input.time.periodsPerDay;
    if (fixed.end > finish) {
      addCause(causes, 2, `Course ${course.code} ends after its year's finish limit.`, [
        { courseId: course.id, fixed, lastPeriod: finish },
      ]);
    }
    if (input.time.breakPeriods.every((period) => fixed.start <= period && period <= fixed.end)) {
      addCause(causes, 2, `Course ${course.code} covers every possible break period.`, [
        { courseId: course.id, fixed },
      ]);
    }
  }

  for (let index = 0; index < lessons.length; index += 1) {
    const left = lessons[index];
    for (let otherIndex = index + 1; otherIndex < lessons.length; otherIndex += 1) {
      const right = lessons[otherIndex];
      if (left.fixed.day !== right.fixed.day ||
          left.fixed.start > right.fixed.end || right.fixed.start > left.fixed.end) continue;
      const overlappingGroups = left.groupIds.filter((id) => right.groupIds.includes(id));
      if (overlappingGroups.length) {
        const names = overlappingGroups.map((id) => groupsById.get(id)?.name ?? id).join(", ");
        addCause(causes, 2, `Courses ${left.course.code} and ${right.course.code} overlap for ${names}.`, [
          { courseIds: [left.course.id, right.course.id], groupIds: overlappingGroups },
        ]);
      }
    }
  }

  const reportedTeacherShortages = new Set();
  for (let day = 0; day < input.time.days.length; day += 1) {
    for (let period = 1; period <= input.time.periodsPerDay; period += 1) {
      const active = lessons.filter((lesson) =>
        lesson.fixed.day === day &&
        lesson.fixed.start <= period &&
        lesson.fixed.end >= period &&
        lesson.course.category !== "general");
      if (!active.length) continue;

      const availableTeachers = input.teachers.filter((teacher) =>
        isOff(input, "teachers", "unavailable") ||
        !(teacher.unavailable ?? []).some((range) =>
          range.day === day && range.start <= period && range.end >= period));
      if (active.length > availableTeachers.length) {
        const courseIds = active.map(({ course }) => course.id).sort();
        const signature = `${day}:${courseIds.join(",")}:${availableTeachers.length}`;
        if (!reportedTeacherShortages.has(signature)) {
          reportedTeacherShortages.add(signature);
          addCause(
            causes,
            2,
            `Fixed lessons need ${active.length} teachers on ${input.time.days[day]} period ${period}, but only ${availableTeachers.length} are available.`,
            [{ day, period, needed: active.length, available: availableTeachers.length, courseIds }],
          );
        }
      }

      const assignedTeachers = new Map();
      for (const lesson of active) {
        const teacherId = lesson.course.teacherId;
        if (!teacherId) continue;
        const teacher = input.teachers.find((item) => item.id === teacherId);
        if (teacher && !isOff(input, "teachers", "unavailable") &&
            (teacher.unavailable ?? []).some((range) =>
              range.day === day && range.start <= period && range.end >= period)) {
          addCause(causes, 2, `Fixed course ${lesson.course.code} uses unavailable teacher ${teacher.name}.`, [
            { courseId: lesson.course.id, teacherId, day, period },
          ]);
        }
        const simultaneous = assignedTeachers.get(teacherId) ?? [];
        simultaneous.push(lesson.course.id);
        assignedTeachers.set(teacherId, simultaneous);
      }
      for (const [teacherId, courseIds] of assignedTeachers) {
        if (courseIds.length > 1) {
          addCause(causes, 2, `Teacher ${teacherId} is assigned to overlapping fixed courses.`, [
            { teacherId, courseIds, day, period },
          ]);
        }
      }
    }
  }

  const roomsOff = isOff(input, "rooms");
  if (!roomsOff) {
    const computerRooms = input.rooms.filter((room) => room.type === "computer").length;
    const labRooms = input.rooms.filter((room) => room.type === "lab").length;
    for (let day = 0; day < input.time.days.length; day += 1) {
      for (let period = 1; period <= input.time.periodsPerDay; period += 1) {
        const active = lessons.filter((lesson) =>
          lesson.fixed.day === day &&
          lesson.fixed.start <= period &&
          lesson.fixed.end >= period);
        const counts = {
          computer: active.filter(({ course }) => course.roomType === "computer").length,
          lab: active.filter(({ course }) => course.roomType === "lab").length,
          flexible: active.filter(({ course }) => course.roomType === "computerOrLab").length,
        };
        const courseIds = active
          .filter(({ course }) => ["computer", "lab", "computerOrLab"].includes(course.roomType))
          .map(({ course }) => course.id);
        if (counts.computer > computerRooms) {
          addCause(causes, 2, `Fixed courses need ${counts.computer} computer rooms on ${input.time.days[day]} period ${period}, but only ${computerRooms} are available.`, [
            { day, period, roomType: "computer", courseIds },
          ]);
        }
        if (counts.lab > labRooms) {
          addCause(causes, 2, `Fixed courses need ${counts.lab} lab rooms on ${input.time.days[day]} period ${period}, but only ${labRooms} are available.`, [
            { day, period, roomType: "lab", courseIds },
          ]);
        }
        if (counts.computer + counts.lab + counts.flexible > computerRooms + labRooms) {
          addCause(causes, 2, `Fixed courses need ${counts.computer + counts.lab + counts.flexible} computer or lab rooms on ${input.time.days[day]} period ${period}, but only ${computerRooms + labRooms} are available.`, [
            { day, period, roomType: "computerOrLab", courseIds },
          ]);
        }
      }
    }
  }
  return causes;
}

function countPeriodOneStaff(input) {
  const causes = [];
  const groupsByYear = new Map();
  for (const group of input.groups) {
    const list = groupsByYear.get(group.year) ?? [];
    list.push(group);
    groupsByYear.set(group.year, list);
  }

  for (let day = 0; day < input.time.days.length; day += 1) {
    const availableTeachers = input.teachers.filter((teacher) =>
      isOff(input, "teachers", "unavailable") ||
      !(teacher.unavailable ?? []).some((range) =>
        range.day === day && range.start <= 1 && range.end >= 1));
    let needed = 0;
    const references = [];
    for (const [year, groups] of groupsByYear) {
      const coveringGeneral = input.courses.some((course) =>
        course.year === year &&
        course.category === "general" &&
        course.kind === "theory" &&
        course.fixed?.day === day &&
        course.fixed.start === 1 &&
        course.fixed.end >= 1);
      if (coveringGeneral) continue;
      const fixedShared = input.courses.some((course) =>
        course.year === year &&
        course.category !== "general" &&
        course.kind === "theory" &&
        course.fixed?.day === day &&
        course.fixed.start === 1 &&
        course.fixed.end >= 1);
      const movableShared = input.courses.some((course) =>
        course.year === year &&
        course.category !== "general" &&
        course.kind === "theory" &&
        !course.fixed &&
        course.periods <= Math.max(...input.time.breakPeriods) - 1);
      if (fixedShared || movableShared) {
        needed += 1;
      } else {
        needed += groups.length;
        references.push(...groups.map((group) => ({ groupId: group.id, year })));
      }
    }
    if (needed > availableTeachers.length) {
      addCause(
        causes,
        3,
        `Period 1 on ${input.time.days[day]} needs ${needed} teachers, but only ${availableTeachers.length} are available.`,
        [{ day, period: 1, needed, available: availableTeachers.length, groups: references }],
      );
    }
  }
  return causes;
}

function checkTeacherLayer(input, counted) {
  const causes = [];
  if (!isOff(input, "teachers", "minPeriods") && !isOff(input, "teachers", "maxPeriods") &&
      !isOff(input, "teachers")) {
    const minSum = input.teachers.reduce((sum, teacher) => sum + teacher.minPeriods, 0);
    const maxSum = input.teachers.reduce((sum, teacher) => sum + teacher.maxPeriods, 0);
    if (counted < minSum) {
      addCause(causes, 3, `Teachers require at least ${minSum} periods, but only ${counted} are counted.`, [
        { counted, minSum },
      ]);
    } else if (counted > maxSum) {
      addCause(causes, 3, `Teachers can cover at most ${maxSum} periods, but ${counted} are counted.`, [
        { counted, maxSum },
      ]);
    }
    for (const teacher of input.teachers) {
      const unavailable = (teacher.unavailable ?? []).reduce((total, range) => total + periodCount(range), 0);
      const available = input.time.days.length * input.time.periodsPerDay - unavailable;
      if (teacher.minPeriods > available) {
        addCause(causes, 3, `Teacher ${teacher.name} needs ${teacher.minPeriods} periods but has only ${available} available.`, [
          { teacherId: teacher.id, minPeriods: teacher.minPeriods, available },
        ]);
      }
    }
  }
  return causes;
}

function checkRoomLayer(input, lessons) {
  if (isOff(input, "rooms") || isOff(input, "courses", "roomType")) return [];
  const capacity = (type) => input.rooms.filter((room) => room.type === type).length *
    input.time.days.length * input.time.periodsPerDay;
  const needed = new Map();
  for (const lesson of lessons) {
    const course = input.courses.find((item) => item.id === lesson.courseId);
    if (!course || !course.roomType || course.roomType === "general") continue;
    const type = course.roomType;
    needed.set(type, (needed.get(type) ?? 0) + lesson.periods);
  }
  const causes = [];
  const computerOrLab = needed.get("computerOrLab") ?? 0;
  const computerCapacity = capacity("computer");
  const labCapacity = capacity("lab");
  for (const [type, count] of needed) {
    let available;
    if (type === "computerOrLab") {
      available = computerCapacity + labCapacity;
    } else if (type === "computer") {
      available = computerCapacity;
    } else if (type === "lab") {
      available = labCapacity;
    } else {
      continue;
    }
    if (count > available) {
      addCause(causes, 3, `${type} lessons need ${count} room-periods, but capacity is ${available}.`, [
        { roomType: type, needed: count, available },
      ]);
    }
  }
  if (computerOrLab && needed.has("computer") && needed.has("lab") &&
      needed.get("computer") + needed.get("lab") + computerOrLab > computerCapacity + labCapacity) {
    addCause(causes, 3, `Computer, lab, and flexible lessons need more room-periods than combined capacity.`, [
      {
        roomTypes: ["computer", "lab", "computerOrLab"],
        needed: needed.get("computer") + needed.get("lab") + computerOrLab,
        available: computerCapacity + labCapacity,
      },
    ]);
  }
  return causes;
}

function analyzeInput(input) {
  if (!input || typeof input !== "object") {
    return {
      status: "invalidInput",
      causes: [{ layer: 0, field: "input", message: "Input must be an object", refs: [] }],
      groups: [],
      teachers: { counted: 0, minSum: 0, maxSum: 0 },
    };
  }
  const invalid = invalidInputCause(input);
  if (invalid) {
    return {
      status: "invalidInput",
      causes: [{ layer: 0, field: invalid.field, message: invalid.message, refs: [] }],
      groups: [],
      teachers: { counted: 0, minSum: 0, maxSum: 0 },
    };
  }

  const built = require("./lesson-builder").createLessonsToPlace(input);
  const groupReports = input.groups.map((group) => {
    const needed = input.courses
      .filter((course) => course.year === group.year)
      .reduce((total, course) => total + course.periods, 0);
    const limit = input.time.finishLimits.find((entry) => entry.year === group.year)?.lastPeriod ??
      input.time.periodsPerDay;
    const weekTotals = possibleWeekTotals(possibleDayTotals(limit, input.time.breakPeriods), input.time.days.length);
    return {
      groupId: group.id,
      needed,
      possibleMin: Math.min(...weekTotals),
      possibleMax: Math.max(...weekTotals),
    };
  });
  const lessons = built.lessons;
  const counted = lessons.reduce((total, lesson) => {
    const course = input.courses.find((item) => item.id === lesson.courseId);
    return total + (course?.category === "general" ? 0 : lesson.periods);
  }, 0);
  const minSum = input.teachers.reduce((sum, teacher) => sum + teacher.minPeriods, 0);
  const maxSum = input.teachers.reduce((sum, teacher) => sum + teacher.maxPeriods, 0);
  const analysisBase = { groups: groupReports, teachers: { counted, minSum, maxSum } };
  const invalidCourse = built.conflicts[0];
  if (invalidCourse) {
    return {
      status: "invalidInput",
      causes: [{
        layer: 0,
        field: invalidCourse.reason,
        message: `Course ${invalidCourse.courseId} cannot be expanded: ${invalidCourse.reason}`,
        refs: [{ courseId: invalidCourse.courseId }],
      }],
      ...analysisBase,
    };
  }

  const sizeCauses = checkSizeLayer(input);
  if (sizeCauses.length) return { status: "infeasible", causes: sizeCauses, ...analysisBase };

  const fixedCauses = fixedLessonCauseLayer(input);
  if (fixedCauses.length) return { status: "infeasible", causes: fixedCauses, ...analysisBase };

  const teacherCauses = [
    ...checkTeacherLayer(input, counted),
    ...countPeriodOneStaff(input),
  ];
  if (teacherCauses.length) return { status: "infeasible", causes: teacherCauses, ...analysisBase };

  const roomCauses = checkRoomLayer(input, lessons);
  if (roomCauses.length) return { status: "infeasible", causes: roomCauses, ...analysisBase };

  return { status: "ok", causes: [], ...analysisBase };
}

module.exports = { analyzeInput };
