/**
 * Chat Orchestrator
 * Routes messages to the correct agent and executes tools locally.
 * In production, this would route through OpenClaw agents.
 * For the test platform, it executes tools and returns structured data.
 */
const { executeTool, getToolsForRole } = require("../tools/tool-registry");

class ChatOrchestrator {
  async processMessage(message, authContext, sessionContext) {
    const agentKey = sessionContext.agent_key || this._getAgentKey(authContext.role);
    const usedTools = [];
    const msg = message.toLowerCase();

    // Detect intent and execute relevant tools
    const toolResults = [];

    if (authContext.role === "student") {
      toolResults.push(...await this._handleStudentIntent(msg, authContext, usedTools));
    } else if (authContext.role === "teacher") {
      toolResults.push(...await this._handleTeacherIntent(msg, authContext, usedTools));
    } else if (authContext.role === "parent") {
      toolResults.push(...await this._handleParentIntent(msg, authContext, usedTools));
    }

    // Format response — in production OpenClaw agent interprets this data
    // For test platform, we return tool results as structured response
    const reply = this._formatResponse(message, authContext, toolResults, usedTools, agentKey);

    return { reply, usedTools };
  }

  async _handleStudentIntent(msg, auth, usedTools) {
    const results = [];

    // Profile
    if (msg.includes("profil") || msg.includes("kimim") || msg.includes("bilgi")) {
      const r = executeTool("get_self_profile", {}, auth);
      usedTools.push("get_self_profile");
      results.push({ tool: "get_self_profile", data: r });
    }

    // Exam results / weak topics / performance
    if (msg.includes("sınav") || msg.includes("sonuç") || msg.includes("eksik") || msg.includes("zayıf") || msg.includes("performans") || msg.includes("not")) {
      const r = executeTool("get_self_exam_results", { limit: 5 }, auth);
      usedTools.push("get_self_exam_results");
      results.push({ tool: "get_self_exam_results", data: r });

      // Auto-fetch outcome breakdown
      if (r.items?.length > 0) {
        const examIds = r.items.map(i => i.exam_id);
        const ob = executeTool("get_self_outcome_breakdown", { exam_ids: examIds }, auth);
        usedTools.push("get_self_outcome_breakdown");
        results.push({ tool: "get_self_outcome_breakdown", data: ob });
      }
    }

    // Assignments
    if (msg.includes("ödev") || msg.includes("görev") || msg.includes("teslim")) {
      const r = executeTool("get_self_assignments", { limit: 10 }, auth);
      usedTools.push("get_self_assignments");
      results.push({ tool: "get_self_assignments", data: r });
    }

    // Study plan
    if (msg.includes("plan") || msg.includes("çalışma") || msg.includes("program")) {
      const r = executeTool("get_self_exam_results", { limit: 3 }, auth);
      usedTools.push("get_self_exam_results");
      results.push({ tool: "get_self_exam_results", data: r });

      if (r.items?.length > 0) {
        const ob = executeTool("get_self_outcome_breakdown", { exam_ids: r.items.map(i => i.exam_id) }, auth);
        usedTools.push("get_self_outcome_breakdown");
        results.push({ tool: "get_self_outcome_breakdown", data: ob });
      }
    }

    // Topic explanation — no tool needed
    if (msg.includes("anlat") || msg.includes("açıkla") || msg.includes("öğret") || msg.includes("ders")) {
      // Content generation - no tool call, agent handles directly
    }

    // Default: at least get profile
    if (results.length === 0 && !msg.includes("anlat") && !msg.includes("açıkla") && !msg.includes("merhaba") && !msg.includes("selam")) {
      const r = executeTool("get_self_profile", {}, auth);
      usedTools.push("get_self_profile");
      results.push({ tool: "get_self_profile", data: r });
    }

    return results;
  }

