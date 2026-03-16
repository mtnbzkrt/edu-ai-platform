const http = require("http");
const { executeTool } = require("../tools/tool-registry");
const UserMemory = require("../memory/user-memory");

const GATEWAY_HOST = process.env.OPENCLAW_GATEWAY_HOST || "10.0.0.1";
const GATEWAY_PORT = process.env.OPENCLAW_GATEWAY_PORT || 18790;
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || "bc433d5343886a5a34602fa85b0c91b6720e9b9f12dc80a0";

class ChatOrchestrator {
  // Non-streaming (kept for fallback)
  async processMessage(message, authContext, sessionContext, previousMessages) {
    const agentKey = sessionContext.agent_key || this._getAgentKey(authContext.role);
    const usedTools = [];
    const toolData = this._prefetchData(message, authContext, usedTools);
    const memoryContext = UserMemory.buildContext(authContext.user_id);
    const messages = this._buildMessages(message, authContext, toolData, usedTools, previousMessages, memoryContext);
    const sessionKey = `edu:${authContext.role}:${authContext.user_id}:${agentKey}`;

    let reply;
    try {
      reply = await this._callAgentHTTP(agentKey, sessionKey, messages, false);
    } catch (err) {
      console.error("Agent error:", err.message);
      reply = this._localFallback(authContext, toolData);
    }

    const { cleanResponse, saved } = UserMemory.parseAndSave(authContext.user_id, reply);
    if (saved.length) console.log(`Memory saved for user ${authContext.user_id}:`, saved.map(s => `${s.category}:${s.key}`).join(", "));
    return { reply: cleanResponse, usedTools };
  }

  // Streaming version — activity steps collected, sent as summary at end
  async processMessageStream(message, authContext, sessionContext, previousMessages, res) {
    const startTime = Date.now();
    const steps = []; // collect steps, send at end
    const step = (icon, label, detail) => steps.push({ icon, label, detail, ts: Date.now() - startTime });

    const agentKey = sessionContext.agent_key || this._getAgentKey(authContext.role);

    // Step 1: Prefetch tools
    step("🔐", "Kimlik doğrulama", `${authContext.role} — ${authContext.user_id}`);
    
    const usedTools = [];
    const toolData = this._prefetchDataWithSteps(message, authContext, usedTools, step);

    // Step 2: Memory
    const memoryContext = UserMemory.buildContext(authContext.user_id);
    step("🧠", "Hafıza", memoryContext ? "Mevcut hafıza yüklendi" : "Hafıza boş");

    // Step 3: Build messages
    const messages = this._buildMessages(message, authContext, toolData, usedTools, previousMessages, memoryContext);
    const totalChars = messages.reduce((s, m) => s + m.content.length, 0);
    step("📝", "Prompt", `${messages.length} mesaj, ${totalChars} karakter`);

    const sessionKey = `edu:${authContext.role}:${authContext.user_id}:${agentKey}`;

    // Send tools info
    res.write(`data: ${JSON.stringify({ type: "tools", tools: usedTools })}\n\n`);

    // Step 4: Agent call
    step("🔌", "Agent", `${agentKey} bağlantısı başlatıldı`);

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
        timeout: 120000
      }, proxyRes => {
        step("📡", "Bağlantı", `HTTP ${proxyRes.statusCode}`);
        let buffer = "";
        let firstChunk = true;

        proxyRes.on("data", chunk => {
          buffer += chunk.toString();
          const lines = buffer.split("\n");
          buffer = lines.pop();

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();
            if (data === "[DONE]") {
              if (firstChunk) step("💭", "Yanıt", "Boş yanıt");
              
              // Memory
              const { cleanResponse, saved } = UserMemory.parseAndSave(authContext.user_id, fullText);
              if (saved.length) {
                step("💾", "Hafıza kayıt", saved.map(s => s.key).join(", "));
                console.log(`Memory saved for user ${authContext.user_id}:`, saved.map(s => `${s.category}:${s.key}`).join(", "));
              }

              step("✅", "Tamamlandı", `${fullText.length} karakter, ${((Date.now() - startTime) / 1000).toFixed(1)}s`);

              // Send steps summary AFTER done
              res.write(`data: ${JSON.stringify({ type: "steps", steps })}\n\n`);
              res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
              res.end();
              resolve({ reply: cleanResponse, usedTools });
              return;
            }
            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) {
                if (firstChunk) {
                  step("💭", "Agent yanıtı", "Akış başladı");
                  firstChunk = false;
                }
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
            step("⚠️", "Yedek yanıt", "Agent yanıt vermedi");
            const fb = this._localFallback(authContext, toolData);
            res.write(`data: ${JSON.stringify({ type: "chunk", text: fb })}\n\n`);
            res.write(`data: ${JSON.stringify({ type: "steps", steps })}\n\n`);
            res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
            res.end();
            resolve({ reply: fb, usedTools });
          }
        });

