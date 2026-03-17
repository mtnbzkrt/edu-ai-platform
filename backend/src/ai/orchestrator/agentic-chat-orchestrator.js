const http = require("http");
const jwt = require("jsonwebtoken");
const UserMemory = require("../memory/user-memory");
const { executeTool, getToolsForRole } = require("../tools/tool-registry");
const { buildAuthContext } = require("../context/auth-context");

const GATEWAY_HOST = process.env.OPENCLAW_GATEWAY_HOST || "10.0.0.1";
const GATEWAY_PORT = process.env.OPENCLAW_GATEWAY_PORT || 18790;
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || "bc433d5343886a5a34602fa85b0c91b6720e9b9f12dc80a0";

// Agent mapping based on role
const ROLE_AGENT_MAP = {
  student: "learner-agent",
  teacher: "teacher-agent",
  parent: "parent-agent"
};

class AgenticChatOrchestrator {

  // ── Build system prompt with tool descriptions ──
  _buildSystemPrompt(authContext) {
    const memoryContext = UserMemory.buildContext(authContext.user_id);
    const availableTools = getToolsForRole(authContext.role);

    // Tool descriptions for this role
    const toolDescriptions = this._getToolDescriptions(authContext.role);

    return `Sen bir eğitim AI asistanısın.
Kullanıcı: ${authContext.full_name || "Bilinmiyor"} (rol: ${authContext.role})

## Dil ve Üslup
Türkçe konuş. Pedagojik dil kullan, cesaretlendirici ol.
Ham veriyi gösterme, yorumlayarak açıkla.

## VERİ ERİŞİMİ - ÖNEMLİ!
Kullanıcının sorularını yanıtlamak için gerçek okul verisine erişmen gerekebilir.
Aşağıdaki tool'ları kullanabilirsin:

${toolDescriptions}

## Tool Çağırma Formatı
Veri gerektiğinde yanıtının BAŞINDA şu formatı kullan:
[TOOL_CALL:tool_name:params]
Örnek: [TOOL_CALL:get_self_exam_results:{"limit":5}]
Örnek: [TOOL_CALL:get_self_profile:{}]

## ÖNEMLİ KURALLAR
- ASLA veri uydurma, her zaman tool ile gerçek veriyi al
- Tool çağırdıktan sonra cevabını bekle, sistem sana veriyi sağlayacak
- Veriye dayalı analiz yaparken detaylı yorumla
- Öğrenciyi cesaretlendir ama dürüst ol

## Hafıza Sistemi
Kullanıcı hakkında önemli bilgiler öğrendiğinde yanıtının SONUNA etiket ekle:
[HAFIZA_KAYDET:kategori:anahtar:değer]
${memoryContext}`;
  }

  // ── Get tool descriptions for a role ──
  _getToolDescriptions(role) {
    const descriptions = {
      student: `
• get_self_profile - Kendi profil bilgilerini al (ad, sınıf, bölüm)
• get_self_exam_results - Sınav sonuçlarını al (limit parametresi ile)
• get_self_assignments - Ödev bilgilerini al 
• get_self_outcome_breakdown - Kazanım bazlı başarı analizini al`,
      
      teacher: `
• list_teacher_classes - Kendi sınıflarınızı listele
• get_class_summary - Belirli sınıfın genel durumunu al (class_id gerekir)
• get_class_students - Sınıf öğrenci listesini al (class_id gerekir)
• get_student_details - Öğrenci detaylarını al (student_id gerekir)`,
      
      parent: `
• list_my_children - Çocuklarınızın listesini al
• get_child_overview - Çocuğun genel durumunu al (student_id gerekir)
• get_child_attendance - Devamsızlık bilgilerini al (student_id gerekir)`
    };
    
    return descriptions[role] || "• Henüz tool tanımlı değil";
  }

  // ── Parse tool calls from agent response ──
  _parseToolCalls(text) {
    const toolCallRegex = /\[TOOL_CALL:(\w+):(\{.*?\})\]/g;
    const calls = [];
    let match;
    
    while ((match = toolCallRegex.exec(text)) !== null) {
      try {
        const toolName = match[1];
        const params = JSON.parse(match[2]);
        calls.push({ tool: toolName, params });
      } catch (err) {
        console.error("Tool call parse error:", match, err.message);
      }
    }
    
    return calls;
  }

  // ── Execute tools and build context ──
  _executeTools(toolCalls, authContext) {
    const results = [];
    const usedTools = [];

    for (const call of toolCalls) {
      try {
        const data = executeTool(call.tool, call.params, authContext);
        results.push({ tool: call.tool, data });
        usedTools.push(call.tool);
      } catch (err) {
        results.push({ tool: call.tool, error: err.message });
        usedTools.push(call.tool);
      }
    }

    return { results, usedTools };
  }

  // ── Build tool results context ──
  _buildToolContext(toolResults) {
    if (toolResults.length === 0) return "";
    
    let ctx = "\n\n[VERİ SONUÇLARI - Tool çağrılarınızın sonuçları]\n";
    for (const r of toolResults) {
      if (r.error) {
        ctx += `--- ${r.tool} (HATA: ${r.error}) ---\n`;
      } else {
        ctx += `--- ${r.tool} ---\n${JSON.stringify(r.data, null, 2)}\n`;
      }
    }
    ctx += "\nBu verileri yorumlayarak kullanıcıya anlaşılır şekilde cevap ver.\n";
    return ctx;
  }

  // ── Remove tool calls from final response ──
  _cleanResponse(text) {
    return text.replace(/\[TOOL_CALL:\w+:\{.*?\}\]/g, '').trim();
  }

