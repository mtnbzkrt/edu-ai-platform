const db = require("./db");

class SchoolConnector {
  // ── STUDENT ──
  getStudentProfile(studentId) {
    return db.prepare(`SELECT s.id as student_id, u.full_name, s.grade_level, s.branch, s.school_number
      FROM students s JOIN users u ON s.user_id = u.id WHERE s.id = ?`).get(studentId);
  }

  getStudentExamResults(studentId, { subject, limit = 10, dateRange } = {}) {
    let sql = `SELECT er.id, er.exam_id, e.name as exam_name, e.subject, er.score, e.max_score, e.exam_date
      FROM exam_results er JOIN exams e ON er.exam_id = e.id WHERE er.student_id = ?`;
    const params = [studentId];
    if (subject) { sql += ` AND e.subject = ?`; params.push(subject); }
    if (dateRange?.start) { sql += ` AND e.exam_date >= ?`; params.push(dateRange.start); }
    if (dateRange?.end) { sql += ` AND e.exam_date <= ?`; params.push(dateRange.end); }
    sql += ` ORDER BY e.exam_date DESC LIMIT ?`;
    params.push(Math.min(limit, 50));
    return db.prepare(sql).all(...params);
  }

  getStudentOutcomeBreakdown(studentId, { subject, examIds } = {}) {
    let sql = `SELECT eor.exam_id, eor.outcome_id, o.code as outcome_code, o.name as outcome_name,
      eor.correct_count, eor.total_count, CAST(eor.correct_count AS REAL)/eor.total_count as success_rate
      FROM exam_outcome_results eor JOIN outcomes o ON eor.outcome_id = o.id WHERE eor.student_id = ?`;
    const params = [studentId];
    if (subject) { sql += ` AND o.subject = ?`; params.push(subject); }
    if (examIds?.length) { sql += ` AND eor.exam_id IN (${examIds.map(()=>"?").join(",")})`; params.push(...examIds); }
    return db.prepare(sql).all(...params);
  }

  getStudentAssignments(studentId, { status, limit = 20 } = {}) {
    let sql = `SELECT a.id as assignment_id, a.title, a.subject, asub.status, a.due_date, asub.score
      FROM assignment_submissions asub JOIN assignments a ON asub.assignment_id = a.id WHERE asub.student_id = ?`;
    const params = [studentId];
    if (status) { sql += ` AND asub.status = ?`; params.push(status); }
    sql += ` ORDER BY a.due_date DESC LIMIT ?`;
    params.push(Math.min(limit, 50));
    return db.prepare(sql).all(...params);
  }