  async _handleTeacherIntent(msg, auth, usedTools) {
    const results = [];

    // List classes
    if (msg.includes("sınıf") || msg.includes("liste") || msg.includes("öğrenci")) {
      const r = executeTool("list_teacher_classes", {}, auth);
      usedTools.push("list_teacher_classes");
      results.push({ tool: "list_teacher_classes", data: r });

      // If asking about students, also list first class's students
      if (msg.includes("öğrenci") && r.classes?.length > 0) {
        const students = executeTool("list_class_students", { class_id: r.classes[0].class_id }, auth);
        usedTools.push("list_class_students");
        results.push({ tool: "list_class_students", data: students });
      }
    }

    // Class performance
    if (msg.includes("performans") || msg.includes("başarı") || msg.includes("zayıf") || msg.includes("konu") || msg.includes("kazanım")) {
      const classes = executeTool("list_teacher_classes", {}, auth);
      usedTools.push("list_teacher_classes");
      if (classes.classes?.length > 0) {
        const ob = executeTool("get_class_outcome_breakdown", { class_id: classes.classes[0].class_id }, auth);
        usedTools.push("get_class_outcome_breakdown");
        results.push({ tool: "get_class_outcome_breakdown", data: ob });
      }
    }

    // Exam results
    if (msg.includes("sınav") || msg.includes("sonuç") || msg.includes("not")) {
      const classes = executeTool("list_teacher_classes", {}, auth);
      usedTools.push("list_teacher_classes");
      if (classes.classes?.length > 0) {
        const er = executeTool("get_class_exam_results", { class_id: classes.classes[0].class_id }, auth);
        usedTools.push("get_class_exam_results");
        results.push({ tool: "get_class_exam_results", data: er });
      }
    }

    if (results.length === 0) {
      const r = executeTool("list_teacher_classes", {}, auth);
      usedTools.push("list_teacher_classes");
      results.push({ tool: "list_teacher_classes", data: r });
    }

    return results;
  }

  async _handleParentIntent(msg, auth, usedTools) {
    const results = [];

    // List children first
    const children = executeTool("list_my_children", {}, auth);
    usedTools.push("list_my_children");
    results.push({ tool: "list_my_children", data: children });

    if (children.children?.length > 0) {
      const childId = children.children[0].child_id;

      if (msg.includes("sınav") || msg.includes("not") || msg.includes("durum") || msg.includes("nasıl")) {
        const er = executeTool("get_child_exam_results", { child_id: childId, limit: 5 }, auth);
        usedTools.push("get_child_exam_results");
        results.push({ tool: "get_child_exam_results", data: er });
      }

      if (msg.includes("ödev") || msg.includes("görev")) {
        const a = executeTool("get_child_assignments", { child_id: childId, limit: 10 }, auth);
        usedTools.push("get_child_assignments");
        results.push({ tool: "get_child_assignments", data: a });
      }

      if (msg.includes("devam") || msg.includes("yoklama") || msg.includes("gelmemiş")) {
        const att = executeTool("get_child_attendance", { child_id: childId }, auth);
        usedTools.push("get_child_attendance");
        results.push({ tool: "get_child_attendance", data: att });
      }

      // General status
      if (!msg.includes("sınav") && !msg.includes("ödev") && !msg.includes("devam")) {
        const er = executeTool("get_child_exam_results", { child_id: childId, limit: 3 }, auth);
        usedTools.push("get_child_exam_results");
        results.push({ tool: "get_child_exam_results", data: er });

        const att = executeTool("get_child_attendance", { child_id: childId }, auth);
        usedTools.push("get_child_attendance");
        results.push({ tool: "get_child_attendance", data: att });
      }
    }

    return results;
  }

  _formatResponse(message, auth, toolResults, usedTools, agentKey) {
    // This is the TEST PLATFORM response formatter
    // In production, OpenClaw agent would interpret tool results via Claude
    
    let response = "";

    if (toolResults.length === 0) {
      response = `Merhaba! Ben ${agentKey === 'learner-agent' ? 'öğrenci' : agentKey === 'teacher-agent' ? 'öğretmen' : 'veli'} asistanınım. Size nasıl yardımcı olabilirim?\n\n`;
      response += `Kullanılabilir tool'lar: ${getToolsForRole(auth.role).join(', ')}`;
      return response;
    }

    response = `📊 **Tool Sonuçları** (${agentKey})\n\n`;

    for (const tr of toolResults) {
      response += `🔧 **${tr.tool}**\n`;
      response += "```json\n" + JSON.stringify(tr.data, null, 2).slice(0, 800) + "\n```\n\n";
    }

    response += `\n_Bu test platformu çıktısıdır. Gerçek sistemde OpenClaw ${agentKey} bu veriyi yorumlayarak pedagojik cevap üretir._`;

    return response;
  }

  _getAgentKey(role) {
    return { student: "learner-agent", teacher: "teacher-agent", parent: "parent-agent" }[role] || "learner-agent";
  }
}

module.exports = new ChatOrchestrator();
