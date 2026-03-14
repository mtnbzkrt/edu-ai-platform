const Database = require("better-sqlite3");
const path = require("path");

let db;
function getDb() {
  if (!db) {
    db = new Database(path.join(__dirname, "../../data/school.db"));
  }
  return db;
}

function logToolCall({ tool, user_id, role, session_id, duration_ms, success, error }) {
  try {
    getDb().prepare(`
      INSERT INTO audit_log (user_id, role, agent, tool_name, input_summary, duration_ms, session_id, success, error_code, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      user_id || "system",
      role || "unknown",
      "system",
      tool,
      "{}",
      duration_ms || 0,
      session_id || "none",
      success ? 1 : 0,
      error || null
    );
  } catch (e) {
    console.error("Audit log error:", e.message);
  }
}

module.exports = { logToolCall };