        proxyRes.on("error", err => {
          step("❌", "Hata", err.message);
          const fb = this._localFallback(authContext, toolData);
          res.write(`data: ${JSON.stringify({ type: "chunk", text: fb })}\n\n`);
          res.write(`data: ${JSON.stringify({ type: "steps", steps })}\n\n`);
          res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
          res.end();
          resolve({ reply: fb, usedTools });
        });
      });

      req.on("error", err => {
        step("❌", "Bağlantı hatası", err.message);
        const fb = this._localFallback(authContext, toolData);
        res.write(`data: ${JSON.stringify({ type: "chunk", text: fb })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: "steps", steps })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
        res.end();
        resolve({ reply: fb, usedTools });
      });

      req.on("timeout", () => { req.destroy(); });
      req.write(body);
      req.end();
    });
  }

  // Prefetch with step logging (no SSE writes)
  _prefetchDataWithSteps(message, auth, usedTools, step) {
    const msg = message.toLowerCase();
    const r = {};
    try {
      if (auth.role === "student") {
        r.profile = executeTool("get_self_profile", {}, auth); usedTools.push("get_self_profile");
        step("🔧", "get_self_profile", r.profile?.full_name || "OK");

        if (msg.match(/sınav|sonuç|eksik|zayıf|performans|not|konu|tekrar|puan|başarı|durum/)) {
          r.exams = executeTool("get_self_exam_results", { limit: 5 }, auth); usedTools.push("get_self_exam_results");
          step("🔧", "get_self_exam_results", `${r.exams?.items?.length || 0} sınav`);
          if (r.exams?.items?.length > 0) {
            r.outcomes = executeTool("get_self_outcome_breakdown", { exam_ids: r.exams.items.map(i => i.exam_id) }, auth); usedTools.push("get_self_outcome_breakdown");
            step("🔧", "get_self_outcome_breakdown", "Kazanım analizi");
          }
        }
        if (msg.match(/ödev|görev|teslim/)) {
          r.assignments = executeTool("get_self_assignments", { limit: 10 }, auth); usedTools.push("get_self_assignments");
          step("🔧", "get_self_assignments", `${r.assignments?.items?.length || 0} ödev`);
        }
        if (msg.match(/plan|çalışma|program/) && !r.exams) {
          r.exams = executeTool("get_self_exam_results", { limit: 3 }, auth); usedTools.push("get_self_exam_results");
          step("🔧", "get_self_exam_results", `${r.exams?.items?.length || 0} sınav`);
          if (r.exams?.items?.length > 0) {
            r.outcomes = executeTool("get_self_outcome_breakdown", { exam_ids: r.exams.items.map(i => i.exam_id) }, auth); usedTools.push("get_self_outcome_breakdown");
            step("🔧", "get_self_outcome_breakdown", "Kazanım analizi");
          }
        }
      } else if (auth.role === "teacher") {
        r.classes = executeTool("list_teacher_classes", {}, auth); usedTools.push("list_teacher_classes");
        step("🔧", "list_teacher_classes", `${r.classes?.classes?.length || 0} sınıf`);
        if (r.classes?.classes?.length > 0) {
          const cid = r.classes.classes[0].class_id;
          if (msg.match(/performans|başarı|zayıf|konu|kazanım|analiz/)) {
            r.outcomes = executeTool("get_class_outcome_breakdown", { class_id: cid }, auth); usedTools.push("get_class_outcome_breakdown");
            step("🔧", "get_class_outcome_breakdown", "Sınıf kazanım analizi");
          }
          if (msg.match(/sınav|sonuç|not/)) {
            r.examResults = executeTool("get_class_exam_results", { class_id: cid }, auth); usedTools.push("get_class_exam_results");
            step("🔧", "get_class_exam_results", "Sınıf sınav sonuçları");
          }
          if (msg.match(/öğrenci|liste/)) {
            r.students = executeTool("list_class_students", { class_id: cid }, auth); usedTools.push("list_class_students");
            step("🔧", "list_class_students", `${r.students?.students?.length || 0} öğrenci`);
          }
        }
      } else if (auth.role === "parent") {
        r.children = executeTool("list_my_children", {}, auth); usedTools.push("list_my_children");
        step("🔧", "list_my_children", `${r.children?.children?.length || 0} çocuk`);
        if (r.children?.children?.length > 0) {
          const cid = r.children.children[0].child_id;
          r.exams = executeTool("get_child_exam_results", { child_id: cid, limit: 5 }, auth); usedTools.push("get_child_exam_results");
          step("🔧", "get_child_exam_results", `${r.exams?.items?.length || 0} sınav`);
          r.attendance = executeTool("get_child_attendance", { child_id: cid }, auth); usedTools.push("get_child_attendance");
          step("🔧", "get_child_attendance", "Devamsızlık bilgisi");
          if (msg.match(/ödev/)) {
            r.assignments = executeTool("get_child_assignments", { child_id: cid, limit: 10 }, auth); usedTools.push("get_child_assignments");
            step("🔧", "get_child_assignments", `${r.assignments?.items?.length || 0} ödev`);
          }
        }
      }
    } catch (e) {
      step("❌", "Tool hatası", e.message);
      console.error("Prefetch error:", e.message);
    }
    return r;
  }

  _callAgentHTTP(agentKey, sessionKey, messages) {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({ model: "openclaw", messages, user: sessionKey });
      const req = http.request({
        hostname: GATEWAY_HOST, port: GATEWAY_PORT,
        path: "/v1/chat/completions", method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + GATEWAY_TOKEN, "x-openclaw-agent-id": agentKey, "x-openclaw-session-key": sessionKey, "Content-Length": Buffer.byteLength(body) },
        timeout: 90000
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

  _prefetchData(message, auth, usedTools) {
    const msg = message.toLowerCase();
    const r = {};
    try {
      if (auth.role === "student") {
        r.profile = executeTool("get_self_profile", {}, auth); usedTools.push("get_self_profile");
        if (msg.match(/sınav|sonuç|eksik|zayıf|performans|not|konu|tekrar|puan|başarı|durum/)) {
          r.exams = executeTool("get_self_exam_results", { limit: 5 }, auth); usedTools.push("get_self_exam_results");
          if (r.exams?.items?.length > 0) { r.outcomes = executeTool("get_self_outcome_breakdown", { exam_ids: r.exams.items.map(i => i.exam_id) }, auth); usedTools.push("get_self_outcome_breakdown"); }
        }
        if (msg.match(/ödev|görev|teslim/)) { r.assignments = executeTool("get_self_assignments", { limit: 10 }, auth); usedTools.push("get_self_assignments"); }
        if (msg.match(/plan|çalışma|program/) && !r.exams) {
          r.exams = executeTool("get_self_exam_results", { limit: 3 }, auth); usedTools.push("get_self_exam_results");
          if (r.exams?.items?.length > 0) { r.outcomes = executeTool("get_self_outcome_breakdown", { exam_ids: r.exams.items.map(i => i.exam_id) }, auth); usedTools.push("get_self_outcome_breakdown"); }
        }
      } else if (auth.role === "teacher") {
        r.classes = executeTool("list_teacher_classes", {}, auth); usedTools.push("list_teacher_classes");
        if (r.classes?.classes?.length > 0) {
          const cid = r.classes.classes[0].class_id;
          if (msg.match(/performans|başarı|zayıf|konu|kazanım|analiz/)) { r.outcomes = executeTool("get_class_outcome_breakdown", { class_id: cid }, auth); usedTools.push("get_class_outcome_breakdown"); }
          if (msg.match(/sınav|sonuç|not/)) { r.examResults = executeTool("get_class_exam_results", { class_id: cid }, auth); usedTools.push("get_class_exam_results"); }
          if (msg.match(/öğrenci|liste/)) { r.students = executeTool("list_class_students", { class_id: cid }, auth); usedTools.push("list_class_students"); }
        }
      } else if (auth.role === "parent") {
        r.children = executeTool("list_my_children", {}, auth); usedTools.push("list_my_children");
        if (r.children?.children?.length > 0) {
          const cid = r.children.children[0].child_id;
          r.exams = executeTool("get_child_exam_results", { child_id: cid, limit: 5 }, auth); usedTools.push("get_child_exam_results");
          r.attendance = executeTool("get_child_attendance", { child_id: cid }, auth); usedTools.push("get_child_attendance");
          if (msg.match(/ödev/)) { r.assignments = executeTool("get_child_assignments", { child_id: cid, limit: 10 }, auth); usedTools.push("get_child_assignments"); }
        }
      }
    } catch (e) { console.error("Prefetch error:", e.message); }
    return r;
  }

  _buildMessages(userMessage, auth, toolData, usedTools, previousMessages, memoryContext) {
    const messages = [];
    let sys = `Sen bir egitim AI asistanisin. Kullanici rolu: ${auth.role}.\nTurkce konusuyorsun. Pedagojik dil kullan, cesaretlendirici ol.\nHam veriyi gosterme, yorumlayarak acikla.\n\n`;
    sys += `HAFIZA SISTEMI:\nKullanici hakkinda onemli bilgiler ogrendiginde yanitinin SONUNA etiket ekle:\n[HAFIZA_KAYDET:kategori:anahtar:deger]\nKategoriler: preferences, learning_style, strengths, weaknesses, goals, notes, personality\n`;
    if (memoryContext) sys += memoryContext;
    if (Object.keys(toolData).length > 0) {
      sys += `\nOkul sisteminden alinan veriler:\n`;
      for (const [k, v] of Object.entries(toolData)) sys += `--- ${k} ---\n${JSON.stringify(v, null, 2).slice(0, 1500)}\n`;
    }
    messages.push({ role: "system", content: sys });
    if (previousMessages?.length > 0) for (const msg of previousMessages.slice(-10)) messages.push({ role: msg.role, content: msg.content });
    messages.push({ role: "user", content: userMessage });
    return messages;
  }

  _localFallback(auth, toolData) {
    const name = toolData?.profile?.full_name || "";
    return `Merhaba${name ? " " + name.split(" ")[0] : ""}! 👋 Size nasıl yardımcı olabilirim?`;
  }

  _getAgentKey(role) {
    return { student: "learner-agent", teacher: "teacher-agent", parent: "parent-agent" }[role] || "learner-agent";
  }
}

module.exports = new ChatOrchestrator();
