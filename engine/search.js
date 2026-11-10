"use strict";

const { analyzeInput } = require("./analysis");
const { createLessonsToPlace } = require("./lesson-builder");

function isOff(input, section, field = "") {
  return input.off.some((item) =>
    item.section === section && (item.field === "" || item.field === field));
}

function unavailableAt(ranges, day, period) {
  return ranges.some((range) =>
    range.day === day && range.start <= period && range.end >= period);
}

function incrementRejection(rejections, constraint) {
  rejections.set(constraint, (rejections.get(constraint) ?? 0) + 1);
}

function scheduledLesson(task, day, start, course) {
  return {
    id: task.id,
    courseId: task.courseId,
    groupIds: [...task.groupIds],
    day,
    start,
    end: start + task.periods - 1,
    teacherId: course.teacherId ?? "",
    roomId: "",
  };
}

function possibleDayTotals(limit, breakPeriods) {
  const totals = new Set();
  const lastBreak = Math.max(...breakPeriods);
  for (const breakPeriod of breakPeriods) {
    for (let afterBreak = lastBreak - breakPeriod;
      breakPeriod + afterBreak <= limit;
      afterBreak += 1) {
      totals.add(breakPeriod - 1 + afterBreak);
    }
  }
  return totals;
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

function minimumTeachersAtPeriodOne(input, day) {
  const groupsByYear = new Map();
  for (const group of input.groups) {
    const groups = groupsByYear.get(group.year) ?? [];
    groups.push(group);
    groupsByYear.set(group.year, groups);
  }
  let needed = 0;
  for (const [year, groups] of groupsByYear) {
    const fixedGeneral = input.courses.some((course) =>
      course.year === year && course.category === "general" && course.kind === "theory" &&
      course.fixed?.day === day && course.fixed.start === 1 && course.fixed.end >= 1);
    if (fixedGeneral) continue;
    const fixedShared = input.courses.some((course) =>
      course.year === year && course.category !== "general" && course.kind === "theory" &&
      course.fixed?.day === day && course.fixed.start === 1 && course.fixed.end >= 1);
    const movableShared = input.courses.some((course) =>
      course.year === year && course.category !== "general" && course.kind === "theory" &&
      !course.fixed && course.periods <= Math.max(...input.time.breakPeriods) - 1);
    needed += fixedShared || movableShared ? 1 : groups.length;
  }
  const available = input.teachers.filter((teacher) =>
    isOff(input, "teachers", "unavailable") ||
    !unavailableAt(teacher.unavailable ?? [], day, 1)).length;
  return { needed, available };
}

function canReachWeekEnd(input, group, nextDay, fixedTasks, placements) {
  const totalNeeded = input.courses
    .filter((course) => course.year === group.year)
    .reduce((sum, course) => sum + course.periods, 0);
  const completedFixed = fixedTasks.filter((task) => task.fixed.day < nextDay);
  const placed = [...completedFixed, ...placements]
    .filter((task) => task.groupIds.includes(group.id))
    .reduce((sum, task) => sum + (task.periods ?? task.end - task.start + 1), 0);
  const remaining = totalNeeded - placed;
  const daysLeft = input.time.days.length - nextDay;
  const limit = input.time.finishLimits.find((entry) => entry.year === group.year)?.lastPeriod ??
    input.time.periodsPerDay;
  return possibleWeekTotals(possibleDayTotals(limit, input.time.breakPeriods), daysLeft)
    .has(remaining);
}

function canCompleteFromState(input, group, state, fixedTasks, placements) {
  const totalNeeded = input.courses
    .filter((course) => course.year === group.year)
    .reduce((sum, course) => sum + course.periods, 0);
  const completedFixed = fixedTasks.filter((task) =>
    task.groupIds.includes(group.id) &&
    (task.fixed.day < state.day ||
      (task.fixed.day === state.day && task.fixed.end < state.period)));
  const completedMovable = placements.filter((lesson) => lesson.groupIds.includes(group.id));
  const completed = [...completedFixed, ...completedMovable]
    .reduce((sum, task) => sum + (task.periods ?? task.end - task.start + 1), 0);
  const remaining = totalNeeded - completed;
  const finishLimit = input.time.finishLimits.find((limit) => limit.year === group.year)?.lastPeriod ??
    input.time.periodsPerDay;
  const lastBreak = Math.max(...input.time.breakPeriods);
  const daysAfterToday = input.time.days.length - state.day - 1;
  const minFuture = daysAfterToday * (lastBreak - 1);
  const maxFuture = daysAfterToday * (finishLimit - 1);

  let minToday;
  let maxToday;
  if (state.breakTaken) {
    minToday = Math.max(0, lastBreak - state.period + 1);
    maxToday = Math.max(0, finishLimit - state.period + 1);
  } else {
    const availableBreak = input.time.breakPeriods.some((period) =>
      period >= state.period &&
      !fixedTasks.some((task) =>
        task.groupIds.includes(group.id) &&
        task.fixed.day === state.day &&
        task.fixed.start <= period && task.fixed.end >= period));
    if (!availableBreak || state.period > lastBreak) return false;
    minToday = lastBreak - state.period;
    maxToday = Math.max(0, finishLimit - state.period);
  }
  return remaining >= minToday + minFuture && remaining <= maxToday + maxFuture;
}

function taskHasPossibleSlot(input, task, states, groupIndexes, courses, fixedTasks, fixedLessons, placements) {
  const course = courses.get(task.courseId);
  const finishLimit = input.time.finishLimits.find((limit) => limit.year === course.year)?.lastPeriod ??
    input.time.periodsPerDay;
  for (let day = 0; day < input.time.days.length; day += 1) {
    for (let start = 1; start + task.periods - 1 <= finishLimit; start += 1) {
      const end = start + task.periods - 1;
      let reachable = true;
      for (const id of task.groupIds) {
        const index = groupIndexes.get(id);
        const state = states[index];
        if (state.day > day || (state.day === day && start < state.period)) {
          reachable = false;
          break;
        }
        const breakPeriods = input.time.breakPeriods.filter((period) =>
          !fixedTasks.some((fixed) =>
            fixed.fixed.day === day &&
            fixed.groupIds.includes(id) &&
            fixed.fixed.start <= period && fixed.fixed.end >= period));
        if (state.day === day && state.breakTaken) {
          if (start <= state.breakPeriod && state.breakPeriod <= end) {
            reachable = false;
            break;
          }
        } else {
          const firstPossibleBreak = state.day === day ? state.period : 1;
          if (!breakPeriods.some((period) =>
            period >= firstPossibleBreak && (period < start || period > end))) {
            reachable = false;
            break;
          }
        }
      }
      if (!reachable) continue;

      const overlapsPlacedGroupLesson = [...fixedLessons, ...placements].some((lesson) =>
        lesson.day === day &&
        lesson.groupIds.some((id) => task.groupIds.includes(id)) &&
        start <= lesson.end && lesson.start <= end);
      if (overlapsPlacedGroupLesson) continue;

      if (lessonFits(input, task, day, start, courses, fixedLessons, placements, new Map())) {
        return true;
      }
    }
  }
  return false;
}

function interchangeableClassKey(task, course) {
  return JSON.stringify([
    [...task.groupIds].sort(),
    task.periods,
    task.roomType,
    course.teacherId ?? "",
    course.category,
  ]);
}

function resourceSignature(placements, courses) {
  return placements.map((lesson) => {
    const course = courses.get(lesson.courseId);
    const needsTeacher = course.category !== "general";
    const roomType = ["computer", "lab", "computerOrLab"].includes(course.roomType)
      ? course.roomType
      : "";
    return needsTeacher || roomType
      ? `${lesson.day}:${lesson.start}-${lesson.end}:${needsTeacher ? lesson.teacherId : ""}:${roomType}`
      : "";
  }).filter(Boolean).sort().join(";");
}

function teacherUnavailablePeriods(teacher) {
  return (teacher.unavailable ?? []).reduce((total, range) =>
    total + (range.end - range.start + 1), 0);
}

function lessonFits(input, task, day, start, courses, fixedLessons, placements, rejections) {
  const course = courses.get(task.courseId);
  const end = start + task.periods - 1;
  const finishLimit = input.time.finishLimits.find((limit) => limit.year === course.year)?.lastPeriod ??
    input.time.periodsPerDay;
  if (end > finishLimit || end > input.time.periodsPerDay) {
    incrementRejection(rejections, "H2");
    return false;
  }

  const groupIds = new Set(task.groupIds);
  if (fixedLessons.some((fixed) =>
    fixed.day === day &&
    fixed.groupIds.some((id) => groupIds.has(id)) &&
    start <= fixed.end && fixed.start <= end)) {
    incrementRejection(rejections, "H5");
    return false;
  }

  const candidate = scheduledLesson(task, day, start, course);
  const roomRulesOff = isOff(input, "rooms") || isOff(input, "courses", "roomType");
  for (let period = start; period <= end; period += 1) {
    const active = [...fixedLessons, ...placements].filter((lesson) =>
      lesson.day === day && lesson.start <= period && lesson.end >= period);
    if (course.category !== "general") {
      const teacher = input.teachers.find((item) => item.id === candidate.teacherId);
      if (teacher && !isOff(input, "teachers", "unavailable") &&
          unavailableAt(teacher.unavailable ?? [], day, period)) {
        incrementRejection(rejections, "H8");
        return false;
      }
      const teaching = active.filter((lesson) =>
        courses.get(lesson.courseId)?.category !== "general");
      if (teaching.some((lesson) =>
        lesson.teacherId && lesson.teacherId === candidate.teacherId)) {
        incrementRejection(rejections, "H7");
        return false;
      }
      const availableTeachers = input.teachers.filter((teacher) =>
        isOff(input, "teachers", "unavailable") ||
        !unavailableAt(teacher.unavailable ?? [], day, period));
      if (teaching.length + 1 > availableTeachers.length) {
        incrementRejection(rejections, "H7");
        return false;
      }
    }

    if (!roomRulesOff) {
      const roomType = course.roomType;
      if (roomType === "computer" || roomType === "lab" || roomType === "computerOrLab") {
        const roomLessons = active.filter((lesson) => {
          const type = courses.get(lesson.courseId)?.roomType;
          return type === "computer" || type === "lab" || type === "computerOrLab";
        });
        const counts = {
          computer: roomLessons.filter((lesson) => courses.get(lesson.courseId).roomType === "computer").length,
          lab: roomLessons.filter((lesson) => courses.get(lesson.courseId).roomType === "lab").length,
          flexible: roomLessons.filter((lesson) => courses.get(lesson.courseId).roomType === "computerOrLab").length,
        };
        counts[roomType === "computerOrLab" ? "flexible" : roomType] += 1;
        const availableComputers = input.rooms.filter((room) =>
          room.type === "computer" &&
          (isOff(input, "rooms", "unavailable") || !unavailableAt(room.unavailable ?? [], day, period)));
        const availableLabs = input.rooms.filter((room) =>
          room.type === "lab" &&
          (isOff(input, "rooms", "unavailable") || !unavailableAt(room.unavailable ?? [], day, period)));
        if (counts.computer > availableComputers.length ||
            counts.lab > availableLabs.length ||
            counts.computer + counts.lab + counts.flexible >
              availableComputers.length + availableLabs.length) {
          incrementRejection(rejections, "H9");
          return false;
        }
      }
    }
  }
  return true;
}

function searchPhaseOne(input) {
  const started = performance.now();
  const analysis = analyzeInput(input);
  const stats = { steps: 0, ms: 0, limitHit: "", rejections: [] };
  if (analysis.status !== "ok") {
    return {
      status: analysis.status === "invalidInput" ? "invalidInput" : "infeasible",
      lessons: [],
      analysis,
      stats: { ...stats, ms: performance.now() - started },
    };
  }

  const { lessons: tasks, conflicts } = createLessonsToPlace(input);
  if (conflicts.length) {
    return {
      status: "invalidInput",
      lessons: [],
      analysis,
      causes: conflicts,
      stats: { ...stats, ms: performance.now() - started },
    };
  }

  const courses = new Map(input.courses.map((course) => [course.id, course]));
  const fixedTasks = tasks.filter((task) => task.fixed);
  const movableTasks = tasks.filter((task) => !task.fixed);
  const classMembers = new Map();
  for (const task of movableTasks) {
    const key = interchangeableClassKey(task, courses.get(task.courseId));
    const members = classMembers.get(key) ?? [];
    members.push(task);
    classMembers.set(key, members);
  }
  for (const members of classMembers.values()) {
    members.sort((left, right) =>
      String(courses.get(left.courseId).code).localeCompare(String(courses.get(right.courseId).code)) ||
      left.id.localeCompare(right.id));
  }
  const fixedLessons = fixedTasks.map((task) => ({
    ...scheduledLesson(task, task.fixed.day, task.fixed.start, courses.get(task.courseId)),
  }));
  const rejections = new Map();
  const groupStates = input.groups.map(() =>
    ({ day: 0, period: 1, breakTaken: false, breakPeriod: null }));
  const groupIndexes = new Map(input.groups.map((group, index) => [group.id, index]));
  const placedTasks = new Set();
  const taskIndexes = new Map(movableTasks.map((task, index) => [task.id, index]));
  const deadStates = new Set();
  const maxMemoizedStates = 100000;
  let solution = null;

  function search(states, placements, placedMask) {
    stats.steps += 1;
    const stateKey = `${states.map((state) =>
      `${state.day},${state.period},${Number(state.breakTaken)},${state.breakPeriod ?? ""}`).join("|")}|${placedMask.toString(36)}|${resourceSignature(placements, courses)}`;
    if (deadStates.has(stateKey)) return false;
    for (let index = 0; index < states.length; index += 1) {
      const state = states[index];
      if (state.day < input.time.days.length &&
          !canCompleteFromState(input, input.groups[index], state, fixedTasks, placements)) {
        incrementRejection(rejections, "H2");
        if (deadStates.size < maxMemoizedStates) deadStates.add(stateKey);
        return false;
      }
    }
    for (const task of movableTasks) {
      if (placedTasks.has(task.id)) continue;
      if (!taskHasPossibleSlot(
        input,
        task,
        states,
        groupIndexes,
        courses,
        fixedTasks,
        fixedLessons,
        placements,
      )) {
        incrementRejection(rejections, "lookahead:noLegalSlot");
        if (deadStates.size < maxMemoizedStates) deadStates.add(stateKey);
        return false;
      }
    }
    if (states.every((state) => state.day >= input.time.days.length)) {
      if (placedTasks.size === movableTasks.length) solution = [...fixedLessons, ...placements];
      return solution !== null;
    }

    let groupIndex = -1;
    for (let index = 0; index < states.length; index += 1) {
      if (states[index].day >= input.time.days.length) continue;
      if (groupIndex === -1 ||
          states[index].day < states[groupIndex].day ||
          (states[index].day === states[groupIndex].day &&
           states[index].period < states[groupIndex].period)) {
        groupIndex = index;
      }
    }
    const state = states[groupIndex];
    const group = input.groups[groupIndex];
    const day = state.day;
    const period = state.period;
    const finishLimit = input.time.finishLimits.find((limit) => limit.year === group.year)?.lastPeriod ??
      input.time.periodsPerDay;

    if (period === 1) {
      const staffing = minimumTeachersAtPeriodOne(input, day);
      if (staffing.needed > staffing.available) {
        incrementRejection(rejections, "H7");
        return false;
      }
    }

    const fixedAtPeriod = fixedTasks.find((task) =>
      task.fixed.day === day &&
      task.fixed.start === period &&
      task.groupIds.includes(group.id));
    if (fixedAtPeriod) {
      if (!state.breakTaken &&
          !input.time.breakPeriods.some((breakPeriod) => breakPeriod > fixedAtPeriod.fixed.end)) {
        incrementRejection(rejections, "H2");
        if (deadStates.size < maxMemoizedStates) deadStates.add(stateKey);
        return false;
      }
      const indexes = fixedAtPeriod.groupIds.map((id) => groupIndexes.get(id));
      if (indexes.some((index) => index === undefined ||
          states[index].day !== day || states[index].period !== period)) {
        if (deadStates.size < maxMemoizedStates) deadStates.add(stateKey);
        return false;
      }
      const next = states.map((item) => ({ ...item }));
      for (const index of indexes) next[index].period = fixedAtPeriod.fixed.end + 1;
      const found = search(next, placements, placedMask);
      if (!found && deadStates.size < maxMemoizedStates) deadStates.add(stateKey);
      return found;
    }

    const candidates = movableTasks
      .filter((task) => !placedTasks.has(task.id) && task.groupIds.includes(group.id))
      .filter((task) => task.groupIds.every((id) => {
        const index = groupIndexes.get(id);
        return index !== undefined && states[index].day === day && states[index].period === period;
      }))
      .filter((task) => {
        const key = interchangeableClassKey(task, courses.get(task.courseId));
        return classMembers.get(key).find((member) => !placedTasks.has(member.id)) === task;
      })
      .sort((left, right) => {
        const leftCourse = courses.get(left.courseId);
        const rightCourse = courses.get(right.courseId);
        const leftRoomCount = left.roomType === "computer"
          ? input.rooms.filter((room) => room.type === "computer").length
          : left.roomType === "lab"
            ? input.rooms.filter((room) => room.type === "lab").length
            : left.roomType === "computerOrLab"
              ? input.rooms.filter((room) => room.type === "computer" || room.type === "lab").length
              : Number.POSITIVE_INFINITY;
        const rightRoomCount = right.roomType === "computer"
          ? input.rooms.filter((room) => room.type === "computer").length
          : right.roomType === "lab"
            ? input.rooms.filter((room) => room.type === "lab").length
            : right.roomType === "computerOrLab"
              ? input.rooms.filter((room) => room.type === "computer" || room.type === "lab").length
              : Number.POSITIVE_INFINITY;
        const leftTeacher = input.teachers.find((teacher) => teacher.id === leftCourse.teacherId);
        const rightTeacher = input.teachers.find((teacher) => teacher.id === rightCourse.teacherId);
        return Number(right.groupIds.length > 1) - Number(left.groupIds.length > 1) ||
          right.periods - left.periods ||
          leftRoomCount - rightRoomCount ||
          teacherUnavailablePeriods(rightTeacher ?? { unavailable: [] }) -
            teacherUnavailablePeriods(leftTeacher ?? { unavailable: [] }) ||
          String(leftCourse.code).localeCompare(String(rightCourse.code)) ||
          left.id.localeCompare(right.id);
      });

    for (const task of candidates) {
      const end = period + task.periods - 1;
      const lastBreak = Math.max(...input.time.breakPeriods);
      if (!state.breakTaken && end > lastBreak - 1) {
        incrementRejection(rejections, "H2");
        continue;
      }
      if (!lessonFits(input, task, day, period, courses, fixedLessons, placements, rejections)) continue;
      const next = states.map((item) => ({ ...item }));
      for (const id of task.groupIds) {
        next[groupIndexes.get(id)].period = end + 1;
      }
      placedTasks.add(task.id);
      const nextMask = placedMask | (1n << BigInt(taskIndexes.get(task.id)));
      if (search(next, [...placements, scheduledLesson(task, day, period, courses.get(task.courseId))], nextMask)) {
        return true;
      }
      placedTasks.delete(task.id);
    }

    if (!state.breakTaken && input.time.breakPeriods.includes(period) &&
        !fixedTasks.some((task) => task.fixed.day === day &&
          task.fixed.start <= period && task.fixed.end >= period &&
          task.groupIds.includes(group.id))) {
      const next = states.map((item) => ({ ...item }));
      next[groupIndex].period += 1;
      next[groupIndex].breakTaken = true;
      next[groupIndex].breakPeriod = period;
      if (search(next, placements, placedMask)) return true;
    }

    if (state.breakTaken && period >= Math.max(...input.time.breakPeriods) + 1) {
      const next = states.map((item) => ({ ...item }));
      next[groupIndex] = { day: day + 1, period: 1, breakTaken: false, breakPeriod: null };
      if (!canReachWeekEnd(input, group, day + 1, fixedTasks, placements)) {
        incrementRejection(rejections, "H2");
        if (deadStates.size < maxMemoizedStates) deadStates.add(stateKey);
        return false;
      }
      if (search(next, placements, placedMask)) return true;
    }

    if (period > finishLimit) incrementRejection(rejections, "H2");
    if (deadStates.size < maxMemoizedStates) deadStates.add(stateKey);
    return false;
  }

  const found = search(groupStates, [], 0n);
  stats.ms = performance.now() - started;
  stats.rejections = [...rejections].map(([constraint, count]) => ({ constraint, count }));
  if (!found) {
    return {
      status: "infeasible",
      lessons: [],
      analysis,
      causes: [{ layer: 3, message: "No timetable satisfies the phase-one time and capacity filters.", refs: [] }],
      stats,
    };
  }
  return { status: "feasible", lessons: solution, analysis, stats };
}

module.exports = { searchPhaseOne };
