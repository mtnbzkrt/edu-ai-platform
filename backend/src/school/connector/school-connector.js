/**
 * SchoolConnectorInterface - Abstraction for school data access
 * Mock implementation with realistic demo data
 */

const Database = require("better-sqlite3");
const path = require("path");

class SchoolConnector {
  constructor(dbPath) {
    this.db = new Database(dbPath || path.join(__dirname, "../../data/school.db"));
  }

  // ── STUDENT TOOLS ──

  getStudentProfile(studentId) {
    const row = this.db.prepare(`
      SELECT s.id, u.full_name, s.grade_level, s.branch, s.school_number
      FROM students s JOIN users u ON u.id = s.user_id WHERE s.id = ?
    `).get(studentId);
    if (!row) return null;
    return {
      student_id: row.id,
      full_name: row.full_name,
      grade_level: row.grade_level,
      branch: row.branch,
      school_number: row.school_number
    };
  }

  getStudentExamResults(studentId, { subject, limit = 5, dateRange } = {}) {
    let sql = `
      SELECT er.id, er.exam_id, e.name as exam_name, e.subject, er.score, e.max_score, e.exam_date
      FROM exam_results er
      JOIN exams e ON e.id = er.exam_id
      WHERE er.student_id = ?
    `;
    const params = [studentId];
    if (subject) { sql += " AND e.subject = ?"; params.push(subject); }
    if (dateRange?.start) { sql += " AND e.exam_date >= ?"; params.push(dateRange.start); }
    if (dateRange?.end) { sql += " AND e.exam_date <= ?"; params.push(dateRange.end); }
    sql += " ORDER BY e.exam_date DESC LIMIT ?";
    params.push(Math.min(limit, 50));

    const rows = this.db.prepare(sql).all(...params);
    return {
      student_id: studentId,
      items: rows.map(r => ({
        exam_id: r.exam_id,
        exam_name: r.exam_name,
        subject: r.subject,
        score: r.score,
        max_score: r.max_score || 100,
        exam_date: r.exam_date
      }))
    };
  }

  getStudentOutcomeBreakdown(studentId, { subject, examIds } = {}) {
    let sql = `
      SELECT o.code as outcome_code, o.name as outcome_name,
             ROUND(AVG(CAST(eor.correct_count AS REAL) / MAX(eor.total_count, 1)), 2) as success_rate,
             SUM(eor.correct_count) as correct_count,
             SUM(eor.total_count - eor.correct_count) as wrong_count
      FROM exam_outcome_results eor
      JOIN outcomes o ON o.id = eor.outcome_id
      WHERE eor.student_id = ?
    `;
    const params = [studentId];
    if (examIds?.length) {
      sql += ` AND eor.exam_id IN (${examIds.map(() => '?').join(',')})`;
      params.push(...examIds);
    }
    if (subject) {
      sql += " AND o.subject = ?";
      params.push(subject);
    }
    sql += " GROUP BY o.id ORDER BY success_rate ASC";

    const rows = this.db.prepare(sql).all(...params);
    return {
      student_id: studentId,
      subject: subject || "all",
      outcomes: rows.map(r => ({
        outcome_code: r.outcome_code,
        outcome_name: r.outcome_name,
        success_rate: r.success_rate,
        correct_count: r.correct_count,
        wrong_count: r.wrong_count
      }))
    };
  }

  getStudentAssignments(studentId, { status, limit = 10 } = {}) {
    let sql = `
      SELECT a.id as assignment_id, a.title, a.subject, sub.status, a.due_date
      FROM assignments a
      LEFT JOIN assignment_submissions sub ON sub.assignment_id = a.id AND sub.student_id = ?
      JOIN classes c ON c.id = a.class_id
      JOIN class_students cs ON cs.class_id = c.id AND cs.student_id = ?
    `;
    const params = [studentId, studentId];
    if (status) {
      if (status === 'pending') {
        sql += " AND (sub.status IS NULL OR sub.status = 'pending')";
      } else {
        sql += " AND sub.status = ?";
        params.push(status);
      }
    }
    sql += " ORDER BY a.due_date DESC LIMIT ?";
    params.push(Math.min(limit, 50));

    const rows = this.db.prepare(sql).all(...params);
    return {
      student_id: studentId,
      items: rows.map(r => ({
        assignment_id: r.assignment_id,
        title: r.title,
        subject: r.subject,
        status: r.status || "pending",
        due_date: r.due_date
      }))
    };
  }

  // ── TEACHER TOOLS ──

  listTeacherClasses(teacherId) {
    const rows = this.db.prepare(`
      SELECT c.id as class_id, c.name, c.subject
      FROM classes c WHERE c.teacher_id = ?
    `).all(teacherId);
    return {
      teacher_id: teacherId,
      classes: rows.map(r => ({
        class_id: r.class_id,
        name: r.name,
        subject: r.subject
      }))
    };
  }

