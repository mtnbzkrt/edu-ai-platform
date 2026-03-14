/**
 * Chat Orchestrator — Routes messages through OpenClaw agents
 */
const { execSync, spawnSync } = require("child_process");
const { executeTool, getToolsForRole } = require("../tools/tool-registry");
const fs = require("fs");
const path = require("path");
const os = require("os");

class ChatOrchestrator {
  async processMessage(message, authContext, sessionContext) {
    const agentKey = sessionContext.agent_key || this._getAgentKey(authContext.role);
    const usedTools = [];

    // 1. Pre-fetch relevant data
    const toolData = this._prefetchData(message, authContext, usedTools);

    // 2. Build context message
    const agentMessage = this._buildAgentMessage(message, authContext, toolData, usedTools);

    // 3. Call OpenClaw agent
    const reply = await this._callAgent(agentKey, agentMessage);

    return { reply, usedTools };
  }

  _prefetchData(message, auth, usedTools) {
    const msg = message.toLowerCase();
    const results = {};

    try {
      if (auth.role === "student") {
        results.profile = executeTool("get_self_profile", {}, auth);
        usedTools.push("get_self_profile");

        if (msg.includes("sınav") || msg.includes("sonuç") || msg.includes("eksik") || msg.includes("zayıf") || msg.includes("performans") || msg.includes("not") || msg.includes("konu")) {
          results.exams = executeTool("get_self_exam_results", { limit: 5 }, auth);
          usedTools.push("get_self_exam_results");
          if (results.exams?.items?.length > 0) {
            results.outcomes = executeTool("get_self_outcome_breakdown", {
              exam_ids: results.exams.items.map(i => i.exam_id)
            }, auth);
            usedTools.push("get_self_outcome_breakdown");
          }
        }

        if (msg.includes("ödev") || msg.includes("görev")) {
          results.assignments = executeTool("get_self_assignments", { limit: 10 }, auth);
          usedTools.push("get_self_assignments");
        }

        if (msg.includes("plan") || msg.includes("çalışma") || msg.includes("program")) {
          if (!results.exams) {
            results.exams = executeTool("get_self_exam_results", { limit: 3 }, auth);
            usedTools.push("get_self_exam_results");
          }
          if (!results.outcomes && results.exams?.items?.length > 0) {
            results.outcomes = executeTool("get_self_outcome_breakdown", {
              exam_ids: results.exams.items.map(i => i.exam_id)
            }, auth);
            usedTools.push("get_self_outcome_breakdown");
          }
        }

      } else if (auth.role === "teacher") {
        results.classes = executeTool("list_teacher_classes", {}, auth);
        usedTools.push("list_teacher_classes");

        if (results.classes?.classes?.length > 0) {
          const classId = results.classes.classes[0].class_id;
          if (msg.includes("performans") || msg.includes("başarı") || msg.includes("zayıf") || msg.includes("konu") || msg.includes("analiz")) {
            results.outcomes = executeTool("get_class_outcome_breakdown", { class_id: classId }, auth);
            usedTools.push("get_class_outcome_breakdown");
          }
          if (msg.includes("sınav") || msg.includes("sonuç") || msg.includes("not")) {
            results.examResults = executeTool("get_class_exam_results", { class_id: classId }, auth);
            usedTools.push("get_class_exam_results");
          }
          if (msg.includes("öğrenci") || msg.includes("liste")) {
            results.students = executeTool("list_class_students", { class_id: classId }, auth);
            usedTools.push("list_class_students");
          }
        }

      } else if (auth.role === "parent") {
        results.children = executeTool("list_my_children", {}, auth);
        usedTools.push("list_my_children");

        if (results.children?.children?.length > 0) {
          const childId = results.children.children[0].child_id;
          results.exams = executeTool("get_child_exam_results", { child_id: childId, limit: 5 }, auth);
          usedTools.push("get_child_exam_results");
          results.attendance = executeTool("get_child_attendance", { child_id: childId }, auth);
          usedTools.push("get_child_attendance");
          if (msg.includes("ödev")) {
            results.assignments = executeTool("get_child_assignments", { child_id: childId, limit: 10 }, auth);
            usedTools.push("get_child_assignments");
          }
        }
      }
    } catch (e) {
      console.error("Tool prefetch error:", e.message);
    }

    return results;
  }

  _buildAgentMessage(userMessage, auth, toolData, usedTools) {
    let ctx = `[SISTEM BAGLAMI - bu bilgiyi kullaniciya gosterme, yorumlayarak cevap ver]\n`;
    ctx += `Kullanici rolu: ${auth.role}\n`;

    if (Object.keys(toolData).length > 0) {
      ctx += `Okul sisteminden cekilen veriler:\n`;
      for (const [key, value] of Object.entries(toolData)) {
        ctx += `\n--- ${key} ---\n`;
        ctx += JSON.stringify(value, null, 2).slice(0, 1200) + "\n";
      }
      ctx += `\nKullanilan toollar: ${usedTools.join(", ")}\n`;
      ctx += `[ONEMLI: Ham veriyi gosterme. Pedagojik dille yorumla.]\n`;
    }

    ctx += `\n---\nKullanicinin mesaji: ${userMessage}`;
    return ctx;
  }

  async _callAgent(agentKey, message) {
    try {
      // Write message to temp file to avoid shell escaping issues
      const tmpFile = path.join(os.tmpdir(), `agent-msg-${Date.now()}.txt`);
      fs.writeFileSync(tmpFile, message, "utf8");

      const result = spawnSync("openclaw", [
        "agent",
        "--agent", agentKey,
        "--message", fs.readFileSync(tmpFile, "utf8"),
        "--json",
        "--timeout", "60"
      ], {
        encoding: "utf8",
        timeout: 65000,
        env: { ...process.env },
        maxBuffer: 1024 * 1024 * 5
      });

      // Clean up
      try { fs.unlinkSync(tmpFile); } catch {}

      if (result.error) {
        throw result.error;
      }

      const stdout = result.stdout || "";
      
      // Find JSON in output (skip any non-JSON prefix)
      const jsonStart = stdout.indexOf("{");
      if (jsonStart === -1) {
        console.error("Agent stdout:", stdout.slice(0, 200));
        console.error("Agent stderr:", (result.stderr || "").slice(0, 200));
        throw new Error("No JSON in agent output");
      }

      const parsed = JSON.parse(stdout.slice(jsonStart));

      if (parsed.result?.payloads?.length > 0) {
        return parsed.result.payloads.map(p => p.text || "").join("\n");
      }

      return parsed.result?.text || "Yanit olusturulamadi.";

    } catch (err) {
      console.error("Agent call error:", err.message?.slice(0, 300));
      return `Bir hata olustu, lutfen tekrar deneyin.`;
    }
  }

  _getAgentKey(role) {
    return { student: "learner-agent", teacher: "teacher-agent", parent: "parent-agent" }[role] || "learner-agent";
  }
}

module.exports = new ChatOrchestrator();
