const Database = require("better-sqlite3");
const path = require("path");

function buildAuthContext(user, sessionId) {
  const db = new Database(path.join(__dirname, "../../data/school.db"));
  const ctx = {
    user_id: user.id || user.user_id,
    username: user.username,
    role: user.role,
    full_name: user.full_name,
    school_id: "school_main",
    actor_id: null,
    session_id: sessionId,
    jwt: user.jwt,
    permissions: []
  };

  if (user.role === "student") {
    const s = db.prepare("SELECT id FROM students WHERE user_id = ?").get(ctx.user_id);
    ctx.actor_id = s?.id;
    ctx.permissions = ["student.self.read", "student.self.assignments.read"];
  } else if (user.role === "teacher") {
    const t = db.prepare("SELECT id FROM teachers WHERE user_id = ?").get(ctx.user_id);
    ctx.actor_id = t?.id;
    ctx.permissions = ["teacher.classes.read", "teacher.students.read", "teacher.generate.write"];
  } else if (user.role === "parent") {
    const p = db.prepare("SELECT id FROM parents WHERE user_id = ?").get(ctx.user_id);
    ctx.actor_id = p?.id;
    ctx.permissions = ["parent.children.read"];
  }

  db.close();
  return ctx;
}

module.exports = { buildAuthContext };
