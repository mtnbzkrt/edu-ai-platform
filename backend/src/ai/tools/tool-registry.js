/**
 * Tool Registry - Routes tool calls through auth/scope validation
 * All tools go through SchoolConnector
 */

const SchoolConnector = require("../../school/connector/school-connector");
const { logToolCall } = require("../audit/audit-logger");
const path = require("path");

const connector = new SchoolConnector(
  path.join(__dirname, "../../data/school.db")
);

// ── TOOL DEFINITIONS ──
const TOOL_HANDLERS = {
  // Student tools
  get_self_profile: {
    roles: ["student"],
    handler: (input, auth) => {
      return connector.getStudentProfile(auth.actor_id);
    }
  },

  get_self_exam_results: {
    roles: ["student"],
    handler: (input, auth) => {
      return connector.getStudentExamResults(auth.actor_id, {
        subject: input.subject,
        limit: input.limit,
        dateRange: input.date_range
      });
    }
  },

  get_self_outcome_breakdown: {
    roles: ["student"],
    handler: (input, auth) => {
      return connector.getStudentOutcomeBreakdown(auth.actor_id, {
        subject: input.subject,
        examIds: input.exam_ids || input.examIds
      });
    }
  },

  get_self_assignments: {
    roles: ["student"],
    handler: (input, auth) => {
      return connector.getStudentAssignments(auth.actor_id, {
        status: input.status,
        limit: input.limit
      });
    }
  },

  create_self_study_plan: {
    roles: ["student"],
    handler: (input, auth) => {
      // AI-generated study plan - returns structured plan
      return {
        student_id: auth.actor_id,
        plan: generateStudyPlan(input)
      };
    }
  },

  // Teacher tools
  list_teacher_classes: {
    roles: ["teacher"],
    handler: (input, auth) => {
      return connector.listTeacherClasses(auth.actor_id);
    }
  },

  list_class_students: {
    roles: ["teacher"],
    handler: (input, auth) => {
      if (!connector.isTeacherOfClass(auth.actor_id, input.class_id)) {
        throw { code: "ACCESS_DENIED", message: "Bu sınıfa erişim yetkiniz yok." };
      }
      return connector.listClassStudents(input.class_id, {
        page: input.page,
        limit: input.limit
      });
    }
  },

  get_student_exam_results: {
    roles: ["teacher"],
    handler: (input, auth) => {
      if (!connector.isTeacherOfStudent(auth.actor_id, input.student_id)) {
        throw { code: "ACCESS_DENIED", message: "Bu öğrenciye erişim yetkiniz yok." };
      }
      return connector.getStudentExamResults(input.student_id, {
        subject: input.subject,
        limit: input.limit,
        dateRange: input.date_range
      });
    }
  },

  get_class_exam_results: {
    roles: ["teacher"],
    handler: (input, auth) => {
      if (!connector.isTeacherOfClass(auth.actor_id, input.class_id)) {
        throw { code: "ACCESS_DENIED", message: "Bu sınıfa erişim yetkiniz yok." };
      }
      return connector.getClassExamResults(input.class_id, {
        subject: input.subject,
        examId: input.exam_id,
        limit: input.limit
      });
    }
  },

  get_class_outcome_breakdown: {
    roles: ["teacher"],
    handler: (input, auth) => {
      if (!connector.isTeacherOfClass(auth.actor_id, input.class_id)) {
        throw { code: "ACCESS_DENIED", message: "Bu sınıfa erişim yetkiniz yok." };
      }
      return connector.getClassOutcomeBreakdown(input.class_id, {
        subject: input.subject,
        examId: input.exam_id
      });
    }
  },

  generate_exam: {
    roles: ["teacher"],
    handler: (input, auth) => {
      return {
        exam_title: `${input.grade_level}. Sınıf ${input.subject || "Matematik"} Deneme`,
        note: "Bu tool AI tarafından sınav içeriği üretmek için kullanılır.",
        params: input
      };
    }
  },

  generate_homework: {
    roles: ["teacher"],
    handler: (input, auth) => {
      return {
        title: `${input.subject || "Matematik"} Pekiştirme Ödevi`,
        note: "Bu tool AI tarafından ödev içeriği üretmek için kullanılır.",
        params: input
      };
    }
  },

  // Parent tools
  list_my_children: {
    roles: ["parent"],
    handler: (input, auth) => {
      return connector.listMyChildren(auth.actor_id);
    }
  },

  get_child_exam_results: {
    roles: ["parent"],
    handler: (input, auth) => {
      if (!connector.isParentOfChild(auth.actor_id, input.child_id)) {
        throw { code: "ACCESS_DENIED", message: "Bu çocuğun verisine erişim yetkiniz yok." };
      }
      return connector.getStudentExamResults(input.child_id, {
        subject: input.subject,
        limit: input.limit,
        dateRange: input.date_range
      });
    }
  },

  get_child_assignments: {
    roles: ["parent"],
    handler: (input, auth) => {
      if (!connector.isParentOfChild(auth.actor_id, input.child_id)) {
        throw { code: "ACCESS_DENIED", message: "Bu çocuğun verisine erişim yetkiniz yok." };
      }
      return connector.getStudentAssignments(input.child_id, {
        status: input.status,
        limit: input.limit
      });
    }
  },

  get_child_attendance: {
    roles: ["parent"],
    handler: (input, auth) => {
      if (!connector.isParentOfChild(auth.actor_id, input.child_id)) {
        throw { code: "ACCESS_DENIED", message: "Bu çocuğun verisine erişim yetkiniz yok." };
      }
      return connector.getChildAttendance(input.child_id, {
        period: input.period
      });
    }
  },

  generate_parent_report: {
    roles: ["parent"],
    handler: (input, auth) => {
      if (!connector.isParentOfChild(auth.actor_id, input.child_id)) {
        throw { code: "ACCESS_DENIED", message: "Bu çocuğun verisine erişim yetkiniz yok." };
      }
      // Aggregate data for report
      const exams = connector.getStudentExamResults(input.child_id, { limit: 5 });
      const attendance = connector.getChildAttendance(input.child_id, { period: input.period });
      const assignments = connector.getStudentAssignments(input.child_id, { limit: 5 });
      return {
        child_id: input.child_id,
        report: {
          exam_summary: exams,
          attendance_summary: attendance,
          assignment_summary: assignments,
          note: "Bu veri AI tarafından yorumlanarak veli raporu üretilecektir."
        }
      };
    }
  }
};

