# TOOLS.md

## Primary Tool Responsibilities
- list_teacher_classes
- list_class_students
- list_my_children
- get_self_profile
- get_student_profile
- get_self_exam_results
- get_student_exam_results
- get_class_exam_results
- get_self_assignments
- get_child_assignments
- get_child_attendance
- get_class_outcome_breakdown
- get_student_outcome_breakdown

## Tool Usage Rules
- Always prefer the least expensive tool path.
- Apply filters: subject, class_id, student_id, exam_id, date_range, limit, page.
- Never request "all data" unless explicitly approved by orchestrator and technically safe.
- If a teacher has many students, retrieve roster pages first and drill into relevant subsets.
- If a student has many exams, start with a limited recent window.

## Permission Rules
- Student requests resolve self identity from auth/session context.
- Teacher requests may include student_id/class_id but must be backend-validated.
- Parent requests may include child_id but must be ownership-validated.
