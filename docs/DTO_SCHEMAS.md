# DTO SCHEMAS

## Ortak Zarf Yapısı
ToolRequestEnvelope: { tool, tool_input, session_context: { session_id, agent_key, request_id } }
ToolResponseEnvelope: { ok, data, meta: { source, fetched_at, request_id } }
ErrorResponseEnvelope: { ok: false, error: { code, message }, meta: { request_id } }

## Sistem Context DTO'ları
AuthContextDto: { user_id, role, school_id, actor_id, permissions }
SessionContextDto: { session_id, agent_key, request_id, conversation_mode, active_entities }
AiExecutionContextDto: { auth_context, session_context, tool, tool_input }

## Öğrenci DTO'ları
- StudentProfileDto: { student_id, full_name, grade_level, branch, school_number }
- ExamResultItemDto: { exam_id, exam_name, subject, score, max_score, exam_date }
- OutcomePerformanceDto: { outcome_code, outcome_name, success_rate, correct_count, wrong_count }
- AssignmentItemDto: { assignment_id, title, subject, status, due_date }
- StudyPlanItemDto: { day, task, duration_minutes }

## Öğretmen DTO'ları
- TeacherClassItemDto: { class_id, name, subject }
- ClassStudentItemDto: { student_id, full_name }
- PaginationDto: { page, limit, total }
- ClassExamResultItemDto: { student_id, student_name, exam_id, score }
- ClassOutcomePerformanceDto: { outcome_code, outcome_name, average_success_rate }
- GeneratedQuestionDto: { question_no, type, text, choices, answer }

## Veli DTO'ları
- ParentChildItemDto: { child_id, full_name, grade_level }
- ChildAttendanceSummaryDto: { child_id, summary: { absent_days, late_days } }
- ParentReportDto: { child_id, report: { overall_status, summary_text } }

## AI Session DTO'ları
- CreateAiSessionRequestDto: { agent_key, session_type, title }
- ChatMessageRequestDto: { session_id, message }
- ChatMessageResponseDto: { session_id, assistant_message, used_tools }

## Validation Kuralları
- limit: min 1, max 50
- page: min 1
- date_range.start <= date_range.end
- subject: whitelist
- difficulty: easy|medium|hard
- role: student|teacher|parent|admin
