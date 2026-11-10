"use strict";

function assertInput(input) {
  if (!input || !Array.isArray(input.groups) || !Array.isArray(input.courses) ||
      !input.time?.activitySlot || !Array.isArray(input.time.days)) {
    throw new TypeError("createLessonsToPlace requires input groups, courses, and time settings");
  }
}

function sameRange(left, right) {
  return left.day === right.day && left.start === right.start && left.end === right.end;
}

function createLessonsToPlace(input) {
  assertInput(input);
  const lessons = [];
  const conflicts = [];
  let nextId = 1;

  for (const course of input.courses) {
    const courseGroups = input.groups.filter((group) => group.year === course.year);
    if (courseGroups.length === 0) {
      conflicts.push({
        courseId: course.id,
        reason: "noGroupsForYear",
      });
      continue;
    }
    if (course.kind !== "theory" && course.kind !== "practical") {
      conflicts.push({
        courseId: course.id,
        reason: "unknownCourseKind",
      });
      continue;
    }

    let fixed = course.fixed ? { ...course.fixed } : null;
    if (course.category === "activity") {
      const activitySlot = input.time.activitySlot;
      if (fixed && !sameRange(fixed, activitySlot)) {
        conflicts.push({
          courseId: course.id,
          reason: "activitySlotConflictsWithCourseFixed",
          courseFixed: fixed,
          activitySlot: { ...activitySlot },
        });
      }
      fixed = { ...activitySlot };
    }

    const groupSets = course.kind === "theory"
      ? [courseGroups.map((group) => group.id)]
      : courseGroups.map((group) => [group.id]);

    for (const groupIds of groupSets) {
      lessons.push({
        id: `lesson-${nextId}`,
        courseId: course.id,
        groupIds,
        periods: course.periods,
        fixed: fixed ? { ...fixed } : null,
        teacherId: course.teacherId ?? "",
        roomType: course.roomType ?? "",
      });
      nextId += 1;
    }
  }

  return { lessons, conflicts };
}

module.exports = { createLessonsToPlace };
