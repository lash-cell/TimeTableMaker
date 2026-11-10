# Class Scheduling System Requirements

This document translates the scheduling guidance into implementation-oriented requirements. **MUST** denotes a mandatory constraint stated in the source guidance. **SHOULD** denotes a recommended system behavior where the source describes a capability or handling approach without making it a hard scheduling constraint.

## 1. Purpose

The system schedules classes using course, student-group, teacher, room, and time-slot data. It validates schedules for conflicts and constraints, reports infeasibility, and presents or exports schedules in the required views and formats.

## 2. Input Data

The system MUST support importing or configuring:

- **Courses:** course name, required number of periods, course type (theory or practical), student group(s), required day/period constraints, and required room type.
- **Teachers:** teacher name, position, maximum teaching load, and unavailable time slots.
- **Rooms:** room identifier, capacity, room type, and unavailable time slots.
- **Calendar:** teaching days and periods, including period start/end times where available.
- **Additional constraints:** competition or user-provided scheduling requirements.

## 3. Student Schedule Constraints

### 3.1 Teaching days and hours

- Classes MUST be scheduled Monday through Friday.
- Every student group MUST have classes on every weekday.
- Every student group MUST start classes in period 1.
- Vocational Certificate ( ปวช. ) Year 1 schedules MUST end no later than period 9 (17:30).
- Other year levels MUST end no later than period 11 (19:30).
- Each year level MUST have one hour of break scheduled in period 4, 5, or 6.
- A student group MUST NOT have a free period between classes, except for its scheduled break.

### 3.2 Grouping rules

- Theory courses MUST be scheduled jointly for the two groups, following the combined general-education grouping specified by the input data.
- Practical courses MUST be scheduled separately for groups 1 and 2.
- Activity and scout courses MUST be scheduled on Thursday in periods 6–7.

### 3.3 Course duration and continuity

- The scheduled number of periods for each course MUST equal its required number of periods.
- Each course's periods MUST be consecutive; the system MUST NOT split a course into separated time blocks.
- Course-specific day and period requirements MUST be honored.

## 4. Teacher Constraints

- A teacher MUST NOT teach more than one class in the same time slot.
- The system MUST NOT schedule a teacher during an unavailable time slot.
- Department heads and work-unit heads MUST have a teaching load of 24–28 hours.
- Department teachers MUST have a teaching load of 30–38 hours.
- General-education courses MUST NOT count toward the teaching load of department teachers.
- The system MUST NOT exceed an individual teacher's configured maximum teaching load.

## 5. Room Constraints

- The available computer rooms are COM1, COM2, COM3, and COM4.
- The available laboratories are LAB1 and LAB2.
- Courses MUST be assigned a room that matches their required room type.
- A room MUST NOT host more than one class in the same time slot.
- The system MUST NOT schedule a room during an unavailable time slot.
- General-education courses MUST use external classrooms that are not department rooms. External classrooms may be reused as allowed by the source guidance.

## 6. Conflict Validation and Infeasibility

The system MUST detect at least the following conflicts:

- A teacher assigned to overlapping classes.
- A room assigned to overlapping classes.
- A student or student group assigned to overlapping classes.
- A teacher or room assigned during an unavailable time slot.
- A course missing required periods or exceeding applicable teaching-load limits.
- A schedule violating time, break, day, group, room-type, or course-continuity constraints.

When a conflict is found, the system SHOULD identify the affected records and explain the reason. If the constraints cannot all be satisfied, the system SHOULD report the detected causes so the user can review the input data or constraints.

## 7. Outputs

The system MUST provide schedules that can be viewed by:

- Room
- Teacher
- Student or student group
- Course

The system MUST also support:

- Individual or group schedules for students in each department.
- A schedule validation result covering teacher, room, and student-group conflicts.
- PDF and Excel exports.
- A web or app interface through which students can look up their schedules.

## 8. Initial Acceptance Criteria

A generated schedule is valid when:

- Every course has its required number of periods and meets its course-specific constraints.
- No teacher, room, or student group has overlapping classes.
- Teacher and room unavailability is respected.
- Daily limits, breaks, first-period starts, weekday coverage, and teaching-day constraints are met.
- Room types are appropriate and course periods are consecutive.
- The schedule can be displayed and exported through the required outputs.

If the input constraints make a fully valid schedule impossible, the system SHOULD report the conflicting constraints and relevant causes rather than silently presenting the schedule as valid.

## 9. Source Notes and Assumptions

- The source specifies workload bands by teacher position and also calls for a per-teacher maximum. Implement both checks when the necessary teacher position and maximum-load data are available.
- The source says student schedules should include a break and separately states that there must be no gaps except the break. The system should treat the selected break period as the permitted gap.
- The source describes theory as combined across two groups and practical courses as split into groups 1 and 2. The exact group mapping should come from the course or student-group input data.
- The source does not define period lengths beyond the stated daily end times. Period start/end times should therefore be configurable rather than inferred.
