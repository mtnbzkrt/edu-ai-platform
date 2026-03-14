const connector = require("../../school/connector/school-connector");

// ── TOOL DEFINITIONS ──
const TOOLS = {
  // Student tools
  get_self_profile: {
    roles: ["student"],
    handler: (input, auth) => {
      const profile = connector.getStudentProfile(auth.actor_id);
      return profile || null;
    }
  },
  get_self_exam_results: {
    roles: ["student"],
    handler: (input, auth) => {
      const items = connector.getStudentExamResults(auth.actor_id, input);
      return { student_id: auth.actor_id, items };
    }
  },
  get_self_outcome_breakdown: {
    roles: ["student"],
    handler: (input, auth) => {
      const outcomes = connector.getStudentOutcomeBreakdown(auth.actor_id, input);
      return { student_id: auth.actor_id, subject: input.subject, outcomes };
    }
  },
  get_self_assignments: {
    roles: ["student"],
    handler: (input, auth) => {
      const items = connector.getStudentAssignments(auth.actor_id, input);
      return { student_id: auth.actor_id, items };
    }
  },

  // Teacher tools
  list_teacher_classes: {
    roles: ["teacher"],
    handler: (input, auth) => {
      const classes = connector.listTeacherClasses(auth.actor_id);
      return { teacher_id: auth.actor_id, classes };
    }
  },
  list_class_students: {
    roles: ["teacher"],
    handler: (input, auth) => {
      if (!connector.isTeacherOfClass(auth.actor_id, input.class_id))
        throw { code: "ACCESS_DENIED", message: "Not your class" };
      return connector.listClassStudents(input.class_id, input);
    }
  },
  get_student_exam_results: {
    roles: ["teacher"],
    handler: (input, auth) => {
      if (!connector.isTeacherOfStudent(auth.actor_id, input.student_id))
        throw { code: "ACCESS_DENIED", message: "Student not in your classes" };
      const items = connector.getStudentExamResults(input.student_id, input);
      return { student_id: input.student_id, items };
    }
  },
  get_class_exam_results: {
    roles: ["teacher"],
    handler: (input, auth) => {
      if (!connector.isTeacherOfClass(auth.actor_id, input.class_id))
        throw { code: "ACCESS_DENIED", message: "Not your class" };
      const items = connector.getClassExamResults(input.class_id, input);
      return { class_id: input.class_id, items };
    }
  },
  get_class_outcome_breakdown: {
    roles: ["teacher"],
    handler: (input, auth) => {
      if (!connector.isTeacherOfClass(auth.actor_id, input.class_id))
        throw { code: "ACCESS_DENIED", message: "Not your class" };
      const outcomes = connector.getClassOutcomeBreakdown(input.class_id, input);
      return { class_id: input.class_id, subject: input.subject, outcomes };
    }
  },

  // Parent tools
  list_my_children: {
    roles: ["parent"],
    handler: (input, auth) => {
      const children = connector.listParentChildren(auth.actor_id);
      return { parent_id: auth.actor_id, children };
    }
  },
  get_child_exam_results: {
    roles: ["parent"],
    handler: (input, auth) => {
      if (!connector.isParentOfChild(auth.actor_id, input.child_id))
        throw { code: "ACCESS_DENIED", message: "Not your child" };
      const items = connector.getStudentExamResults(input.child_id, input);
      return { child_id: input.child_id, items };
    }
  },
  get_child_assignments: {
    roles: ["parent"],
    handler: (input, auth) => {
      if (!connector.isParentOfChild(auth.actor_id, input.child_id))
        throw { code: "ACCESS_DENIED", message: "Not your child" };
      const items = connector.getStudentAssignments(input.child_id, input);
      return { child_id: input.child_id, items };
    }
  },
  get_child_attendance: {
    roles: ["parent"],
    handler: (input, auth) => {
      if (!connector.isParentOfChild(auth.actor_id, input.child_id))
        throw { code: "ACCESS_DENIED", message: "Not your child" };
      const data = connector.getStudentAttendance(input.child_id, input);
      return { child_id: input.child_id, summary: data.summary };
    }
  },
};

function executeTool(toolName, input, auth) {
  const tool = TOOLS[toolName];
  if (!tool) throw { code: "NOT_FOUND", message: `Tool '${toolName}' not found` };
  if (!tool.roles.includes(auth.role) && auth.role !== "admin")
    throw { code: "FORBIDDEN", message: `Role '${auth.role}' cannot use tool '${toolName}'` };
  return tool.handler(input, auth);
}

function getToolsForRole(role) {
  return Object.entries(TOOLS)
    .filter(([_, t]) => t.roles.includes(role))
    .map(([name]) => name);
}

module.exports = { executeTool, getToolsForRole, TOOLS };
