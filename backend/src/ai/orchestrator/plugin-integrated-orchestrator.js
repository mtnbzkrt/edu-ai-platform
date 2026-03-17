const http = require("http");
const jwt = require("jsonwebtoken");
const UserMemory = require("../memory/user-memory");
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

// Tool mapping based on role
const ROLE_TOOLS_MAP = {
  student: [
    { tool: "get_self_profile", trigger: ["profil", "bilgi", "kim", "isim", "sınıf"] },
    { tool: "get_self_exam_results", trigger: ["sınav", "sonuç", "not", "puan", "başarı", "derece"] },
    { tool: "get_self_assignments", trigger: ["ödev", "homework", "görev", "teslim"] },
    { tool: "get_self_outcome_breakdown", trigger: ["kazanım", "analiz", "güçlü", "zayıf", "detay"] }
  ],
  teacher: [
    { tool: "list_teacher_classes", trigger: ["sınıf", "öğrenci", "liste", "class"] }
  ],
  parent: [
    { tool: "list_my_children", trigger: ["çocuk", "oğlum", "kızım", "evlat"] }
  ]
};

class PluginIntegratedOrchestrator {

  // ── Smart tool detection with context ──
  _detectToolNeeds(message, role, previousMessages) {
    const msg = message.toLowerCase();
    const needs = [];
    const toolsForRole = ROLE_TOOLS_MAP[role] || [];

    for (const toolDef of toolsForRole) {
      const matched = toolDef.trigger.some(keyword => msg.includes(keyword));
      if (matched) {
        // Add default params based on tool
        let params = {};
        if (toolDef.tool === "get_self_exam_results") {
          params = { limit: 5 };
        }
        needs.push({ tool: toolDef.tool, params });
      }
    }

    // Always include profile for data-related requests
    if (needs.length > 0 && role === "student") {
      const hasProfile = needs.some(n => n.tool === "get_self_profile");
      if (!hasProfile) {
        needs.unshift({ tool: "get_self_profile", params: {} });
      }
    }

    return needs;
  }