  listClassStudents(classId, { page = 1, limit = 30 } = {}) {
    const offset = (page - 1) * limit;
    const total = this.db.prepare(
      "SELECT COUNT(*) as cnt FROM class_students WHERE class_id = ?"
    ).get(classId)?.cnt || 0;

    const rows = this.db.prepare(`
      SELECT s.id as student_id, u.full_name
      FROM class_students cs
      JOIN students s ON s.id = cs.student_id
      JOIN users u ON u.id = s.user_id
      WHERE cs.class_id = ?
      ORDER BY s.full_name LIMIT ? OFFSET ?
    `).all(classId, Math.min(limit, 50), offset);

    return {
      class_id: classId,
      items: rows.map(r => ({ student_id: r.student_id, full_name: r.full_name })),
      pagination: { page, limit, total }
    };
  }

  getClassExamResults(classId, { subject, examId, limit = 50 } = {}) {
    let sql = `
      SELECT er.student_id, u.full_name as student_name, er.exam_id, er.score, e.subject
      FROM exam_results er
      JOIN students s ON s.id = er.student_id
      JOIN users u ON u.id = s.user_id
      JOIN exams e ON e.id = er.exam_id
      JOIN class_students cs ON cs.student_id = er.student_id AND cs.class_id = ?
    `;
    const params = [classId];
    if (subject) { sql += " AND e.subject = ?"; params.push(subject); }
    if (examId) { sql += " AND er.exam_id = ?"; params.push(examId); }
    sql += " ORDER BY er.score DESC LIMIT ?";
    params.push(Math.min(limit, 100));

    const rows = this.db.prepare(sql).all(...params);
    return {
      class_id: classId,
      items: rows.map(r => ({
        student_id: r.student_id,
        student_name: r.student_name,
        exam_id: r.exam_id,
        score: r.score
      }))
    };
  }

  getClassOutcomeBreakdown(classId, { subject, examId } = {}) {
    let sql = `
      SELECT o.code as outcome_code, o.name as outcome_name,
             ROUND(AVG(CAST(eor.correct_count AS REAL) / MAX(eor.total_count, 1)), 2) as average_success_rate
      FROM exam_outcome_results eor
      JOIN outcomes o ON o.id = eor.outcome_id
      JOIN class_students cs ON cs.student_id = eor.student_id AND cs.class_id = ?
    `;
    const params = [classId];
    if (examId) { sql += " AND eor.exam_id = ?"; params.push(examId); }
    if (subject) { sql += " AND o.subject = ?"; params.push(subject); }
    sql += " GROUP BY o.id ORDER BY average_success_rate ASC";

    const rows = this.db.prepare(sql).all(...params);
    return {
      class_id: classId,
      subject: subject || "all",
      outcomes: rows.map(r => ({
        outcome_code: r.outcome_code,
        outcome_name: r.outcome_name,
        average_success_rate: r.average_success_rate
      }))
    };
  }

  // ── PARENT TOOLS ──

  listMyChildren(parentId) {
    const rows = this.db.prepare(`
      SELECT s.id as child_id, u.full_name, s.grade_level
      FROM parent_children psl
      JOIN students s ON s.id = psl.student_id
      JOIN users u ON u.id = s.user_id
      WHERE psl.parent_id = ?
    `).all(parentId);
    return {
      parent_id: parentId,
      children: rows.map(r => ({
        child_id: r.child_id,
        full_name: r.full_name,
        grade_level: r.grade_level
      }))
    };
  }

  getChildAttendance(childId, { period = "this_month" } = {}) {
    let startDate;
    const now = new Date();
    if (period === "this_week") {
      const d = new Date(now);
      d.setDate(d.getDate() - d.getDay());
      startDate = d.toISOString().slice(0, 10);
    } else if (period === "last_month") {
      const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      startDate = d.toISOString().slice(0, 10);
    } else {
      const d = new Date(now.getFullYear(), now.getMonth(), 1);
      startDate = d.toISOString().slice(0, 10);
    }

    const row = this.db.prepare(`
      SELECT
        SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) as absent_days,
        SUM(CASE WHEN status = 'late' THEN 1 ELSE 0 END) as late_days
      FROM attendance
      WHERE student_id = ? AND date >= ?
    `).get(childId, startDate);

    return {
      child_id: childId,
      summary: {
        absent_days: row?.absent_days || 0,
        late_days: row?.late_days || 0
      }
    };
  }

  // ── SCOPE VALIDATION ──

  isTeacherOfClass(teacherId, classId) {
    const r = this.db.prepare(
      "SELECT 1 FROM classes WHERE id = ? AND teacher_id = ?"
    ).get(classId, teacherId);
    return !!r;
  }

  isTeacherOfStudent(teacherId, studentId) {
    const r = this.db.prepare(`
      SELECT 1 FROM class_students cs
      JOIN classes c ON c.id = cs.class_id
      WHERE cs.student_id = ? AND c.teacher_id = ?
    `).get(studentId, teacherId);
    return !!r;
  }

  isParentOfChild(parentId, childId) {
    const r = this.db.prepare(
      "SELECT 1 FROM parent_children WHERE parent_id = ? AND student_id = ?"
    ).get(parentId, childId);
    return !!r;
  }
}

module.exports = SchoolConnector;
