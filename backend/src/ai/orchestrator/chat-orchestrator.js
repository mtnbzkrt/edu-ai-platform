const http = require("http");
const jwt = require("jsonwebtoken");
const UserMemory = require("../memory/user-memory");

const GATEWAY_HOST = process.env.OPENCLAW_GATEWAY_HOST || "10.0.0.1";
const GATEWAY_PORT = process.env.OPENCLAW_GATEWAY_PORT || 18790;
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || "bc433d5343886a5a34602fa85b0c91b6720e9b9f12dc80a0";
const JWT_SECRET = process.env.JWT_SECRET || "edu-ai-secret-key-2026";
const EDU_API_URL = process.env.EDU_API_URL || "https://edu.getinstaapp.com";
const TOOL_SCRIPT = "/home/bozkurt/.openclaw/workspace/edu-ai-platform/tools/edu-tool.js";

class ChatOrchestrator {

  // Generate a short-lived JWT for the agent to use with tool calls
  _generateAgentToken(authContext) {
    return jwt.sign({
      user_id: authContext.user_id,
      username: authContext.username,
      role: authContext.role,
      full_name: authContext.full_name
    }, JWT_SECRET, { expiresIn: "10m" });
  }

  // Build minimal system prompt — agent decides what tools to call
  _buildSystemPrompt(authContext) {
    const agentToken = this._generateAgentToken(authContext);
    const memoryContext = UserMemory.buildContext(authContext.user_id);

    const toolDocs = this._getToolDocs(authContext.role);

    let sys = `Sen bir eğitim AI asistanısın.
Kullanıcı: ${authContext.full_name || "Bilinmiyor"} (rol: ${authContext.role})

## Dil ve Üslup
Türkçe konuş. Pedagojik dil kullan, cesaretlendirici ol.
Ham veriyi gösterme, yorumlayarak açıkla.

## Veri Erişimi — Tool Kullanımı
Öğrencinin sınavları, ödevleri, performansı gibi verilere erişmek için tool çağırmalısın.
Verileri TAHMIN ETME veya UYDURMA — her zaman tool ile gerçek veriyi çek.

Tool çağırmak için exec aracını kullanarak şu komutu çalıştır:

node ${TOOL_SCRIPT} <tool_adı> [--parametre değer ...] --token ${agentToken}

### Kullanabileceğin Tool'lar:
${toolDocs}

### Kurallar:
1. Kullanıcı veri gerektiren bir şey soruyorsa (sınav, ödev, performans, plan), ÖNCE ilgili tool'u çağır.
2. Basit sohbet veya konu anlatımı için tool çağırmana gerek yok.
3. Tool sonucunu ham JSON olarak gösterme — yorumla, özetle, anlaşılır hale getir.
4. Bir seferde sadece ihtiyacın olan tool'ları çağır, hepsini birden çağırma.
5. Tool hata dönerse, kullanıcıya nazikçe açıkla.

## Hafıza Sistemi
Kullanıcı hakkında önemli bilgiler öğrendiğinde yanıtının SONUNA etiket ekle:
[HAFIZA_KAYDET:kategori:anahtar:değer]
Kategoriler: preferences, learning_style, strengths, weaknesses, goals, notes, personality
${memoryContext}`;

    return sys;
  }

  _getToolDocs(role) {
    if (role === "student") {
      return `
- get_self_profile — Kendi profil bilgin
- get_self_exam_results [--limit N] [--subject S] — Sınav sonuçları
- get_self_assignments [--limit N] [--status pending|completed] — Ödevler
- get_self_outcome_breakdown [--exam_ids 1,2,3] [--subject S] — Kazanım bazlı analiz

Örnek:
  node ${TOOL_SCRIPT} get_self_exam_results --limit 3 --token <TOKEN>
  node ${TOOL_SCRIPT} get_self_outcome_breakdown --exam_ids 1,2 --token <TOKEN>`;
    }
    if (role === "teacher") {
      return `
- list_teacher_classes — Sınıflarını listele
- list_class_students --class_id N — Sınıftaki öğrenciler
- get_class_exam_results --class_id N [--subject S] — Sınıf sınav sonuçları
- get_class_outcome_breakdown --class_id N [--subject S] — Sınıf kazanım analizi
- get_student_exam_results --student_id N [--limit N] — Tek öğrenci sınavları

Örnek:
  node ${TOOL_SCRIPT} list_teacher_classes --token <TOKEN>
  node ${TOOL_SCRIPT} get_class_exam_results --class_id 1 --token <TOKEN>`;
    }
    if (role === "parent") {
      return `
- list_my_children — Çocuklarını listele
- get_child_exam_results --child_id N [--limit N] — Çocuğun sınav sonuçları
- get_child_assignments --child_id N [--limit N] — Çocuğun ödevleri
- get_child_attendance --child_id N — Çocuğun devamsızlığı

Örnek:
  node ${TOOL_SCRIPT} list_my_children --token <TOKEN>
  node ${TOOL_SCRIPT} get_child_exam_results --child_id 3 --limit 5 --token <TOKEN>`;
    }
    return "Tool bulunmuyor.";
  }

