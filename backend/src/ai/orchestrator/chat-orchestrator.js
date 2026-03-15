const { spawnSync } = require("child_process");
const { executeTool, getToolsForRole } = require("../tools/tool-registry");
const http = require("http");
const https = require("https");

const GATEWAY_URL = process.env.OPENCLAW_GATEWAY || "http://10.0.0.1:18789";
const GATEWAY_TOKEN = process.env.OPENCLAW_TOKEN || "bc433d5343886a5a34602fa85b0c91b6720e9b9f12dc80a0";

class ChatOrchestrator {
  async processMessage(message, authContext, sessionContext) {
    const agentKey = sessionContext.agent_key || this._getAgentKey(authContext.role);
    const usedTools = [];
    const toolData = this._prefetchData(message, authContext, usedTools);
    const agentMessage = this._buildAgentMessage(message, authContext, toolData, usedTools);

    // Try OpenClaw CLI first, then gateway HTTP, then local fallback
    let reply;
    try {
      reply = this._callAgentCLI(agentKey, agentMessage);
    } catch (e1) {
      console.log("CLI failed, trying gateway...");
      try {
        reply = await this._callAgentGateway(agentKey, agentMessage);
      } catch (e2) {
        console.log("Gateway failed, using local fallback");
        reply = this._localFallback(message, authContext, toolData, usedTools, agentKey);
      }
    }

    return { reply, usedTools };
  }

  _prefetchData(message, auth, usedTools) {
    const msg = message.toLowerCase();
    const results = {};
    try {
      if (auth.role === "student") {
        results.profile = executeTool("get_self_profile", {}, auth);
        usedTools.push("get_self_profile");
        if (msg.match(/sınav|sonuç|eksik|zayıf|performans|not|konu|tekrar/)) {
          results.exams = executeTool("get_self_exam_results", { limit: 5 }, auth);
          usedTools.push("get_self_exam_results");
          if (results.exams?.items?.length > 0) {
            results.outcomes = executeTool("get_self_outcome_breakdown", { exam_ids: results.exams.items.map(i => i.exam_id) }, auth);
            usedTools.push("get_self_outcome_breakdown");
          }
        }
        if (msg.match(/ödev|görev|teslim/)) {
          results.assignments = executeTool("get_self_assignments", { limit: 10 }, auth);
          usedTools.push("get_self_assignments");
        }
        if (msg.match(/plan|çalışma|program/)) {
          if (!results.exams) { results.exams = executeTool("get_self_exam_results", { limit: 3 }, auth); usedTools.push("get_self_exam_results"); }
          if (!results.outcomes && results.exams?.items?.length > 0) { results.outcomes = executeTool("get_self_outcome_breakdown", { exam_ids: results.exams.items.map(i => i.exam_id) }, auth); usedTools.push("get_self_outcome_breakdown"); }
        }
      } else if (auth.role === "teacher") {
        results.classes = executeTool("list_teacher_classes", {}, auth);
        usedTools.push("list_teacher_classes");
        if (results.classes?.classes?.length > 0) {
          const cid = results.classes.classes[0].class_id;
          if (msg.match(/performans|başarı|zayıf|konu|kazanım|analiz/)) { results.outcomes = executeTool("get_class_outcome_breakdown", { class_id: cid }, auth); usedTools.push("get_class_outcome_breakdown"); }
          if (msg.match(/sınav|sonuç|not/)) { results.examResults = executeTool("get_class_exam_results", { class_id: cid }, auth); usedTools.push("get_class_exam_results"); }
          if (msg.match(/öğrenci|liste/)) { results.students = executeTool("list_class_students", { class_id: cid }, auth); usedTools.push("list_class_students"); }
        }
      } else if (auth.role === "parent") {
        results.children = executeTool("list_my_children", {}, auth);
        usedTools.push("list_my_children");
        if (results.children?.children?.length > 0) {
          const cid = results.children.children[0].child_id;
          results.exams = executeTool("get_child_exam_results", { child_id: cid, limit: 5 }, auth);
          usedTools.push("get_child_exam_results");
          results.attendance = executeTool("get_child_attendance", { child_id: cid }, auth);
          usedTools.push("get_child_attendance");
          if (msg.match(/ödev/)) { results.assignments = executeTool("get_child_assignments", { child_id: cid, limit: 10 }, auth); usedTools.push("get_child_assignments"); }
        }
      }
    } catch (e) { console.error("Prefetch error:", e.message); }
    return results;
  }

  _buildAgentMessage(userMessage, auth, toolData, usedTools) {
    let ctx = `[SISTEM BAGLAMI]\nRol: ${auth.role}\n`;
    if (Object.keys(toolData).length > 0) {
      ctx += `Veriler:\n`;
      for (const [k, v] of Object.entries(toolData)) {
        ctx += `--- ${k} ---\n${JSON.stringify(v, null, 2).slice(0, 1200)}\n`;
      }
      ctx += `Toollar: ${usedTools.join(", ")}\n[Ham veriyi gosterme, pedagojik yorumla.]\n`;
    }
    ctx += `---\nMesaj: ${userMessage}`;
    return ctx;
  }

  _callAgentCLI(agentKey, message) {
    const r = spawnSync("openclaw", ["agent", "--agent", agentKey, "--message", message, "--json", "--timeout", "60"], {
      encoding: "utf8", timeout: 65000, maxBuffer: 5 * 1024 * 1024
    });
    if (r.error) throw r.error;
    if (r.status !== 0) throw new Error(r.stderr?.slice(0, 200) || "CLI failed");
    const json = r.stdout.slice(r.stdout.indexOf("{"));
    const parsed = JSON.parse(json);
    if (parsed.result?.payloads?.length > 0) return parsed.result.payloads.map(p => p.text || "").join("\n");
    return parsed.result?.text || "Yanit olusamadi.";
  }

