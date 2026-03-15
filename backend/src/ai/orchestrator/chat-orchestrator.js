const http = require("http");
const { executeTool } = require("../tools/tool-registry");

// Docker container reaches gateway via proxy on docker0 bridge
const GATEWAY_HOST = process.env.OPENCLAW_GATEWAY_HOST || "10.0.0.1";
const GATEWAY_PORT = process.env.OPENCLAW_GATEWAY_PORT || 18790;
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || "bc433d5343886a5a34602fa85b0c91b6720e9b9f12dc80a0";

class ChatOrchestrator {
  async processMessage(message, authContext, sessionContext) {
    const agentKey = sessionContext.agent_key || this._getAgentKey(authContext.role);
    const usedTools = [];
    const toolData = this._prefetchData(message, authContext, usedTools);
    const agentMessage = this._buildAgentMessage(message, authContext, toolData, usedTools);

    let reply;
    try {
      reply = await this._callAgentHTTP(agentKey, agentMessage);
    } catch (err) {
      console.error("Agent HTTP error:", err.message);
      reply = this._localFallback(message, authContext, toolData, usedTools);
    }

    return { reply, usedTools };
  }

  _prefetchData(message, auth, usedTools) {
    const msg = message.toLowerCase();
    const r = {};
    try {
      if (auth.role === "student") {
        r.profile = executeTool("get_self_profile", {}, auth); usedTools.push("get_self_profile");
        if (msg.match(/sınav|sonuç|eksik|zayıf|performans|not|konu|tekrar/)) {
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

  _buildAgentMessage(userMessage, auth, toolData, usedTools) {
    let ctx = `[SISTEM BAGLAMI - yorumlayarak cevap ver, ham veriyi gosterme]\nRol: ${auth.role}\n`;
    for (const [k, v] of Object.entries(toolData)) {
      ctx += `--- ${k} ---\n${JSON.stringify(v, null, 2).slice(0, 1200)}\n`;
    }
    if (usedTools.length) ctx += `Kullanilan toollar: ${usedTools.join(", ")}\n`;
    ctx += `---\nKullanicinin mesaji: ${userMessage}`;
    return ctx;
  }

  _callAgentHTTP(agentKey, message) {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({
        model: "openclaw",
        messages: [{ role: "user", content: message }]
      });
      const req = http.request({
        hostname: GATEWAY_HOST, port: GATEWAY_PORT,
        path: "/v1/chat/completions",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + GATEWAY_TOKEN,
          "x-openclaw-agent-id": agentKey,
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
            else reject(new Error("No content in response"));
          } catch (e) { reject(new Error("Parse error: " + data.slice(0, 100))); }
        });
      });
      req.on("error", reject);
      req.on("timeout", () => { req.destroy(); reject(new Error("Timeout")); });
      req.write(body);
      req.end();
    });
  }

  _localFallback(message, auth, toolData, usedTools) {
    const name = toolData.profile?.full_name || toolData.children?.children?.[0]?.full_name || "";
    let r = "";
    if (auth.role === "student") {
      r = `Merhaba${name ? " " + name.split(" ")[0] : ""}! 👋\n\n`;
      if (toolData.outcomes?.outcomes?.length > 0) {
        const weak = toolData.outcomes.outcomes.filter(o => o.success_rate < 0.5);
        const mid = toolData.outcomes.outcomes.filter(o => o.success_rate >= 0.5 && o.success_rate < 0.75);
        const strong = toolData.outcomes.outcomes.filter(o => o.success_rate >= 0.75);
        if (weak.length) { r += `🔴 **Öncelikli konular:**\n`; weak.forEach((o,i) => r += `${i+1}. **${o.outcome_name}** — %${Math.round(o.success_rate*100)}\n`); r += "\n"; }
        if (mid.length) { r += `🟡 **Pekiştirmen gerekenler:**\n`; mid.forEach((o,i) => r += `${i+1}. **${o.outcome_name}** — %${Math.round(o.success_rate*100)}\n`); r += "\n"; }
        if (strong.length) { r += `🟢 **İyi olduğun konular:**\n`; strong.forEach(o => r += `- ${o.outcome_name} ✓\n`); r += "\n"; }
      }
      if (toolData.exams?.items?.length) { r += `📊 **Son sınavların:**\n`; toolData.exams.items.forEach(e => r += `- ${e.exam_name}: **${e.score}** (${e.exam_date})\n`); r += "\n"; }
      r += "💪 Bir konuyu anlatmamı veya çalışma planı hazırlamamı ister misin?\n";
    } else if (auth.role === "teacher") {
      r = `📋 **Sınıf Özeti**\n\n`;
      if (toolData.outcomes?.outcomes?.length) { toolData.outcomes.outcomes.forEach(o => { const p = Math.round(o.average_success_rate*100); r += `${p<50?"🔴":p<75?"🟡":"🟢"} ${o.outcome_name}: %${p}\n`; }); }
    } else if (auth.role === "parent") {
      r = `👋 Merhaba!\n\n`;
      if (toolData.exams?.items?.length) { r += `📊 **Sınav sonuçları:**\n`; toolData.exams.items.forEach(e => r += `- ${e.exam_name}: **${e.score}** (${e.exam_date})\n`); r += "\n"; }
      if (toolData.attendance) r += `📅 **Devamsızlık:** ${toolData.attendance.summary.absent_days} gün\n`;
    }
    return r || "Merhaba! Size nasıl yardımcı olabilirim?";
  }

  _getAgentKey(role) {
    return { student: "learner-agent", teacher: "teacher-agent", parent: "parent-agent" }[role] || "learner-agent";
  }
}

module.exports = new ChatOrchestrator();
