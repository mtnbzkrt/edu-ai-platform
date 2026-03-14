const express = require("express");
const cors = require("cors");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const { generateToken, authMiddleware, requireRole, bcrypt } = require("./src/auth/auth");
const connector = require("./src/school/connector/school-connector");
const { executeTool, getToolsForRole } = require("./src/ai/tools/tool-registry");
const chatOrchestrator = require("./src/ai/orchestrator/chat-orchestrator");
const db = require("./src/school/connector/db");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "../frontend")));

// ── AUTH ──
app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ ok: false, error: { code: "INVALID_INPUT", message: "Username and password required" } });

  const user = connector.getUserByUsername(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ ok: false, error: { code: "UNAUTHORIZED", message: "Invalid credentials" } });
  }

  const actorId = connector.getActorId(user.id, user.role);
  const permissions = connector.getPermissions(user.role);
  const token = generateToken(user, actorId, permissions);

  const agentKey = { student: "learner-agent", teacher: "teacher-agent", parent: "parent-agent", admin: "admin-agent" }[user.role];

  res.json({
    ok: true,
    data: {
      token,
      user: { id: user.id, username: user.username, role: user.role, full_name: user.full_name },
      actor_id: actorId,
      agent_key: agentKey,
      available_tools: getToolsForRole(user.role)
    }
  });
});

app.get("/api/auth/me", authMiddleware, (req, res) => {
  res.json({ ok: true, data: req.auth });
});

// ── AI SESSIONS ──
app.post("/api/ai/sessions", authMiddleware, (req, res) => {
  const { agent_key, session_type, title } = req.body;
  const sessionId = "sess_" + uuidv4().slice(0, 8);
  const agentKey = agent_key || { student: "learner-agent", teacher: "teacher-agent", parent: "parent-agent" }[req.auth.role] || "learner-agent";

  db.prepare(`INSERT INTO ai_sessions(id, user_id, agent_key, session_type, title) VALUES (?,?,?,?,?)`)
    .run(sessionId, req.auth.user_id, agentKey, session_type || "chat", title || "Yeni Konuşma");

  res.json({
    ok: true,
    data: { session_id: sessionId, agent_key: agentKey, status: "active" }
  });
});

app.get("/api/ai/sessions", authMiddleware, (req, res) => {
  const sessions = db.prepare(`SELECT id, agent_key, session_type, title, status, last_summary, created_at, updated_at
    FROM ai_sessions WHERE user_id = ? ORDER BY updated_at DESC`).all(req.auth.user_id);
  res.json({ ok: true, data: sessions });
});

app.get("/api/ai/sessions/:id", authMiddleware, (req, res) => {
  const session = db.prepare(`SELECT * FROM ai_sessions WHERE id = ? AND user_id = ?`).get(req.params.id, req.auth.user_id);
  if (!session) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Session not found" } });

  const messages = db.prepare(`SELECT id, role, content, used_tools, created_at FROM ai_messages WHERE session_id = ? ORDER BY created_at ASC`).all(session.id);
  res.json({ ok: true, data: { ...session, messages } });
});

// ── AI CHAT ──
app.post("/api/ai/chat", authMiddleware, async (req, res) => {
  const { session_id, message } = req.body;
  if (!session_id || !message) return res.status(400).json({ ok: false, error: { code: "INVALID_INPUT", message: "session_id and message required" } });

  const session = db.prepare(`SELECT * FROM ai_sessions WHERE id = ? AND user_id = ?`).get(session_id, req.auth.user_id);
  if (!session) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Session not found" } });

  // Save user message
  db.prepare(`INSERT INTO ai_messages(id, session_id, role, content) VALUES (?,?,?,?)`)
    .run("msg_" + uuidv4().slice(0, 8), session_id, "user", message);

  // Get previous messages for context
  const prevMessages = db.prepare(\`SELECT role, content FROM ai_messages WHERE session_id = ? ORDER BY created_at ASC LIMIT 20\`).all(session_id);

  // Process through orchestrator
  const startTime = Date.now();
  const result = await chatOrchestrator.processMessage(message, req.auth, {
    session_id,
    agent_key: session.agent_key,
    previousMessages: prevMessages
  });
  const duration = Date.now() - startTime;

  // Save assistant message
  db.prepare(`INSERT INTO ai_messages(id, session_id, role, content, used_tools) VALUES (?,?,?,?,?)`)
    .run("msg_" + uuidv4().slice(0, 8), session_id, "assistant", result.reply, JSON.stringify(result.usedTools));

  // Update session
  db.prepare(`UPDATE ai_sessions SET updated_at = datetime('now'), last_summary = ? WHERE id = ?`)
    .run(message.slice(0, 100), session_id);

  // Audit log
  db.prepare(`INSERT INTO audit_log(id, request_id, session_id, user_id, role, agent, tool_name, duration_ms, school_id, success)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(uuidv4().slice(0, 8), uuidv4().slice(0, 8), session_id, req.auth.user_id, req.auth.role, session.agent_key,
      result.usedTools.join(","), duration, req.auth.school_id, 1);

  res.json({
    ok: true,
    data: {
      session_id,
      assistant_message: result.reply,
      used_tools: result.usedTools,
      duration_ms: duration
    }
  });
});

// ── TOOL ENDPOINTS ──
app.post("/api/ai/tools/:toolName", authMiddleware, (req, res) => {
  const { toolName } = req.params;
  const input = req.body.input || {};
  const requestId = uuidv4().slice(0, 8);
  const startTime = Date.now();

  try {
    const data = executeTool(toolName, input, req.auth);
    const duration = Date.now() - startTime;

    // Audit
    db.prepare(`INSERT INTO audit_log(id, request_id, user_id, role, agent, tool_name, input_summary, duration_ms, school_id, success)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(uuidv4().slice(0, 8), requestId, req.auth.user_id, req.auth.role, req.body.meta?.agent || "direct",
        toolName, JSON.stringify(input).slice(0, 200), duration, req.auth.school_id, 1);

    res.json({ ok: true, data, meta: { source: "school_connector", fetched_at: new Date().toISOString(), request_id: requestId } });
  } catch (e) {
    res.status(e.code === "ACCESS_DENIED" || e.code === "FORBIDDEN" ? 403 : 400).json({
      ok: false, error: { code: e.code || "ERROR", message: e.message || "Tool execution failed" }, meta: { request_id: requestId }
    });
  }
});

// ── ADMIN ENDPOINTS ──
app.get("/api/admin/stats", authMiddleware, requireRole("admin"), (req, res) => {
  const stats = {
    users: db.prepare("SELECT COUNT(*) as c FROM users").get().c,
    students: db.prepare("SELECT COUNT(*) as c FROM students").get().c,
    teachers: db.prepare("SELECT COUNT(*) as c FROM teachers").get().c,
    parents: db.prepare("SELECT COUNT(*) as c FROM parents").get().c,
    sessions: db.prepare("SELECT COUNT(*) as c FROM ai_sessions").get().c,
    messages: db.prepare("SELECT COUNT(*) as c FROM ai_messages").get().c,
    tool_calls: db.prepare("SELECT COUNT(*) as c FROM audit_log").get().c,
  };
  res.json({ ok: true, data: stats });
});

app.get("/api/admin/audit", authMiddleware, requireRole("admin"), (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  const logs = db.prepare("SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ?").all(limit);
  res.json({ ok: true, data: logs });
});

// ── SPA FALLBACK ──
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/index.html"));
});

const PORT = process.env.PORT || 3080;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🎓 Eğitim AI Platform — http://0.0.0.0:${PORT}`);
});