  // ── Call OpenClaw plugin tools via Gateway ──
  async _callPluginTool(toolName, params, authToken, sessionKey) {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({
        tool: toolName,
        args: { ...(params || {}), authToken: authToken },
        sessionKey: sessionKey,
        authToken: authToken  // Pass auth token to plugin
      });

      const req = http.request({
        hostname: GATEWAY_HOST, port: GATEWAY_PORT,
        path: "/tools/invoke", method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + GATEWAY_TOKEN,
          "Content-Length": Buffer.byteLength(body)
        },
        timeout: 30000
      }, res => {
        let data = "";
        res.on("data", c => data += c);
        res.on("end", () => {
          try {
            const result = JSON.parse(data);
            if (result.ok) {
              resolve(result.result);
            } else {
              reject(new Error(result.error?.message || "Tool call failed"));
            }
          } catch (e) {
            reject(new Error("Invalid JSON response"));
          }
        });
      });

      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("Tool call timeout"));
      });

      req.write(body);
      req.end();
    });
  }

  // ── Execute detected tools via plugin system ──
  async _fetchToolData(needs, authContext, sessionId) {
    const results = [];
    const usedTools = [];

    for (const need of needs) {
      try {
        // Get JWT token from authContext
        const authToken = authContext.jwt;
        const sessionKey = `edu:${authContext.role}:${authContext.user_id}:${sessionId}`;
        
        console.log(`Calling plugin tool: ${need.tool} with session: ${sessionKey}`);
        
        const result = await this._callPluginTool(need.tool, need.params, authToken, sessionKey);
        
        // Extract text content from plugin response
        let data = result;
        if (result.content && Array.isArray(result.content) && result.content[0]?.text) {
          data = result.content[0].text;
          
          // Try to parse as JSON if it looks like JSON
          if (data.startsWith('Profile data:') || data.startsWith('Exam results:') || data.startsWith('Assignments:')) {
            const jsonStart = data.indexOf('{');
            if (jsonStart !== -1) {
              try {
                data = JSON.parse(data.substring(jsonStart));
              } catch (e) {
                // Keep as text if JSON parsing fails
              }
            }
          }
        }
        
        results.push({ tool: need.tool, data });
        usedTools.push(need.tool);
        
      } catch (err) {
        console.error(`Tool ${need.tool} failed:`, err.message);
        results.push({ tool: need.tool, error: err.message });
        usedTools.push(need.tool);
      }
    }

    return { results, usedTools };
  }

  // ── Build data context for agent ──
  _buildDataContext(toolResults) {
    if (toolResults.length === 0) return "";
    
    let ctx = "\n\n[VERİ BAĞLAMI - Plugin'den alınan gerçek okul verileri]\n";
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

  // ── Build system prompt ──
  _buildSystemPrompt(authContext) {
    const memoryContext = UserMemory.buildContext(authContext.user_id);

    return `Sen bir eğitim AI asistanısın.
Kullanıcı: ${authContext.full_name || "Bilinmiyor"} (rol: ${authContext.role})

## Dil ve Üslup  
Türkçe konuş. Pedagojik dil kullan, cesaretlendirici ol.
Ham veriyi gösterme, yorumlayarak açıkla.

## Veri Kullanımı
Sana [VERİ BAĞLAMI] bloklarında gerçek okul verileri sunulacak.
Bu verileri yorumlayarak kullanıcıya anlaşılır şekilde açıkla.

## ÖNEMLİ KURALLAR
- ASLA veri uydurma, sadece verilen gerçek veriyi kullan
- Ham JSON gösterme — yorumla, özetle, tablolar kullan
- Öğrenciyi cesaretlendir ama dürüst ol
- Basit sohbet için veri bloğu olmayacak, doğrudan cevapla

## Hafıza Sistemi
Önemli bilgiler öğrendiğinde yanıtının SONUNA etiket ekle:
[HAFIZA_KAYDET:kategori:anahtar:değer]
${memoryContext}`;
  }

  // ── Gateway streaming call ──
  _streamFromGateway(messages, agentId, res) {
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
                if (!delta.includes("[HAFIZA_KAYDET")) {
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
    const sessionId = sessionContext.session_id;

    // 1. Detect tool needs
    const needs = this._detectToolNeeds(message, authContext.role, previousMessages);
    
    // 2. Fetch data via plugin tools
    const { results: toolResults, usedTools } = await this._fetchToolData(needs, authContext, sessionId);
    
    // 3. Signal stream start with tools info
    res.write(`data: ${JSON.stringify({ type: "tools", tools: usedTools })}\n\n`);

    // 4. Build messages
    const messages = [];
    messages.push({ role: "system", content: this._buildSystemPrompt(authContext) });

    if (previousMessages?.length > 0) {
      for (const msg of previousMessages.slice(-10)) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    // Append data context to user message
    const dataContext = this._buildDataContext(toolResults);
    messages.push({ role: "user", content: message + dataContext });

    // 5. Stream from gateway
    try {
      const fullText = await this._streamFromGateway(messages, agentId, res);
      const { cleanResponse, saved } = UserMemory.parseAndSave(authContext.user_id, fullText);
      
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
    const sessionId = sessionContext.session_id;

    const needs = this._detectToolNeeds(message, authContext.role, previousMessages);
    const { results: toolResults, usedTools } = await this._fetchToolData(needs, authContext, sessionId);

    const messages = [];
    messages.push({ role: "system", content: this._buildSystemPrompt(authContext) });
    
    if (previousMessages?.length > 0) {
      for (const msg of previousMessages.slice(-10)) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    const dataContext = this._buildDataContext(toolResults);
    messages.push({ role: "user", content: message + dataContext });

    try {
      const reply = await this._callGateway(messages, agentId);
      const { cleanResponse, saved } = UserMemory.parseAndSave(authContext.user_id, reply);
      return { reply: cleanResponse || "Merhaba! 👋", usedTools };
    } catch (err) {
      console.error("Chat error:", err.message);
      return { reply: "Bağlantı sorunu yaşandı, lütfen tekrar deneyin.", usedTools: [] };
    }
  }
}

module.exports = new PluginIntegratedOrchestrator();