// ── STUDY PLAN GENERATOR ──
function generateStudyPlan(input) {
  const days = input.available_days || ["monday", "wednesday", "friday"];
  const mins = input.daily_minutes || 30;
  return days.map(day => ({
    day,
    task: `${input.subject || "Matematik"} - ${input.goal || "Genel tekrar"}`,
    duration_minutes: mins
  }));
}

// ── EXECUTOR ──
function executeTool(toolName, input, authContext) {
  const startTime = Date.now();
  const handler = TOOL_HANDLERS[toolName];

  if (!handler) {
    throw { code: "NOT_FOUND", message: `Tool bulunamadı: ${toolName}` };
  }

  // Role check
  if (!handler.roles.includes(authContext.role)) {
    throw { code: "FORBIDDEN", message: `${authContext.role} rolü ${toolName} tool'unu kullanamaz.` };
  }

  // Input validation
  if (input.limit && input.limit > 50) input.limit = 50;

  try {
    const result = handler.handler(input, authContext);
    const duration = Date.now() - startTime;

    logToolCall({
      tool: toolName,
      user_id: authContext.user_id,
      role: authContext.role,
      session_id: authContext.session_id,
      duration_ms: duration,
      success: true
    });

    return result;
  } catch (err) {
    const duration = Date.now() - startTime;
    logToolCall({
      tool: toolName,
      user_id: authContext.user_id,
      role: authContext.role,
      session_id: authContext.session_id,
      duration_ms: duration,
      success: false,
      error: err.code || "ERROR"
    });
    throw err;
  }
}

function getToolsForRole(role) {
  return Object.entries(TOOL_HANDLERS)
    .filter(([, h]) => h.roles.includes(role))
    .map(([name]) => name);
}

module.exports = { executeTool, getToolsForRole, TOOL_HANDLERS };