  // Streaming — agent runs tools autonomously via Gateway
  async processMessageStream(message, authContext, sessionContext, previousMessages, res) {
    const agentKey = sessionContext.agent_key || this._getAgentKey(authContext.role);
    const sessionKey = `edu:${authContext.role}:${authContext.user_id}:${agentKey}`;

    // Build messages — minimal, agent-driven
    const messages = [];
    messages.push({ role: "system", content: this._buildSystemPrompt(authContext) });
    
    // Add previous conversation context
    if (previousMessages?.length > 0) {
      for (const msg of previousMessages.slice(-10)) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }
    messages.push({ role: "user", content: message });

    // Send prompt to frontend for display
    res.write(`data: ${JSON.stringify({ type: "prompt", agent: agentKey, session_key: sessionKey, messages })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: "tools", tools: [] })}\n\n`);

    return new Promise((resolve, reject) => {
      const body = JSON.stringify({ model: "openclaw", messages, user: sessionKey, stream: true });
      let fullText = "";

      const req = http.request({
        hostname: GATEWAY_HOST, port: GATEWAY_PORT,
        path: "/v1/chat/completions", method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + GATEWAY_TOKEN,
          "x-openclaw-agent-id": agentKey,
          "x-openclaw-session-key": sessionKey,
          "Content-Length": Buffer.byteLength(body)
        },
        timeout: 180000 // longer timeout — agent may call tools
      }, proxyRes => {
        let buffer = "";

        proxyRes.on("data", chunk => {
          buffer += chunk.toString();
          const lines = buffer.split("\n");
          buffer = lines.pop();

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();
            if (data === "[DONE]") {
              const { cleanResponse, saved } = UserMemory.parseAndSave(authContext.user_id, fullText);
              if (saved.length) console.log(`Memory saved for user ${authContext.user_id}:`, saved.map(s => `${s.category}:${s.key}`).join(", "));
              res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
              res.end();
              resolve({ reply: cleanResponse, usedTools: ["agent-autonomous"] });
              return;
            }
            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) {
                fullText += delta;
                if (!delta.includes("[HAFIZA_KAYDET")) {
                  res.write(`data: ${JSON.stringify({ type: "chunk", text: delta })}\n\n`);
                }
              }
            } catch {}
          }
        });

        proxyRes.on("end", () => {
          if (!fullText) {
            const fb = `Merhaba! 👋 Size nasıl yardımcı olabilirim?`;
            res.write(`data: ${JSON.stringify({ type: "chunk", text: fb })}\n\n`);
            res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
            res.end();
            resolve({ reply: fb, usedTools: [] });
          }
        });

        proxyRes.on("error", err => {
          console.error("Stream error:", err.message);
          const fb = `Bağlantı sorunu yaşandı, lütfen tekrar deneyin.`;
          res.write(`data: ${JSON.stringify({ type: "chunk", text: fb })}\n\n`);
          res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
          res.end();
          resolve({ reply: fb, usedTools: [] });
        });
      });

      req.on("error", err => {
        console.error("Request error:", err.message);
        const fb = `Bağlantı sorunu yaşandı, lütfen tekrar deneyin.`;
        res.write(`data: ${JSON.stringify({ type: "chunk", text: fb })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
        res.end();
        resolve({ reply: fb, usedTools: [] });
      });

      req.on("timeout", () => { req.destroy(); });
      req.write(body);
      req.end();
    });
  }

  // Non-streaming fallback
  async processMessage(message, authContext, sessionContext, previousMessages) {
    const agentKey = sessionContext.agent_key || this._getAgentKey(authContext.role);
    const sessionKey = `edu:${authContext.role}:${authContext.user_id}:${agentKey}`;
    
    const messages = [];
    messages.push({ role: "system", content: this._buildSystemPrompt(authContext) });
    if (previousMessages?.length > 0) {
      for (const msg of previousMessages.slice(-10)) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }
    messages.push({ role: "user", content: message });

    let reply;
    try {
      reply = await this._callAgentHTTP(agentKey, sessionKey, messages);
    } catch (err) {
      console.error("Agent error:", err.message);
      reply = `Merhaba! 👋 Size nasıl yardımcı olabilirim?`;
    }

    const { cleanResponse, saved } = UserMemory.parseAndSave(authContext.user_id, reply);
    return { reply: cleanResponse, usedTools: ["agent-autonomous"] };
  }

  _callAgentHTTP(agentKey, sessionKey, messages) {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({ model: "openclaw", messages, user: sessionKey });
      const req = http.request({
        hostname: GATEWAY_HOST, port: GATEWAY_PORT,
        path: "/v1/chat/completions", method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + GATEWAY_TOKEN, "x-openclaw-agent-id": agentKey, "x-openclaw-session-key": sessionKey, "Content-Length": Buffer.byteLength(body) },
        timeout: 180000
      }, res => {
        let data = "";
        res.on("data", c => data += c);
        res.on("end", () => { try { const d = JSON.parse(data); resolve(d.choices?.[0]?.message?.content || ""); } catch (e) { reject(e); } });
      });
      req.on("error", reject);
      req.on("timeout", () => { req.destroy(); reject(new Error("Timeout")); });
      req.write(body);
      req.end();
    });
  }

  _getAgentKey(role) {
    return { student: "learner-agent", teacher: "teacher-agent", parent: "parent-agent" }[role] || "learner-agent";
  }
}

module.exports = new ChatOrchestrator();
