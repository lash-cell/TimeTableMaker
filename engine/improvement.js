"use strict";

const { checkTimetable } = require("./checker");

const rounds = 100;
const lateAcceptanceWindow = 50;

function scoreTimetable(input, lessons) {
  const teacherById = new Map(input.teachers.map((teacher) => [teacher.id, teacher]));
  const teacherDays = new Map();
  const teacherLoads = new Map(input.teachers.map((teacher) => [teacher.id, 0]));
  for (const lesson of lessons) {
    if (!lesson.teacherId) continue;
    const key = `${lesson.teacherId}:${lesson.day}`;
    const periods = teacherDays.get(key) ?? [];
    for (let period = lesson.start; period <= lesson.end; period += 1) periods.push(period);
    teacherDays.set(key, periods);
    teacherLoads.set(
      lesson.teacherId,
      (teacherLoads.get(lesson.teacherId) ?? 0) + lesson.end - lesson.start + 1,
    );
  }

  let teacherIdlePeriods = 0;
  for (const periods of teacherDays.values()) {
    const first = Math.min(...periods);
    const last = Math.max(...periods);
    teacherIdlePeriods += last - first + 1 - new Set(periods).size;
  }

  let groupLateFinishPeriods = 0;
  for (const group of input.groups) {
    for (let day = 0; day < input.time.days.length; day += 1) {
      const dailyLessons = lessons.filter((lesson) =>
        lesson.day === day && lesson.groupIds.includes(group.id));
      groupLateFinishPeriods += dailyLessons.reduce((last, lesson) => Math.max(last, lesson.end), 0);
    }
  }

  let workloadDeviation = 0;
  for (const [teacherId, teacher] of teacherById) {
    const load = teacherLoads.get(teacherId) ?? 0;
    workloadDeviation += Math.abs(2 * load - teacher.minPeriods - teacher.maxPeriods);
  }

  const terms = {
    S1: teacherIdlePeriods,
    S2: groupLateFinishPeriods,
    S3: workloadDeviation,
  };
  return { total: terms.S1 + terms.S2 + terms.S3, terms };
}

function createRandom(seed) {
  let state = seed >>> 0;
  if (state === 0) state = 0x6d2b79f5;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function improveTimetable(
  input,
  lessons,
  seed = 1,
  deadline = Number.POSITIVE_INFINITY,
  signal,
) {
  const initialCheck = checkTimetable(input, lessons);
  if (initialCheck.violations.length) {
    const error = new Error(
      `Improvement requires a checker-valid initial timetable (${initialCheck.violations.length} violations)`,
    );
    error.violations = initialCheck.violations;
    throw error;
  }

  const courses = new Map(input.courses.map((course) => [course.id, course]));
  const eligible = lessons.filter((lesson) => {
    const course = courses.get(lesson.courseId);
    return course.category !== "general" && !course.teacherId && lesson.teacherId;
  });
  const random = createRandom(seed);
  let currentLessons = lessons.map((lesson) => ({ ...lesson, groupIds: [...lesson.groupIds] }));
  let currentScore = scoreTimetable(input, currentLessons);
  const initialTotal = currentScore.total;
  const history = [{
    round: 0,
    total: currentScore.total,
    terms: currentScore.terms,
  }];
  let movesTried = 0;
  let movesAccepted = 0;
  let movesRejected = 0;
  let roundsCompleted = 0;

  for (let round = 1; round <= rounds; round += 1) {
    if (signal?.aborted || performance.now() >= deadline) break;
    roundsCompleted = round;
    if (eligible.length) {
      const selected = eligible[Math.floor(random() * eligible.length)];
      const current = currentLessons.find((lesson) => lesson.id === selected.id);
      const alternatives = input.teachers.filter((teacher) => teacher.id !== current.teacherId);
      if (alternatives.length) {
        const teacher = alternatives[Math.floor(random() * alternatives.length)];
        const candidate = currentLessons.map((lesson) =>
          lesson.id === selected.id ? { ...lesson, teacherId: teacher.id } : lesson);
        movesTried += 1;
        const validation = checkTimetable(input, candidate);
        if (validation.violations.length) {
          movesRejected += 1;
        } else {
          const candidateScore = scoreTimetable(input, candidate);
          const previousScore = history[Math.max(0, round - lateAcceptanceWindow)]?.total ??
            currentScore.total;
          if (
            candidateScore.total <= currentScore.total ||
            (candidateScore.total <= previousScore && candidateScore.total <= initialTotal)
          ) {
            currentLessons = candidate;
            currentScore = candidateScore;
            movesAccepted += 1;
          }
        }
      }
    }
    history.push({
      round,
      total: currentScore.total,
      terms: currentScore.terms,
    });
  }

  return {
    lessons: currentLessons,
    scoreHistory: history,
    stats: {
      improvementRounds: roundsCompleted,
      movesTried,
      movesAccepted,
      movesRejected,
    },
  };
}

module.exports = { improveTimetable, scoreTimetable };
