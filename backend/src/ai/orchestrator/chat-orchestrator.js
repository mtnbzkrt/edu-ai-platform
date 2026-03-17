const http = require("http");
const jwt = require("jsonwebtoken");
const UserMemory = require("../memory/user-memory");
const { executeTool, getToolsForRole } = require("../tools/tool-registry");
const { buildAuthContext } = require("../context/auth-context");

const GATEWAY_HOST = process.env.OPENCLAW_GATEWAY_HOST || "10.0.0.1";
const GATEWAY_PORT = process.env.OPENCLAW_GATEWAY_PORT || 18790;
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || "bc433d5343886a5a34602fa85b0c91b6720e9b9f12dc80a0";

class ChatOrchestrator {

  // ── Detect which tools the AI should call based on message + conversation ──
  _detectToolNeeds(message, role, previousMessages) {
    const msg = message.toLowerCase();
    const needs = [];

    if (role === "student") {
      // Check if data-related
      const dataKeywords = ["sınav", "sonuç", "not", "puan", "durum", "nasıl", "performans", "başarı", 
                            "ödev", "homework", "görev", "kazanım", "analiz", "güçlü", "zayıf", "plan", 
                            "çalışma", "profil", "bilgi", "exam", "result", "score"];
      const needsData = dataKeywords.some(k => msg.includes(k));
      
      if (needsData) {
        // Always fetch profile for context
        needs.push({ tool: "get_self_profile", input: {} });
        
        if (msg.match(/sınav|sonuç|not|puan|durum|nasıl|performans|başarı|exam|score|result/)) {
          needs.push({ tool: "get_self_exam_results", input: { limit: 5 } });
        }
        if (msg.match(/ödev|homework|görev|teslim|assign/)) {
          needs.push({ tool: "get_self_assignments", input: { limit: 5 } });
        }
        if (msg.match(/kazanım|analiz|güçlü|zayıf|konu|detay|breakdown|outcome|plan|çalışma/)) {
          needs.push({ tool: "get_self_outcome_breakdown", input: {} });
        }
      }
    } else if (role === "teacher") {
      const dataKeywords = ["sınıf", "öğrenci", "sonuç", "sınav", "durum", "analiz", "kazanım", "performans", "liste"];
      const needsData = dataKeywords.some(k => msg.includes(k));
      
      if (needsData) {
        needs.push({ tool: "list_teacher_classes", input: {} });
        // More specific tools need class_id which we may not know yet — let AI ask
      }
    } else if (role === "parent") {
      const dataKeywords = ["çocuk", "oğlum", "kızım", "sınav", "sonuç", "ödev", "durum", "devamsızlık", "nasıl"];
      const needsData = dataKeywords.some(k => msg.includes(k));
      
      if (needsData) {
        needs.push({ tool: "list_my_children", input: {} });
      }
    }

    return needs;
  }

  // ── Execute detected tools and build context ──
  _fetchToolData(needs, authContext) {
    const results = [];
    const usedTools = [];

    for (const need of needs) {
      try {
        const data = executeTool(need.tool, need.input, authContext);
        results.push({ tool: need.tool, data });
        usedTools.push(need.tool);
      } catch (err) {
        results.push({ tool: need.tool, error: err.message });
        usedTools.push(need.tool);
      }
    }

    return { results, usedTools };
  }

  // ── Build context block from tool results ──
  _buildDataContext(toolResults) {
    if (toolResults.length === 0) return "";
    
    let ctx = "\n\n[VERİ BAĞLAMI - Aşağıdaki veriler gerçek okul sisteminden çekilmiştir. Yorumlayarak cevap ver, ham JSON gösterme.]\n";
    for (const r of toolResults) {
      if (r.error) {
        ctx += `--- ${r.tool} (HATA: ${r.error}) ---\n`;
      } else {
        ctx += `--- ${r.tool} ---\n${JSON.stringify(r.data, null, 2)}\n`;
      }
    }
    return ctx;
  }

  // ── Build system prompt ──
  _buildSystemPrompt(authContext) {
    const memoryContext = UserMemory.buildContext(authContext.user_id);
    const availableTools = getToolsForRole(authContext.role);

    return `Sen bir eğitim AI asistanısın.
Kullanıcı: ${authContext.full_name || "Bilinmiyor"} (rol: ${authContext.role})

## Dil ve Üslup
Türkçe konuş. Pedagojik dil kullan, cesaretlendirici ol.
Ham veriyi gösterme, yorumlayarak açıkla.

## Veri Erişimi
Sana sunulan [VERİ BAĞLAMI] bloklarında gerçek okul verileri var. Bu verileri yorumlayarak kullan.
Veri yoksa veya eksikse, kullanıcıya neyi sorması gerektiğini söyle.

## ÖNEMLİ
- Veriyi UYDURMA, sadece sana verilen gerçek veriyi kullan.
- Ham JSON gösterme — yorumla, özetle, tablolar/listeler kullan.
- Öğrenciyi cesaretlendir ama dürüst ol.
- Basit sohbet veya konu anlatımı için veri bloğu olmayacak, doğrudan cevapla.

## Kullanılabilir veri araçları: ${availableTools.join(", ")}

## Hafıza Sistemi
Kullanıcı hakkında önemli bilgiler öğrendiğinde yanıtının SONUNA etiket ekle:
[HAFIZA_KAYDET:kategori:anahtar:değer]
Kategoriler: preferences, learning_style, strengths, weaknesses, goals, notes, personality
${memoryContext}`;
  }

  // ── Gateway streaming call ──
  _streamFromGateway(messages, res) {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({
        model: "anthropic/claude-sonnet-4-20250514",
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
  _callGateway(messages) {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({ model: "anthropic/claude-sonnet-4-20250514", messages });
      const req = http.request({
        hostname: GATEWAY_HOST, port: GATEWAY_PORT,
        path: "/v1/chat/completions", method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + GATEWAY_TOKEN,
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
    // 1. Detect tool needs
    const needs = this._detectToolNeeds(message, authContext.role, previousMessages);
    
    // 2. Fetch data locally (fast, no gateway)
    const { results: toolResults, usedTools } = this._fetchToolData(needs, authContext);
    
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
      const fullText = await this._streamFromGateway(messages, res);
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
    const needs = this._detectToolNeeds(message, authContext.role, previousMessages);
    const { results: toolResults, usedTools } = this._fetchToolData(needs, authContext);

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
      const reply = await this._callGateway(messages);
      const { cleanResponse, saved } = UserMemory.parseAndSave(authContext.user_id, reply);
      return { reply: cleanResponse || "Merhaba! 👋", usedTools };
    } catch (err) {
      console.error("Chat error:", err.message);
      return { reply: "Bağlantı sorunu yaşandı, lütfen tekrar deneyin.", usedTools: [] };
    }
  }
}

module.exports = new ChatOrchestrator();