  // ── Gateway call with tool handling ──
  async _callGatewayWithTools(messages, agentId, authContext, res = null) {
    const isStreaming = res !== null;
    let fullText = "";
    
    // First call to agent
    if (isStreaming) {
      fullText = await this._streamFromGateway(messages, agentId, res, true);
    } else {
      fullText = await this._callGateway(messages, agentId);
    }

    // Check for tool calls
    const toolCalls = this._parseToolCalls(fullText);
    
    if (toolCalls.length > 0) {
      // Execute tools
      const { results: toolResults, usedTools } = this._executeTools(toolCalls, authContext);
      
      if (isStreaming) {
        res.write(`data: ${JSON.stringify({ type: "tools", tools: usedTools })}\n\n`);
      }
      
      // Add tool results to conversation and call again
      const toolContext = this._buildToolContext(toolResults);
      messages.push({ role: "assistant", content: fullText });
      messages.push({ role: "user", content: toolContext });
      
      // Second call with tool results
      if (isStreaming) {
        fullText = await this._streamFromGateway(messages, agentId, res, false);
      } else {
        fullText = await this._callGateway(messages, agentId);
      }
      
      return { response: this._cleanResponse(fullText), usedTools };
    }
    
    return { response: this._cleanResponse(fullText), usedTools: [] };
  }

  // ── Gateway streaming call ──
  _streamFromGateway(messages, agentId, res, isFirstCall = true) {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({
        model: "openclaw",
        messages,
        stream: true
      });

      let fullText = "";
      const req = http.request({
        hostname: GATEWAY_HOST, port: GATEWAY_PORT,
        path: "/v1/chat/completions", method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + GATEWAY_TOKEN,
          "x-openclaw-agent-id": agentId,
          "Content-Length": Buffer.byteLength(body)
        },
        timeout: 120000
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
              resolve(fullText);
              return;
            }
            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) {
                fullText += delta;
                
                // Only stream to user on second call (after tools)
                if (!isFirstCall && !delta.includes("[HAFIZA_KAYDET") && !delta.includes("[TOOL_CALL")) {
                  res.write(`data: ${JSON.stringify({ type: "chunk", text: delta })}\n\n`);
                }
              }
            } catch {}
          }
        });

        proxyRes.on("end", () => resolve(fullText));
        proxyRes.on("error", reject);
      });

      req.on("error", reject);
      req.on("timeout", () => { req.destroy(); reject(new Error("Gateway timeout (120s)")); });
      req.write(body);
      req.end();
    });
  }

  // ── Gateway non-streaming call ──
  _callGateway(messages, agentId) {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({ model: "openclaw", messages });
      const req = http.request({
        hostname: GATEWAY_HOST, port: GATEWAY_PORT,
        path: "/v1/chat/completions", method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + GATEWAY_TOKEN,
          "x-openclaw-agent-id": agentId,
          "Content-Length": Buffer.byteLength(body)
        },
        timeout: 120000
      }, res => {
        let data = "";
        res.on("data", c => data += c);
        res.on("end", () => {
          try {
            const d = JSON.parse(data);
            resolve(d.choices?.[0]?.message?.content || "");
          } catch (e) { reject(e); }
        });
      });
      req.on("error", reject);
      req.on("timeout", () => { req.destroy(); reject(new Error("Timeout")); });
      req.write(body);
      req.end();
    });
  }

  // ══ MAIN: Streaming ══
  async processMessageStream(message, authContext, sessionContext, previousMessages, res) {
    const agentId = ROLE_AGENT_MAP[authContext.role] || "learner-agent";

    const messages = [];
    messages.push({ role: "system", content: this._buildSystemPrompt(authContext) });

    if (previousMessages?.length > 0) {
      for (const msg of previousMessages.slice(-10)) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    messages.push({ role: "user", content: message });

    try {
      const { response, usedTools } = await this._callGatewayWithTools(messages, agentId, authContext, res);
      const { cleanResponse, saved } = UserMemory.parseAndSave(authContext.user_id, response);
      
      if (saved.length) console.log(`Memory saved for ${authContext.user_id}:`, saved.map(s => `${s.category}:${s.key}`).join(", "));

      res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
      res.end();
      return { reply: cleanResponse, usedTools };
    } catch (err) {
      console.error("Stream error:", err.message);
      const fb = `Bağlantı sorunu yaşandı, lütfen tekrar deneyin.`;
      res.write(`data: ${JSON.stringify({ type: "chunk", text: fb })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
      res.end();
      return { reply: fb, usedTools: [] };
    }
  }

  // ══ MAIN: Non-streaming ══
  async processMessage(message, authContext, sessionContext, previousMessages) {
    const agentId = ROLE_AGENT_MAP[authContext.role] || "learner-agent";

    const messages = [];
    messages.push({ role: "system", content: this._buildSystemPrompt(authContext) });
    
    if (previousMessages?.length > 0) {
      for (const msg of previousMessages.slice(-10)) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    messages.push({ role: "user", content: message });

    try {
      const { response, usedTools } = await this._callGatewayWithTools(messages, agentId, authContext);
      const { cleanResponse, saved } = UserMemory.parseAndSave(authContext.user_id, response);
      return { reply: cleanResponse || "Merhaba! 👋", usedTools };
    } catch (err) {
      console.error("Chat error:", err.message);
      return { reply: "Bağlantı sorunu yaşandı, lütfen tekrar deneyin.", usedTools: [] };
    }
  }
}

module.exports = new AgenticChatOrchestrator();
