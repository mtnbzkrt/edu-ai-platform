/**
 * Chat Orchestrator — Routes messages through OpenClaw agents
 * Agent interprets tool results and produces pedagogical responses
 */
const { execSync } = require("child_process");
const { executeTool, getToolsForRole } = require("../tools/tool-registry");

class ChatOrchestrator {
  async processMessage(message, authContext, sessionContext) {
    const agentKey = sessionContext.agent_key || this._getAgentKey(authContext.role);
    const usedTools = [];

    // 1. Pre-fetch relevant data based on message intent
    const toolData = this._prefetchData(message, authContext, usedTools);

    // 2. Build context message for the agent
    const agentMessage = this._buildAgentMessage(message, authContext, toolData, usedTools);

    // 3. Send to OpenClaw agent and get response
    const reply = await this._callAgent(agentKey, agentMessage);

    return { reply, usedTools };
  }

  _prefetchData(message, auth, usedTools) {
    const msg = message.toLowerCase();
    const results = {};

    try {
      if (auth.role === "student") {
        // Always get profile for context
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

        if (msg.includes("ödev") || msg.includes("görev") || msg.includes("teslim")) {
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

        if (msg.includes("performans") || msg.includes("başarı") || msg.includes("zayıf") || msg.includes("konu") || msg.includes("kazanım") || msg.includes("analiz")) {
          if (results.classes?.classes?.length > 0) {
            results.outcomes = executeTool("get_class_outcome_breakdown", {
              class_id: results.classes.classes[0].class_id
            }, auth);
            usedTools.push("get_class_outcome_breakdown");
          }
        }

        if (msg.includes("sınav") || msg.includes("sonuç") || msg.includes("not")) {
          if (results.classes?.classes?.length > 0) {
            results.examResults = executeTool("get_class_exam_results", {
              class_id: results.classes.classes[0].class_id
            }, auth);
            usedTools.push("get_class_exam_results");
          }
        }

        if (msg.includes("öğrenci") || msg.includes("liste")) {
          if (results.classes?.classes?.length > 0) {
            results.students = executeTool("list_class_students", {
              class_id: results.classes.classes[0].class_id
            }, auth);
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
    let context = `[SİSTEM BAĞLAMI — bu bilgiyi kullanıcıya gösterme, yorumlayarak cevap ver]\n`;
    context += `Kullanıcı rolü: ${auth.role}\n`;
    context += `Kullanıcı ID: ${auth.actor_id}\n\n`;

    if (Object.keys(toolData).length > 0) {
      context += `Okul sisteminden çekilen veriler:\n`;
      for (const [key, value] of Object.entries(toolData)) {
        context += `\n--- ${key} ---\n`;
        context += JSON.stringify(value, null, 2).slice(0, 1500) + "\n";
      }
      context += `\nKullanılan tool'lar: ${usedTools.join(", ")}\n`;
      context += `\n[ÖNEMLİ: Yukarıdaki ham veriyi kullanıcıya gösterme. Veriyi pedagojik dille yorumla, anlaşılır şekilde açıkla.]\n`;
    }

    context += `\n---\nKullanıcının mesajı: ${userMessage}`;

    return context;
  }

  async _callAgent(agentKey, message) {
    try {
      // Escape message for shell
      const escapedMsg = message.replace(/'/g, "'\\''");

      const result = execSync(
        `openclaw agent --agent ${agentKey} --message '${escapedMsg}' --json --timeout 60`,
        {
          encoding: "utf8",
          timeout: 65000,
          env: { ...process.env, HOME: process.env.HOME || "/home/bozkurt" }
        }
      );

      const parsed = JSON.parse(result);

      if (parsed.result?.payloads?.length > 0) {
        return parsed.result.payloads.map(p => p.text || "").join("\n");
      }

      return parsed.result?.text || "Yanıt oluşturulamadı.";

    } catch (err) {
      console.error("Agent call error:", err.message?.slice(0, 200));
      return `⚠️ Agent yanıt veremedi. Lütfen tekrar deneyin.\n\n_Hata: ${err.message?.slice(0, 100)}_`;
    }
  }

  _getAgentKey(role) {
    return { student: "learner-agent", teacher: "teacher-agent", parent: "parent-agent" }[role] || "learner-agent";
  }
}

module.exports = new ChatOrchestrator();