  async _callAgentGateway(agentKey, message) {
    // Call OpenClaw gateway HTTP API
    return new Promise((resolve, reject) => {
      const url = new URL(GATEWAY_URL);
      const postData = JSON.stringify({ agent: agentKey, message, json: true });
      const opts = {
        hostname: url.hostname, port: url.port, path: "/api/agent",
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + GATEWAY_TOKEN, "Content-Length": Buffer.byteLength(postData) },
        timeout: 60000
      };
      const req = http.request(opts, res => {
        let body = "";
        res.on("data", c => body += c);
        res.on("end", () => {
          try {
            const d = JSON.parse(body);
            if (d.result?.payloads?.length > 0) resolve(d.result.payloads.map(p => p.text || "").join("\n"));
            else reject(new Error("No payload"));
          } catch { reject(new Error("Parse failed")); }
        });
      });
      req.on("error", reject);
      req.on("timeout", () => { req.destroy(); reject(new Error("Timeout")); });
      req.write(postData);
      req.end();
    });
  }

  _localFallback(message, auth, toolData, usedTools, agentKey) {
    // Intelligent local formatting when no AI available
    const name = toolData.profile?.full_name || toolData.children?.children?.[0]?.full_name || "";
    let r = "";

    if (auth.role === "student") {
      r = `Merhaba${name ? " " + name.split(" ")[0] : ""}! 👋\n\n`;

      if (toolData.outcomes?.outcomes?.length > 0) {
        const weak = toolData.outcomes.outcomes.filter(o => o.success_rate < 0.5);
        const mid = toolData.outcomes.outcomes.filter(o => o.success_rate >= 0.5 && o.success_rate < 0.75);
        const strong = toolData.outcomes.outcomes.filter(o => o.success_rate >= 0.75);

        if (weak.length > 0) {
          r += `🔴 **Öncelikli çalışman gereken konular:**\n`;
          weak.forEach((o, i) => r += `${i + 1}. **${o.outcome_name}** — Başarı: %${Math.round(o.success_rate * 100)}\n`);
          r += "\n";
        }
        if (mid.length > 0) {
          r += `🟡 **Pekiştirmen gereken konular:**\n`;
          mid.forEach((o, i) => r += `${i + 1}. **${o.outcome_name}** — Başarı: %${Math.round(o.success_rate * 100)}\n`);
          r += "\n";
        }
        if (strong.length > 0) {
          r += `🟢 **İyi olduğun konular:**\n`;
          strong.forEach(o => r += `- ${o.outcome_name} ✓\n`);
          r += "\n";
        }
      }

      if (toolData.exams?.items?.length > 0) {
        r += `📊 **Son sınav sonuçların:**\n`;
        toolData.exams.items.forEach(e => r += `- ${e.exam_name}: **${e.score}/${e.max_score || 100}** (${e.exam_date})\n`);
        r += "\n";
      }

      if (toolData.assignments?.items?.length > 0) {
        const pending = toolData.assignments.items.filter(a => a.status === "pending");
        if (pending.length > 0) {
          r += `📝 **Bekleyen ödevlerin:** ${pending.length} adet\n`;
          pending.forEach(a => r += `- ${a.title} (son: ${a.due_date})\n`);
          r += "\n";
        }
      }

      if (!r.includes("🔴") && !r.includes("📊")) {
        r += "Sana nasıl yardımcı olabilirim? Sınav sonuçlarını yorumlayabilir, eksik konularını bulabilir veya çalışma planı hazırlayabilirim.\n";
      } else {
        r += "💪 Eksik konulara odaklanarak kısa sürede ilerleme kaydedebilirsin! Bir konuyu anlatmamı veya çalışma planı hazırlamamı ister misin?\n";
      }

    } else if (auth.role === "teacher") {
      r = `📋 **Sınıf Özeti**\n\n`;
      if (toolData.classes?.classes?.length > 0) {
        r += `Sınıflarınız: ${toolData.classes.classes.map(c => c.name).join(", ")}\n\n`;
      }
      if (toolData.outcomes?.outcomes?.length > 0) {
        r += `**Konu Bazlı Performans:**\n`;
        toolData.outcomes.outcomes.forEach(o => {
          const pct = Math.round(o.average_success_rate * 100);
          const icon = pct < 50 ? "🔴" : pct < 75 ? "🟡" : "🟢";
          r += `${icon} ${o.outcome_name}: %${pct}\n`;
        });
      }
      if (toolData.examResults?.items?.length > 0) {
        r += `\n**Son Sınav Sonuçları:**\n`;
        toolData.examResults.items.slice(0, 10).forEach(e => r += `- ${e.student_name}: ${e.score}\n`);
      }

    } else if (auth.role === "parent") {
      const child = toolData.children?.children?.[0];
      r = `👋 Merhaba!\n\n`;
      if (child) r += `**${child.full_name}** (${child.grade_level}. sınıf) hakkında bilgiler:\n\n`;
      if (toolData.exams?.items?.length > 0) {
        r += `📊 **Son sınav sonuçları:**\n`;
        toolData.exams.items.forEach(e => r += `- ${e.exam_name}: **${e.score}** (${e.exam_date})\n`);
        r += "\n";
      }
      if (toolData.attendance) {
        r += `📅 **Bu ay devamsızlık:** ${toolData.attendance.summary.absent_days} gün, ${toolData.attendance.summary.late_days} geç kalma\n\n`;
      }
    }

    return r || "Merhaba! Size nasıl yardımcı olabilirim?";
  }

  _getAgentKey(role) {
    return { student: "learner-agent", teacher: "teacher-agent", parent: "parent-agent" }[role] || "learner-agent";
  }
}

module.exports = new ChatOrchestrator();
