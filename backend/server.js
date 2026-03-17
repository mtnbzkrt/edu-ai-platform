const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const Database = require("better-sqlite3");
const path = require("path");
const bcrypt = require("bcryptjs");
const { executeTool, getToolsForRole } = require("./src/ai/tools/tool-registry");
const { buildAuthContext } = require("./src/ai/context/auth-context");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "../frontend"), { etag: false, lastModified: false, setHeaders: (res) => { res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate"); res.setHeader("Pragma", "no-cache"); res.setHeader("Expires", "0"); } }));

const JWT_SECRET = process.env.JWT_SECRET || "edu-ai-secret-key-2026";
const PORT = process.env.PORT || 3080;

// DB
const db = new Database(path.join(__dirname, "src/data/school.db"));
db.pragma("journal_mode = WAL");

// ─── AUTH MIDDLEWARE ───
function authMiddleware(req, res, next) {
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  if (!token) return res.status(401).json({ ok: false, error: { code: "UNAUTHORIZED", message: "Token gerekli" } });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = { ...decoded, jwt: token };
    next();
  } catch {
    res.status(401).json({ ok: false, error: { code: "UNAUTHORIZED", message: "Geçersiz token" } });
  }
}

// ─── AUTH ENDPOINTS ───
app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ ok: false, error: { code: "UNAUTHORIZED", message: "Hatalı giriş" } });
  }
  const token = jwt.sign({ user_id: user.id, username: user.username, role: user.role, full_name: user.full_name }, JWT_SECRET, { expiresIn: "24h" });
  const agentKey = { student: "learner-agent", teacher: "teacher-agent", parent: "parent-agent" }[user.role] || "learner-agent";
  res.json({ ok: true, data: { token, user: { id: user.id, username: user.username, role: user.role, full_name: user.full_name }, agent_key: agentKey } });
});

// ─── SESSION ENDPOINTS ───
app.post("/api/ai/sessions", authMiddleware, (req, res) => {
  const sessionId = "sess_" + uuidv4().slice(0, 8);
  const agentKey = { student: "learner-agent", teacher: "teacher-agent", parent: "parent-agent" }[req.user.role] || "learner-agent";
  const title = req.body.title || "Yeni konuşma";

  db.prepare(`INSERT INTO ai_sessions (id, user_id, agent_key, title, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'active', datetime('now'), datetime('now'))`
  ).run(sessionId, req.user.user_id, agentKey, title);

  res.json({ ok: true, data: { session_id: sessionId, agent_key: agentKey, title } });
});

app.get("/api/ai/sessions", authMiddleware, (req, res) => {
  const sessions = db.prepare(
    "SELECT * FROM ai_sessions WHERE user_id = ? ORDER BY updated_at DESC LIMIT 20"
  ).all(req.user.user_id);
  res.json({ ok: true, data: { sessions } });
});

app.get("/api/ai/sessions/:id", authMiddleware, (req, res) => {
  const session = db.prepare("SELECT * FROM ai_sessions WHERE id = ? AND user_id = ?").get(req.params.id, req.user.user_id);
  if (!session) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Session bulunamadı" } });

  const messages = db.prepare("SELECT role, content, used_tools, created_at FROM ai_messages WHERE session_id = ? ORDER BY created_at ASC").all(session.id);
  res.json({ ok: true, data: { ...session, messages } });
});

// ─── MEMORY ENDPOINTS ───
app.get("/api/ai/memory", authMiddleware, (req, res) => {
  const UserMemory = require("./src/ai/memory/user-memory");
  const memories = UserMemory.getAll(req.user.user_id);
  res.json({ ok: true, data: { memories } });
});

app.get("/api/ai/memory/:category", authMiddleware, (req, res) => {
  const UserMemory = require("./src/ai/memory/user-memory");
  const memories = UserMemory.getByCategory(req.user.user_id, req.params.category);
  res.json({ ok: true, data: { memories } });
});