  getStudentAttendance(studentId, { period } = {}) {
    let sql = `SELECT date, status FROM attendance WHERE student_id = ?`;
    const params = [studentId];
    if (period === "this_month") {
      const now = new Date();
      const start = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-01`;
      sql += ` AND date >= ?`;
      params.push(start);
    }
    sql += ` ORDER BY date DESC`;
    const rows = db.prepare(sql).all(...params);
    const summary = { absent_days: 0, late_days: 0, present_days: 0, excused_days: 0 };
    rows.forEach(r => {
      if (r.status === "absent") summary.absent_days++;
      else if (r.status === "late") summary.late_days++;
      else if (r.status === "present") summary.present_days++;
      else if (r.status === "excused") summary.excused_days++;
    });
    return { records: rows, summary };
  }

  // ── TEACHER ──
  listTeacherClasses(teacherId) {
    return db.prepare(`SELECT id as class_id, name, grade_level, branch, subject FROM classes WHERE teacher_id = ?`).all(teacherId);
  }

  listClassStudents(classId, { page = 1, limit = 30 } = {}) {
    const offset = (page - 1) * limit;
    const total = db.prepare(`SELECT COUNT(*) as cnt FROM class_students WHERE class_id = ?`).get(classId).cnt;
    const items = db.prepare(`SELECT s.id as student_id, u.full_name FROM class_students cs
      JOIN students s ON cs.student_id = s.id JOIN users u ON s.user_id = u.id
      WHERE cs.class_id = ? LIMIT ? OFFSET ?`).all(classId, Math.min(limit, 50), offset);
    return { items, pagination: { page, limit, total } };
  }

  isTeacherOfClass(teacherId, classId) {
    return !!db.prepare(`SELECT 1 FROM classes WHERE id = ? AND teacher_id = ?`).get(classId, teacherId);
  }

  isTeacherOfStudent(teacherId, studentId) {
    return !!db.prepare(`SELECT 1 FROM class_students cs JOIN classes c ON cs.class_id = c.id
      WHERE cs.student_id = ? AND c.teacher_id = ?`).get(studentId, teacherId);
  }

  getClassExamResults(classId, { subject, examId, limit = 50 } = {}) {
    let sql = `SELECT er.student_id, u.full_name as student_name, er.exam_id, e.name as exam_name, er.score, e.exam_date
      FROM exam_results er JOIN exams e ON er.exam_id = e.id
      JOIN students s ON er.student_id = s.id JOIN users u ON s.user_id = u.id
      WHERE e.class_id = ?`;
    const params = [classId];
    if (subject) { sql += ` AND e.subject = ?`; params.push(subject); }
    if (examId) { sql += ` AND e.exam_id = ?`; params.push(examId); }
    sql += ` ORDER BY e.exam_date DESC, er.score DESC LIMIT ?`;
    params.push(Math.min(limit, 100));
    return db.prepare(sql).all(...params);
  }

  getClassOutcomeBreakdown(classId, { subject, examId } = {}) {
    let sql = `SELECT o.code as outcome_code, o.name as outcome_name,
      AVG(CAST(eor.correct_count AS REAL)/eor.total_count) as average_success_rate,
      COUNT(DISTINCT eor.student_id) as student_count
      FROM exam_outcome_results eor JOIN outcomes o ON eor.outcome_id = o.id
      JOIN exams e ON eor.exam_id = e.id WHERE e.class_id = ?`;
    const params = [classId];
    if (subject) { sql += ` AND o.subject = ?`; params.push(subject); }
    if (examId) { sql += ` AND eor.exam_id = ?`; params.push(examId); }
    sql += ` GROUP BY o.id ORDER BY average_success_rate ASC`;
    return db.prepare(sql).all(...params);
  }

  // ── PARENT ──
  listParentChildren(parentId) {
    return db.prepare(`SELECT s.id as child_id, u.full_name, s.grade_level, s.branch
      FROM parent_children pc JOIN students s ON pc.student_id = s.id
      JOIN users u ON s.user_id = u.id WHERE pc.parent_id = ?`).all(parentId);
  }

  isParentOfChild(parentId, childId) {
    return !!db.prepare(`SELECT 1 FROM parent_children WHERE parent_id = ? AND student_id = ?`).get(parentId, childId);
  }

  // ── ACTOR RESOLUTION ──
  getActorId(userId, role) {
    if (role === "student") return db.prepare(`SELECT id FROM students WHERE user_id = ?`).get(userId)?.id;
    if (role === "teacher") return db.prepare(`SELECT id FROM teachers WHERE user_id = ?`).get(userId)?.id;
    if (role === "parent") return db.prepare(`SELECT id FROM parents WHERE user_id = ?`).get(userId)?.id;
    return null;
  }

  getUserByUsername(username) {
    return db.prepare(`SELECT * FROM users WHERE username = ?`).get(username);
  }

  getPermissions(role) {
    const perms = {
      student: ["student.self.read","student.self.assignments.read","student.self.plan.write"],
      teacher: ["teacher.classes.read","teacher.students.read","teacher.exams.read","teacher.content.write"],
      parent: ["parent.children.read","parent.children.exams.read","parent.children.attendance.read"],
      admin: ["admin.all"]
    };
    return perms[role] || [];
  }
}

module.exports = new SchoolConnector();
