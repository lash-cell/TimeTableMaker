import json
import sys
import time

from ortools.sat.python import cp_model


EVENT_PREFIX = "TIMETABLEMAKER_EVENT "


def emit_event(event, **details):
    print(
        EVENT_PREFIX + json.dumps({"event": event, **details}, separators=(",", ":")),
        file=sys.stderr,
        flush=True,
    )


def is_off(problem, section, field=""):
    return any(
        item["section"] == section and item.get("field", "") in ("", field)
        for item in problem["off"]
    )


def unavailable(ranges, day, period):
    return any(
        item["day"] == day and item["start"] <= period <= item["end"]
        for item in ranges
    )


def room_types_for(course):
    if course["roomType"] == "computerOrLab":
        return {"computer", "lab"}
    return {course["roomType"]}


def solve(problem, time_limit_seconds, step_limit=None, relax=None):
    started = time.perf_counter()
    relax = relax or ""

    def stats(steps=0, limit_hit="", rejection_counts=None):
        return {
            "ms": (time.perf_counter() - started) * 1000,
            "steps": steps,
            "limitHit": limit_hit,
            "rejections": [
                {"constraint": name, "count": count}
                for name, count in sorted((rejection_counts or {}).items())
                if count
            ],
        }

    model = cp_model.CpModel()
    groups = {item["id"]: item for item in problem["groups"]}
    courses = {item["id"]: item for item in problem["courses"]}
    teachers = {item["id"]: item for item in problem["teachers"]}
    rooms = {item["id"]: item for item in problem["rooms"]}
    finish_limits = {
        item["year"]: item["lastPeriod"] for item in problem["time"]["finishLimits"]
    }

    rooms_off = is_off(problem, "rooms") or is_off(problem, "courses", "roomType") or relax == "rooms"
    room_availability_off = is_off(problem, "rooms", "unavailable") or rooms_off
    teacher_availability_off = (
        is_off(problem, "teachers", "unavailable")
        or is_off(problem, "teachers")
        or relax == "teacherAvailability"
    )
    teacher_workload_off = (
        is_off(problem, "teachers", "minPeriods")
        or is_off(problem, "teachers", "maxPeriods")
        or is_off(problem, "teachers")
        or relax == "workload"
    )

    tasks = []
    next_id = 1
    for course in problem["courses"]:
        course_groups = [group for group in problem["groups"] if group["year"] == course["year"]]
        if not course_groups:
            return {
                "status": "invalidInput",
                "lessons": [],
                "stats": stats(),
            }
        fixed = course.get("fixed")
        if course["category"] == "activity":
            fixed = problem["time"]["activitySlot"]
        elif relax == "fixed":
            fixed = None
        group_sets = (
            [[group["id"] for group in course_groups]]
            if course["kind"] == "theory"
            else [[group["id"]] for group in course_groups]
        )
        for group_ids in group_sets:
            tasks.append({
                "id": f"lesson-{next_id}",
                "course": course,
                "groupIds": group_ids,
                "periods": course["periods"],
                "fixed": fixed,
            })
            next_id += 1

    patterns = {}
    for group_id, group in groups.items():
        limit = finish_limits.get(group["year"], problem["time"]["periodsPerDay"])
        for day in range(len(problem["time"]["days"])):
            day_patterns = []
            for break_period in problem["time"]["breakPeriods"]:
                for last_period in range(1, limit + 1):
                    mask = {
                        period for period in range(1, last_period + 1)
                        if period != break_period
                    }
                    free_breaks = [
                        period for period in problem["time"]["breakPeriods"]
                        if period not in mask
                    ]
                    if len(free_breaks) != 1 or 1 not in mask:
                        continue
                    variable = model.NewBoolVar(
                        f"shape_g{group_id}_d{day}_b{break_period}_e{last_period}"
                    )
                    patterns.setdefault((group_id, day), []).append((mask, variable))
                    day_patterns.append(variable)
            if not day_patterns:
                return {
                    "status": "infeasible",
                    "lessons": [],
                    "stats": stats(),
                }
            model.AddExactlyOne(day_patterns)

    def candidate_patterns_allow(task, day, start, end):
        for group_id in task["groupIds"]:
            group_patterns = patterns.get((group_id, day), [])
            if not any(
                all(period in mask for period in range(start, end + 1))
                for mask, _ in group_patterns
            ):
                return False
        return True

    def required_room_type(course):
        return (
            not rooms_off
            and course["roomType"]
            and course["roomType"] != "general"
        )

    candidates = []
    candidates_by_task = [[] for _ in tasks]
    rejection_counts = {}

    def reject(constraint):
        rejection_counts[constraint] = rejection_counts.get(constraint, 0) + 1

    for task_index, task in enumerate(tasks):
        course = task["course"]
        limit = finish_limits.get(course["year"], problem["time"]["periodsPerDay"])
        if task["fixed"]:
            day_starts = [(task["fixed"]["day"], task["fixed"]["start"])]
        else:
            day_starts = [
                (day, start)
                for day in range(len(problem["time"]["days"]))
                for start in range(1, limit - task["periods"] + 2)
            ]

        if course["category"] == "general":
            teacher_choices = [""]
        elif course.get("teacherId") and relax != "givenTeachers":
            teacher_choices = [course["teacherId"]] if course["teacherId"] in teachers else []
        else:
            teacher_choices = list(teachers)

        if required_room_type(course):
            acceptable_types = room_types_for(course)
            room_choices = [
                room["id"] for room in problem["rooms"]
                if room["type"] in acceptable_types
            ]
        else:
            room_choices = [""]

        for day, start in day_starts:
            end = task["fixed"]["end"] if task["fixed"] else start + task["periods"] - 1
            if end - start + 1 != task["periods"] or end > limit:
                reject("fixedSlot")
                continue
            if not candidate_patterns_allow(task, day, start, end):
                reject("groupDayShape")
                continue
            for teacher_id in teacher_choices:
                teacher = teachers.get(teacher_id)
                if teacher and not teacher_availability_off and any(
                    unavailable(teacher.get("unavailable", []), day, period)
                    for period in range(start, end + 1)
                ):
                    reject("teacherAvailability")
                    continue
                for room_id in room_choices:
                    room = rooms.get(room_id)
                    if room and not room_availability_off and any(
                        unavailable(room.get("unavailable", []), day, period)
                        for period in range(start, end + 1)
                    ):
                        reject("roomAvailability")
                        continue
                    variable = model.NewBoolVar(
                        f"x_t{task_index}_d{day}_s{start}_teacher{teacher_id or 'none'}_room{room_id or 'none'}"
                    )
                    candidate = {
                        "taskIndex": task_index,
                        "task": task,
                        "day": day,
                        "start": start,
                        "end": end,
                        "teacherId": teacher_id,
                        "roomId": room_id,
                        "variable": variable,
                    }
                    candidates.append(candidate)
                    candidates_by_task[task_index].append(candidate)

        if not candidates_by_task[task_index]:
            return {
                "status": "infeasible",
                "lessons": [],
                "stats": stats(rejection_counts=rejection_counts),
            }
        model.AddExactlyOne([item["variable"] for item in candidates_by_task[task_index]])

    for group_id in groups:
        for day in range(len(problem["time"]["days"])):
            for period in range(1, problem["time"]["periodsPerDay"] + 1):
                occupying = [
                    item["variable"] for item in candidates
                    if item["day"] == day
                    and period in range(item["start"], item["end"] + 1)
                    and group_id in item["task"]["groupIds"]
                ]
                active_shapes = [
                    variable for mask, variable in patterns[(group_id, day)]
                    if period in mask
                ]
                model.Add(sum(occupying) == sum(active_shapes))

    for teacher_id in teachers:
        for day in range(len(problem["time"]["days"])):
            for period in range(1, problem["time"]["periodsPerDay"] + 1):
                scheduled = [
                    item["variable"] for item in candidates
                    if item["teacherId"] == teacher_id
                    and item["day"] == day
                    and item["start"] <= period <= item["end"]
                ]
                if scheduled:
                    model.AddAtMostOne(scheduled)

    if not rooms_off:
        for room_id in rooms:
            for day in range(len(problem["time"]["days"])):
                for period in range(1, problem["time"]["periodsPerDay"] + 1):
                    scheduled = [
                        item["variable"] for item in candidates
                        if item["roomId"] == room_id
                        and item["day"] == day
                        and item["start"] <= period <= item["end"]
                    ]
                    if scheduled:
                        model.AddAtMostOne(scheduled)

    if not teacher_workload_off:
        for teacher_id, teacher in teachers.items():
            workload = [
                item["task"]["periods"] * item["variable"]
                for item in candidates if item["teacherId"] == teacher_id
            ]
            model.Add(sum(workload) >= teacher["minPeriods"])
            model.Add(sum(workload) <= teacher["maxPeriods"])

    emit_event(
        "model_built",
        tasks=len(tasks),
        candidates=len(candidates),
        variables=len(model.Proto().variables),
        constraints=len(model.Proto().constraints),
        rejections=dict(sorted(rejection_counts.items())),
    )

    solver = cp_model.CpSolver()
    remaining_seconds = time_limit_seconds - (time.perf_counter() - started)
    if remaining_seconds <= 0:
        return {
            "status": "searchLimit",
            "lessons": [],
            "stats": {
                "ms": (time.perf_counter() - started) * 1000,
                "steps": 0,
                "limitHit": "time",
                "rejections": [],
                "solverStatus": "NOT_STARTED",
            },
        }
    solver.parameters.max_time_in_seconds = remaining_seconds
    solver.parameters.num_search_workers = 1
    solver.parameters.random_seed = 0
    if step_limit is not None:
        solver.parameters.max_number_of_conflicts = step_limit

    class SearchProgress(cp_model.CpSolverSolutionCallback):
        def __init__(self):
            super().__init__()
            self.solutions = 0
            self.last_event = time.perf_counter()

        def on_solution_callback(self):
            self.solutions += 1
            now = time.perf_counter()
            if self.solutions == 1 or self.solutions % 10 == 0 or now - self.last_event >= 2:
                emit_event(
                    "solution_found",
                    solutions=self.solutions,
                    wall_time_seconds=self.WallTime(),
                    branches=self.NumBranches(),
                    conflicts=self.NumConflicts(),
                )
                self.last_event = now

    callback = SearchProgress()
    emit_event(
        "search_started",
        time_limit_seconds=remaining_seconds,
        step_limit=step_limit,
    )
    status = solver.Solve(model, callback)
    status_names = {
        cp_model.OPTIMAL: "feasible",
        cp_model.FEASIBLE: "feasible",
        cp_model.INFEASIBLE: "infeasible",
        cp_model.MODEL_INVALID: "invalidModel",
        cp_model.UNKNOWN: "searchLimit",
    }
    result_status = status_names.get(status, "unknown")
    elapsed_ms = (time.perf_counter() - started) * 1000
    if status == cp_model.UNKNOWN:
        time_limit_hit = elapsed_ms >= time_limit_seconds * 1000 * 0.9
        limit_hit = "time" if time_limit_hit else "steps" if step_limit is not None else "time"
    else:
        limit_hit = ""
    result_stats = {
        **stats(solver.NumConflicts(), limit_hit, rejection_counts),
        "ms": elapsed_ms,
        "wallTimeSeconds": solver.WallTime(),
        "branches": solver.NumBranches(),
        "conflicts": solver.NumConflicts(),
        "variables": len(model.Proto().variables),
        "constraints": len(model.Proto().constraints),
        "solverStatus": solver.StatusName(status),
    }
    if result_status != "feasible":
        return {"status": result_status, "lessons": [], "stats": result_stats}

    lessons = []
    for item in candidates:
        if not solver.BooleanValue(item["variable"]):
            continue
        task = item["task"]
        lessons.append({
            "id": task["id"],
            "courseId": task["course"]["id"],
            "groupIds": task["groupIds"],
            "day": item["day"],
            "start": item["start"],
            "end": item["end"],
            "teacherId": item["teacherId"],
            "roomId": item["roomId"],
        })
    return {"status": result_status, "lessons": lessons, "stats": result_stats}


def main():
    request = json.load(sys.stdin)
    result = solve(
        request["input"],
        request.get("timeLimitSeconds", 10),
        request.get("stepLimit"),
        request.get("relax"),
    )
    json.dump(result, sys.stdout, separators=(",", ":"))


if __name__ == "__main__":
    main()