// ─── CHAT ENDPOINT ───
app.post("/api/ai/chat", authMiddleware, async (req, res) => {
  const { session_id, message } = req.body;
  if (!session_id || !message) {
    return res.status(400).json({ ok: false, error: { code: "INVALID_INPUT", message: "session_id ve message gerekli" } });
  }

  const session = db.prepare("SELECT * FROM ai_sessions WHERE id = ? AND user_id = ?").get(session_id, req.user.user_id);
  if (!session) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Session bulunamadı" } });

  // Save user message
  db.prepare("INSERT INTO ai_messages (id, session_id, role, content, created_at) VALUES (?, ?, 'user', ?, datetime('now'))")
    .run(uuidv4(), session_id, message);

  // Build auth context
  const authContext = buildAuthContext(req.user, session_id);

  // Get previous messages for context
  const prevMessages = db.prepare(
    "SELECT role, content FROM ai_messages WHERE session_id = ? ORDER BY created_at ASC LIMIT 20"
  ).all(session_id);

  // Process through orchestrator
  const orchestrator = require("./src/ai/orchestrator/plugin-integrated-orchestrator");
  const startTime = Date.now();
  try {
    const result = await orchestrator.processMessage(message, authContext, {
      session_id,
      agent_key: session.agent_key
    }, prevMessages);








    const duration = Date.now() - startTime;

    // Save assistant message
    db.prepare("INSERT INTO ai_messages (id, session_id, role, content, used_tools, created_at) VALUES (?, ?, 'assistant', ?, ?, datetime('now'))")
      .run(uuidv4(), session_id, result.reply, JSON.stringify(result.usedTools || []));

    // Update session
    db.prepare("UPDATE ai_sessions SET updated_at = datetime('now') WHERE id = ?").run(session_id);

    res.json({
      ok: true,
      data: {
        session_id,
        assistant_message: result.reply,
        used_tools: result.usedTools || [],
        duration_ms: duration
      }
    });
  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({ ok: false, error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// ─── STREAMING CHAT ENDPOINT ───
app.post("/api/ai/chat/stream", authMiddleware, async (req, res) => {
  const { session_id, message } = req.body;
  if (!session_id || !message) return res.status(400).json({ ok: false, error: { code: "INVALID_INPUT" } });

  const session = db.prepare("SELECT * FROM ai_sessions WHERE id = ? AND user_id = ?").get(session_id, req.user.user_id);
  if (!session) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND" } });

  db.prepare("INSERT INTO ai_messages (id, session_id, role, content, created_at) VALUES (?, ?, 'user', ?, datetime('now'))").run(uuidv4(), session_id, message);

  const authContext = buildAuthContext(req.user, session_id);
  const prevMessages = db.prepare("SELECT role, content FROM ai_messages WHERE session_id = ? ORDER BY created_at ASC LIMIT 20").all(session_id);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const orchestrator = require("./src/ai/orchestrator/plugin-integrated-orchestrator");
  try {
    const result = await orchestrator.processMessageStream(message, authContext, { session_id, agent_key: session.agent_key }, prevMessages, res);
    db.prepare("INSERT INTO ai_messages (id, session_id, role, content, used_tools, created_at) VALUES (?, ?, 'assistant', ?, ?, datetime('now'))").run(uuidv4(), session_id, result.reply, JSON.stringify(result.usedTools || []));
    db.prepare("UPDATE ai_sessions SET updated_at = datetime('now') WHERE id = ?").run(session_id);
  } catch (err) {
    console.error("Stream error:", err);
    res.write("data: " + JSON.stringify({ type: "error", message: err.message }) + "\n\n");
    res.end();
  }
});

// ─── TOOL API ENDPOINTS (POST /api/ai/tools/*) ───
// These are the endpoints that agents call directly

app.post("/api/ai/tools/:toolName", authMiddleware, (req, res) => {
  const { toolName } = req.params;
  const { input = {}, meta = {} } = req.body;
  const requestId = meta.request_id || uuidv4();

  // Build auth context
  const authContext = buildAuthContext(req.user, meta.session_id);

  try {
    const result = executeTool(toolName.replace(/-/g, "_"), input, authContext);
    res.json({
      ok: true,
      data: result,
      meta: {
        request_id: requestId,
        source: "school_connector",
        fetched_at: new Date().toISOString()
      }
    });
  } catch (err) {
    const status = err.code === "FORBIDDEN" ? 403 : err.code === "ACCESS_DENIED" ? 403 : err.code === "NOT_FOUND" ? 404 : 400;
    res.status(status).json({
      ok: false,
      error: { code: err.code || "ERROR", message: err.message || "Bilinmeyen hata" },
      meta: { request_id: requestId }
    });
  }
});

// Also support kebab-case tool names
app.post("/api/ai/tools/get-self-profile", authMiddleware, (req, res) => {
  req.params.toolName = "get_self_profile";
  return handleToolCall(req, res);
});

function handleToolCall(req, res) {
  const toolName = req.params.toolName.replace(/-/g, "_");
  const { input = {}, meta = {} } = req.body;
  const requestId = meta.request_id || uuidv4();
  const authContext = buildAuthContext(req.user, meta.session_id);

  try {
    const result = executeTool(toolName, input, authContext);
    res.json({ ok: true, data: result, meta: { request_id: requestId, source: "school_connector", fetched_at: new Date().toISOString() } });
  } catch (err) {
    res.status(err.code === "FORBIDDEN" || err.code === "ACCESS_DENIED" ? 403 : 400).json({
      ok: false, error: { code: err.code || "ERROR", message: err.message }, meta: { request_id: requestId }
    });
  }
}

// ─── ADMIN ENDPOINTS ───
app.get("/api/admin/stats", authMiddleware, (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ ok: false, error: { code: "FORBIDDEN" } });
  const stats = {
    users: db.prepare("SELECT COUNT(*) as c FROM users").get().c,
    sessions: db.prepare("SELECT COUNT(*) as c FROM ai_sessions").get().c,
    messages: db.prepare("SELECT COUNT(*) as c FROM ai_messages").get().c,
    tools_called: db.prepare("SELECT COUNT(*) as c FROM audit_log WHERE action LIKE 'tool:%'").get().c
  };
  res.json({ ok: true, data: stats });
});

// ─── AVAILABLE TOOLS ENDPOINT ───
app.get("/api/ai/tools", authMiddleware, (req, res) => {
  const tools = getToolsForRole(req.user.role);
  res.json({ ok: true, data: { role: req.user.role, available_tools: tools } });
});

// ─── START ───
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🎓 Eğitim AI Platform — Tool API + Session API`);
  console.log(`   http://0.0.0.0:${PORT}`);
  console.log(`   Tool API: POST /api/ai/tools/:toolName`);
  console.log(`   Session API: POST /api/ai/sessions, POST /api/ai/chat`);
});
