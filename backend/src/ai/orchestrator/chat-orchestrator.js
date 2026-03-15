const http = require("http");
const { executeTool } = require("../tools/tool-registry");
const UserMemory = require("../memory/user-memory");

const GATEWAY_HOST = process.env.OPENCLAW_GATEWAY_HOST || "10.0.0.1";
const GATEWAY_PORT = process.env.OPENCLAW_GATEWAY_PORT || 18790;
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || "bc433d5343886a5a34602fa85b0c91b6720e9b9f12dc80a0";

class ChatOrchestrator {
  async processMessage(message, authContext, sessionContext, previousMessages) {
    const agentKey = sessionContext.agent_key || this._getAgentKey(authContext.role);
    const usedTools = [];
    const toolData = this._prefetchData(message, authContext, usedTools);

    // Load user memory
    const memoryContext = UserMemory.buildContext(authContext.userId);

    // Build messages with memory + tool data + history
    const messages = this._buildMessages(message, authContext, toolData, usedTools, previousMessages, memoryContext);
    const sessionKey = `edu:${authContext.role}:${authContext.userId}:${agentKey}`;

    let reply;
    try {
      reply = await this._callAgentHTTP(agentKey, sessionKey, messages);
    } catch (err) {
      console.error("Agent HTTP error:", err.message);
      reply = this._localFallback(message, authContext, toolData, usedTools);
    }

    // Parse and save any memory commands from agent response
    const { cleanResponse, saved } = UserMemory.parseAndSave(authContext.userId, reply);
    if (saved.length > 0) {
      console.log(`Memory saved for user ${authContext.userId}:`, saved.map(s => `${s.category}:${s.key}`).join(", "));
    }

    return { reply: cleanResponse, usedTools };
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

    let sys = `Sen bir egitim AI asistanisin. Kullanici rolu: ${auth.role}.\n`;
    sys += `Turkce konusuyorsun. Pedagojik dil kullan, cesaretlendirici ol.\n`;
    sys += `Ham veriyi gosterme, yorumlayarak acikla.\n\n`;

    // Memory instructions
    sys += `HAFIZA SISTEMI:\n`;
    sys += `Kullanici hakkinda onemli bilgiler ogrendiginde (tercihler, ogrenme stili, hedefler, kisilik) bunlari kaydetmek icin yanitinin SONUNA su formatta etiket ekle:\n`;
    sys += `[HAFIZA_KAYDET:kategori:anahtar:deger]\n`;
    sys += `Kategoriler: preferences, learning_style, strengths, weaknesses, goals, notes, personality\n`;
    sys += `Ornekler:\n`;
    sys += `[HAFIZA_KAYDET:learning_style:anlatim_tercihi:gorsel ogrenmeyi tercih ediyor]\n`;
    sys += `[HAFIZA_KAYDET:preferences:ders_sirasi:once matematik sonra fen istiyor]\n`;
    sys += `[HAFIZA_KAYDET:personality:iletisim:utangac, cesaretlendirme lazim]\n`;
    sys += `[HAFIZA_KAYDET:goals:hedef:donem sonu matematik 80 uzeri]\n`;
    sys += `Bu etiketler kullaniciya gosterilmez, sadece hafizaya kaydedilir.\n`;

    // Include existing memories
    if (memoryContext) {
      sys += memoryContext;
    }

    // Tool data
    if (Object.keys(toolData).length > 0) {
      sys += `\nOkul sisteminden alinan guncel veriler:\n`;
      for (const [k, v] of Object.entries(toolData)) {
        sys += `--- ${k} ---\n${JSON.stringify(v, null, 2).slice(0, 1500)}\n`;
      }
    }

    messages.push({ role: "system", content: sys });

    // Previous messages
    if (previousMessages?.length > 0) {
      for (const msg of previousMessages.slice(-10)) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    messages.push({ role: "user", content: userMessage });
    return messages;
  }

  _callAgentHTTP(agentKey, sessionKey, messages) {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({ model: "openclaw", messages, user: sessionKey });
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
        timeout: 90000
      }, res => {
        let data = "";
        res.on("data", c => data += c);
        res.on("end", () => {
          try {
            const d = JSON.parse(data);
            const content = d.choices?.[0]?.message?.content;
            if (content) resolve(content);
            else reject(new Error("No content: " + data.slice(0, 200)));
          } catch (e) { reject(new Error("Parse: " + data.slice(0, 100))); }
        });
      });
      req.on("error", reject);
      req.on("timeout", () => { req.destroy(); reject(new Error("Timeout")); });
      req.write(body);
      req.end();
    });
  }

  _localFallback(message, auth, toolData) {
    const name = toolData.profile?.full_name || "";
    let r = `Merhaba${name ? " " + name.split(" ")[0] : ""}! 👋\n\n`;
    if (toolData.outcomes?.outcomes?.length) {
      const weak = toolData.outcomes.outcomes.filter(o => o.success_rate < 0.5);
      const mid = toolData.outcomes.outcomes.filter(o => o.success_rate >= 0.5 && o.success_rate < 0.75);
      if (weak.length) { r += `🔴 **Öncelikli konular:**\n`; weak.forEach((o,i) => r += `${i+1}. **${o.outcome_name}** — %${Math.round(o.success_rate*100)}\n`); r += "\n"; }
      if (mid.length) { r += `🟡 **Pekiştirmen gerekenler:**\n`; mid.forEach((o,i) => r += `${i+1}. **${o.outcome_name}** — %${Math.round(o.success_rate*100)}\n`); r += "\n"; }
    }
    if (toolData.exams?.items?.length) { r += `📊 **Son sınavların:**\n`; toolData.exams.items.forEach(e => r += `- ${e.exam_name}: **${e.score}** (${e.exam_date})\n`); }
    return r || "Merhaba! Size nasıl yardımcı olabilirim?";
  }

  _getAgentKey(role) {
    return { student: "learner-agent", teacher: "teacher-agent", parent: "parent-agent" }[role] || "learner-agent";
  }
}

module.exports = new ChatOrchestrator();
