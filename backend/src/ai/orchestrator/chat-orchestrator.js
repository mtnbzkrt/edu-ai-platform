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

  // Helper to send activity events
  _sendActivity(res, step, detail, status = "running") {
    if (!res || res.writableEnded) return;
    res.write(`data: ${JSON.stringify({ type: "activity", step, detail, status, ts: Date.now() })}\n\n`);
  }

  // Streaming version with activity feed
  async processMessageStream(message, authContext, sessionContext, previousMessages, res) {
    const agentKey = sessionContext.agent_key || this._getAgentKey(authContext.role);
    
    // Step 1: Auth & session
    this._sendActivity(res, "auth", `Kullanıcı doğrulandı: ${authContext.role}`, "done");
    this._sendActivity(res, "session", `Oturum: ${sessionContext.session_id}`, "done");
    
    // Step 2: Prefetch tools with activity events
    this._sendActivity(res, "tools_start", "Okul verileri sorgulanıyor...", "running");
    const usedTools = [];
    const toolData = this._prefetchDataWithActivity(message, authContext, usedTools, res);
    this._sendActivity(res, "tools_done", `${usedTools.length} veri kaynağı sorgulandı`, "done");

    // Step 3: Memory
    this._sendActivity(res, "memory_load", "Kullanıcı hafızası yükleniyor...", "running");
    const memoryContext = UserMemory.buildContext(authContext.user_id);
    this._sendActivity(res, "memory_load", memoryContext ? "Hafıza yüklendi" : "Hafıza boş", "done");

    // Step 4: Build messages
    this._sendActivity(res, "build_prompt", "Sistem promptu hazırlanıyor...", "running");
    const messages = this._buildMessages(message, authContext, toolData, usedTools, previousMessages, memoryContext);
    const totalChars = messages.reduce((s, m) => s + m.content.length, 0);
    this._sendActivity(res, "build_prompt", `${messages.length} mesaj, ${totalChars} karakter`, "done");

    const sessionKey = `edu:${authContext.role}:${authContext.user_id}:${agentKey}`;

    // Send tools info
    res.write(`data: ${JSON.stringify({ type: "tools", tools: usedTools })}\n\n`);

    // Step 5: Agent call
    this._sendActivity(res, "agent_connect", `${agentKey} agent'ına bağlanılıyor...`, "running");

    return new Promise((resolve, reject) => {
      const body = JSON.stringify({ model: "openclaw", messages, user: sessionKey, stream: true });
      let fullText = "";
      let firstChunk = true;
      let chunkCount = 0;

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
        this._sendActivity(res, "agent_connect", `${agentKey} bağlantısı kuruldu (HTTP ${proxyRes.statusCode})`, "done");
        this._sendActivity(res, "agent_thinking", "Agent düşünüyor...", "running");
        
        let buffer = "";

        proxyRes.on("data", chunk => {
          buffer += chunk.toString();
          const lines = buffer.split("\n");
          buffer = lines.pop();

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();
            if (data === "[DONE]") {
              // Process memory tags
              this._sendActivity(res, "memory_save", "Hafıza kontrol ediliyor...", "running");
              const { cleanResponse, saved } = UserMemory.parseAndSave(authContext.user_id, fullText);
              if (saved.length) {
                this._sendActivity(res, "memory_save", `${saved.length} hafıza kaydedildi: ${saved.map(s => s.key).join(", ")}`, "done");
                console.log(`Memory saved for user ${authContext.user_id}:`, saved.map(s => `${s.category}:${s.key}`).join(", "));
              } else {
                this._sendActivity(res, "memory_save", "Yeni hafıza kaydı yok", "done");
              }

              this._sendActivity(res, "db_save", "Mesaj veritabanına kaydediliyor...", "running");
              // done event will trigger db save in server.js
              
              this._sendActivity(res, "complete", `Tamamlandı — ${chunkCount} chunk, ${fullText.length} karakter`, "done");
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
                  this._sendActivity(res, "agent_thinking", "Agent düşünmeyi bitirdi", "done");
                  this._sendActivity(res, "agent_streaming", "Yanıt akışı başladı...", "running");
                  firstChunk = false;
                }
                fullText += delta;
                chunkCount++;
                // Update streaming activity every 10 chunks
                if (chunkCount % 10 === 0) {
                  this._sendActivity(res, "agent_streaming", `${chunkCount} chunk alındı (${fullText.length} karakter)`, "running");
                }
                if (!delta.includes("[HAFIZA_KAYDET")) {
                  res.write(`data: ${JSON.stringify({ type: "chunk", text: delta })}\n\n`);
                }
              }
            } catch {}
          }
        });

        proxyRes.on("end", () => {
          if (!fullText) {
            this._sendActivity(res, "fallback", "Agent yanıt vermedi, yedek yanıt kullanılıyor", "warning");
            const fb = this._localFallback(authContext, toolData);
            res.write(`data: ${JSON.stringify({ type: "chunk", text: fb })}\n\n`);
            res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
            res.end();
            resolve({ reply: fb, usedTools });
          }
        });

        proxyRes.on("error", err => {
          this._sendActivity(res, "error", `Agent hatası: ${err.message}`, "error");
          const fb = this._localFallback(authContext, toolData);
          res.write(`data: ${JSON.stringify({ type: "chunk", text: fb })}\n\n`);
          res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
          res.end();
          resolve({ reply: fb, usedTools });
        });
      });

      req.on("error", err => {
        this._sendActivity(res, "error", `Bağlantı hatası: ${err.message}`, "error");
        const fb = this._localFallback(authContext, toolData);
        res.write(`data: ${JSON.stringify({ type: "chunk", text: fb })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
        res.end();
        resolve({ reply: fb, usedTools });
      });

      req.on("timeout", () => { req.destroy(); });
      req.write(body);
      req.end();
    });
  }

  // Prefetch with activity events
  _prefetchDataWithActivity(message, auth, usedTools, res) {
    const msg = message.toLowerCase();
    const r = {};
    try {
      if (auth.role === "student") {
        this._sendActivity(res, "tool_call", "📋 get_self_profile — Öğrenci profili alınıyor", "running");
        r.profile = executeTool("get_self_profile", {}, auth); usedTools.push("get_self_profile");
        this._sendActivity(res, "tool_call", `✅ Profil: ${r.profile?.full_name || "alındı"}`, "done");

        if (msg.match(/sınav|sonuç|eksik|zayıf|performans|not|konu|tekrar|puan|başarı|durum/)) {
          this._sendActivity(res, "tool_call", "📊 get_self_exam_results — Sınav sonuçları sorgulanıyor", "running");
          r.exams = executeTool("get_self_exam_results", { limit: 5 }, auth); usedTools.push("get_self_exam_results");
          this._sendActivity(res, "tool_call", `✅ ${r.exams?.items?.length || 0} sınav bulundu`, "done");
          
          if (r.exams?.items?.length > 0) {
            this._sendActivity(res, "tool_call", "🎯 get_self_outcome_breakdown — Kazanım analizi yapılıyor", "running");
            r.outcomes = executeTool("get_self_outcome_breakdown", { exam_ids: r.exams.items.map(i => i.exam_id) }, auth); usedTools.push("get_self_outcome_breakdown");
            this._sendActivity(res, "tool_call", `✅ Kazanım analizi tamamlandı`, "done");
          }
        }
        if (msg.match(/ödev|görev|teslim/)) {
          this._sendActivity(res, "tool_call", "📝 get_self_assignments — Ödevler sorgulanıyor", "running");
          r.assignments = executeTool("get_self_assignments", { limit: 10 }, auth); usedTools.push("get_self_assignments");
          this._sendActivity(res, "tool_call", `✅ ${r.assignments?.items?.length || 0} ödev bulundu`, "done");
        }
        if (msg.match(/plan|çalışma|program/) && !r.exams) {
          this._sendActivity(res, "tool_call", "📊 get_self_exam_results — Çalışma planı için sınavlar", "running");
          r.exams = executeTool("get_self_exam_results", { limit: 3 }, auth); usedTools.push("get_self_exam_results");
          this._sendActivity(res, "tool_call", `✅ ${r.exams?.items?.length || 0} sınav bulundu`, "done");
          if (r.exams?.items?.length > 0) {
            this._sendActivity(res, "tool_call", "🎯 get_self_outcome_breakdown — Kazanım analizi", "running");
            r.outcomes = executeTool("get_self_outcome_breakdown", { exam_ids: r.exams.items.map(i => i.exam_id) }, auth); usedTools.push("get_self_outcome_breakdown");
            this._sendActivity(res, "tool_call", `✅ Kazanım analizi tamamlandı`, "done");
          }
        }
      } else if (auth.role === "teacher") {
        this._sendActivity(res, "tool_call", "🏫 list_teacher_classes — Sınıflar listeleniyor", "running");
        r.classes = executeTool("list_teacher_classes", {}, auth); usedTools.push("list_teacher_classes");
        this._sendActivity(res, "tool_call", `✅ ${r.classes?.classes?.length || 0} sınıf bulundu`, "done");
        
        if (r.classes?.classes?.length > 0) {
          const cid = r.classes.classes[0].class_id;
          if (msg.match(/performans|başarı|zayıf|konu|kazanım|analiz/)) {
            this._sendActivity(res, "tool_call", "🎯 get_class_outcome_breakdown — Sınıf kazanım analizi", "running");
            r.outcomes = executeTool("get_class_outcome_breakdown", { class_id: cid }, auth); usedTools.push("get_class_outcome_breakdown");
            this._sendActivity(res, "tool_call", `✅ Kazanım analizi tamamlandı`, "done");
          }
          if (msg.match(/sınav|sonuç|not/)) {
            this._sendActivity(res, "tool_call", "📊 get_class_exam_results — Sınıf sınav sonuçları", "running");
            r.examResults = executeTool("get_class_exam_results", { class_id: cid }, auth); usedTools.push("get_class_exam_results");
            this._sendActivity(res, "tool_call", `✅ Sınav sonuçları alındı`, "done");
          }
          if (msg.match(/öğrenci|liste/)) {
            this._sendActivity(res, "tool_call", "👥 list_class_students — Öğrenci listesi", "running");
            r.students = executeTool("list_class_students", { class_id: cid }, auth); usedTools.push("list_class_students");
            this._sendActivity(res, "tool_call", `✅ ${r.students?.students?.length || 0} öğrenci listelendi`, "done");
          }
        }
      } else if (auth.role === "parent") {
        this._sendActivity(res, "tool_call", "👨‍👩‍👧 list_my_children — Çocuklar listeleniyor", "running");
        r.children = executeTool("list_my_children", {}, auth); usedTools.push("list_my_children");
        this._sendActivity(res, "tool_call", `✅ ${r.children?.children?.length || 0} çocuk bulundu`, "done");
        
        if (r.children?.children?.length > 0) {
          const cid = r.children.children[0].child_id;
          this._sendActivity(res, "tool_call", "📊 get_child_exam_results — Çocuk sınav sonuçları", "running");
          r.exams = executeTool("get_child_exam_results", { child_id: cid, limit: 5 }, auth); usedTools.push("get_child_exam_results");
          this._sendActivity(res, "tool_call", `✅ ${r.exams?.items?.length || 0} sınav bulundu`, "done");
          
          this._sendActivity(res, "tool_call", "📅 get_child_attendance — Devamsızlık bilgisi", "running");
          r.attendance = executeTool("get_child_attendance", { child_id: cid }, auth); usedTools.push("get_child_attendance");
          this._sendActivity(res, "tool_call", `✅ Devamsızlık bilgisi alındı`, "done");
          
          if (msg.match(/ödev/)) {
            this._sendActivity(res, "tool_call", "📝 get_child_assignments — Çocuk ödevleri", "running");
            r.assignments = executeTool("get_child_assignments", { child_id: cid, limit: 10 }, auth); usedTools.push("get_child_assignments");
            this._sendActivity(res, "tool_call", `✅ ${r.assignments?.items?.length || 0} ödev bulundu`, "done");
          }
        }
      }
    } catch (e) { 
      this._sendActivity(res, "tool_error", `Hata: ${e.message}`, "error");
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
