const http = require("http");
const jwt = require("jsonwebtoken");
const UserMemory = require("../memory/user-memory");
const { executeTool, TOOL_HANDLERS } = require("../tools/tool-registry");
const { buildAuthContext } = require("../context/auth-context");

const GATEWAY_HOST = process.env.OPENCLAW_GATEWAY_HOST || "10.0.0.1";
const GATEWAY_PORT = process.env.OPENCLAW_GATEWAY_PORT || 18790;
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || "bc433d5343886a5a34602fa85b0c91b6720e9b9f12dc80a0";
const JWT_SECRET = process.env.JWT_SECRET || "edu-ai-secret-key-2026";
const MAX_TOOL_ROUNDS = 5;

class ChatOrchestrator {

  // ── Build OpenAI-compatible tool definitions for a role ──
  _buildToolDefs(role) {
    const defs = {
      student: [
        { name: "get_self_profile", description: "Öğrencinin kendi profil bilgileri", parameters: { type: "object", properties: {}, required: [] } },
        { name: "get_self_exam_results", description: "Öğrencinin sınav sonuçları", parameters: { type: "object", properties: { limit: { type: "number", description: "Kaç sonuç (max 50)" }, subject: { type: "string", description: "Ders filtresi (math, science, vb.)" } }, required: [] } },
        { name: "get_self_assignments", description: "Öğrencinin ödevleri", parameters: { type: "object", properties: { limit: { type: "number" }, status: { type: "string", enum: ["pending", "completed"] } }, required: [] } },
        { name: "get_self_outcome_breakdown", description: "Kazanım bazlı analiz", parameters: { type: "object", properties: { subject: { type: "string" }, exam_ids: { type: "string", description: "Virgülle ayrılmış exam id'leri" } }, required: [] } }
      ],
      teacher: [
        { name: "list_teacher_classes", description: "Öğretmenin sınıfları", parameters: { type: "object", properties: {}, required: [] } },
        { name: "list_class_students", description: "Sınıftaki öğrenci listesi", parameters: { type: "object", properties: { class_id: { type: "number" } }, required: ["class_id"] } },
        { name: "get_class_exam_results", description: "Sınıf sınav sonuçları", parameters: { type: "object", properties: { class_id: { type: "number" }, subject: { type: "string" } }, required: ["class_id"] } },
        { name: "get_class_outcome_breakdown", description: "Sınıf kazanım analizi", parameters: { type: "object", properties: { class_id: { type: "number" }, subject: { type: "string" } }, required: ["class_id"] } },
        { name: "get_student_exam_results", description: "Tek öğrenci sınav sonuçları", parameters: { type: "object", properties: { student_id: { type: "string" }, limit: { type: "number" } }, required: ["student_id"] } }
      ],
      parent: [
        { name: "list_my_children", description: "Velinin çocukları", parameters: { type: "object", properties: {}, required: [] } },
        { name: "get_child_exam_results", description: "Çocuğun sınav sonuçları", parameters: { type: "object", properties: { child_id: { type: "string" }, limit: { type: "number" } }, required: ["child_id"] } },
        { name: "get_child_assignments", description: "Çocuğun ödevleri", parameters: { type: "object", properties: { child_id: { type: "string" }, limit: { type: "number" } }, required: ["child_id"] } },
        { name: "get_child_attendance", description: "Çocuğun devamsızlığı", parameters: { type: "object", properties: { child_id: { type: "string" } }, required: ["child_id"] } }
      ]
    };
    return (defs[role] || []).map(d => ({ type: "function", function: d }));
  }

  // ── Build system prompt (simpler, no exec instructions) ──
  _buildSystemPrompt(authContext) {
    const memoryContext = UserMemory.buildContext(authContext.user_id);

    return `Sen bir eğitim AI asistanısın.
Kullanıcı: ${authContext.full_name || "Bilinmiyor"} (rol: ${authContext.role})

## Dil ve Üslup
Türkçe konuş. Pedagojik dil kullan, cesaretlendirici ol.
Ham veriyi gösterme, yorumlayarak açıkla.

## Veri Erişimi
Öğrencinin sınavları, ödevleri, performansı gibi verilere erişmek için sana sunulan tool'ları çağır.
Verileri TAHMIN ETME veya UYDURMA — her zaman tool ile gerçek veriyi çek.

## ÖNEMLİ: Belirsiz Sorularda DARALT
Kullanıcı genel/belirsiz bir soru sorduğunda TÜM VERİYİ ÇEKME. Önce hangi sınıf/ders/öğrenci/çocuk olduğunu sor.
Örnekler:
- "Sınıfımın durumu?" → Önce list_teacher_classes ile sınıfları göster, hangisi olduğunu sor.
- Tek seçenek varsa direkt devam et.
- Basit sohbet veya konu anlatımı için tool çağırma.

## Kurallar
1. Veri gerektiren şey soruluyorsa tool çağır.
2. Basit sohbet veya konu anlatımı için tool çağırma.
3. Tool sonucunu ham JSON olarak gösterme — yorumla, özetle.
4. Bir seferde sadece ihtiyacın olan tool'ları çağır.
5. Tool hata dönerse kullanıcıya nazikçe açıkla.

## Hafıza Sistemi
Kullanıcı hakkında önemli bilgiler öğrendiğinde yanıtının SONUNA etiket ekle:
[HAFIZA_KAYDET:kategori:anahtar:değer]
Kategoriler: preferences, learning_style, strengths, weaknesses, goals, notes, personality
${memoryContext}`;
  }

  // ── Execute tool calls locally ──
  _executeToolCalls(toolCalls, authContext) {
    return toolCalls.map(tc => {
      const fnName = tc.function?.name || tc.name;
      let args = {};
      try {
        args = typeof tc.function?.arguments === "string" 
          ? JSON.parse(tc.function.arguments) 
          : (tc.function?.arguments || tc.input || {});
      } catch { args = {}; }

      // Parse exam_ids string to array
      if (args.exam_ids && typeof args.exam_ids === "string") {
        args.exam_ids = args.exam_ids.split(",").map(v => v.trim());
      }

      let result;
      try {
        result = executeTool(fnName, args, authContext);
      } catch (err) {
        result = { error: err.message || "Tool hatası" };
      }

      return {
        tool_call_id: tc.id || `call_${fnName}`,
        role: "tool",
        content: JSON.stringify(result)
      };
    });
  }

  // ── Call Gateway (non-streaming) with tool loop ──
  _callGateway(messages, tools) {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({
        model: "anthropic/claude-sonnet-4-20250514",
        messages,
        tools: tools.length > 0 ? tools : undefined,
        max_tokens: 4096
      });

      const req = http.request({
        hostname: GATEWAY_HOST, port: GATEWAY_PORT,
        path: "/v1/chat/completions", method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + GATEWAY_TOKEN,
          "Content-Length": Buffer.byteLength(body)
        },
        timeout: 60000
      }, res => {
        let data = "";
        res.on("data", c => data += c);
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            resolve(parsed);
          } catch (e) {
            reject(new Error("Gateway yanıt parse hatası: " + data.slice(0, 200)));
          }
        });
      });

      req.on("error", reject);
      req.on("timeout", () => { req.destroy(); reject(new Error("Gateway timeout (60s)")); });
      req.write(body);
      req.end();
    });
  }

  // ── Call Gateway (streaming) — only for final text response ──
  _callGatewayStream(messages, res) {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({
        model: "anthropic/claude-sonnet-4-20250514",
        messages,
        stream: true,
        max_tokens: 4096
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
        timeout: 90000
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
      req.on("timeout", () => { req.destroy(); reject(new Error("Stream timeout")); });
      req.write(body);
      req.end();
    });
  }

  // ── Main: Streaming chat with tool loop ──
  async processMessageStream(message, authContext, sessionContext, previousMessages, res) {
    const tools = this._buildToolDefs(authContext.role);
    const messages = [];
    messages.push({ role: "system", content: this._buildSystemPrompt(authContext) });

    if (previousMessages?.length > 0) {
      for (const msg of previousMessages.slice(-10)) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }
    messages.push({ role: "user", content: message });

    // Signal stream start
    res.write(`data: ${JSON.stringify({ type: "tools", tools: [] })}\n\n`);

    try {
      // Tool calling loop (non-streaming, fast)
      let round = 0;
      let usedTools = [];
      
      while (round < MAX_TOOL_ROUNDS) {
        const result = await this._callGateway(messages, tools);
        const choice = result.choices?.[0];

        if (!choice) break;

        // Check for tool calls
        const toolCalls = choice.message?.tool_calls;
        if (toolCalls && toolCalls.length > 0 && choice.finish_reason !== "stop") {
          round++;
          usedTools.push(...toolCalls.map(tc => tc.function?.name));
          
          // Notify frontend about tool usage
          res.write(`data: ${JSON.stringify({ type: "tools", tools: usedTools })}\n\n`);

          // Add assistant message with tool calls
          messages.push(choice.message);

          // Execute tools locally and add results
          const toolResults = this._executeToolCalls(toolCalls, authContext);
          messages.push(...toolResults);

          continue; // Next round
        }

        // No tool calls — we have the final text, but it's not streamed
        // Send it as chunks for consistent UX
        const text = choice.message?.content || "";
        if (text) {
          const { cleanResponse, saved } = UserMemory.parseAndSave(authContext.user_id, text);
          if (saved.length) console.log(`Memory saved for ${authContext.user_id}:`, saved.map(s => `${s.category}:${s.key}`).join(", "));

          // Send as one chunk (already complete)
          if (cleanResponse) {
            res.write(`data: ${JSON.stringify({ type: "chunk", text: cleanResponse })}\n\n`);
          }
          res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
          res.end();
          return { reply: cleanResponse, usedTools };
        }

        break;
      }

      // If we exhausted rounds, do a final streaming call WITHOUT tools
      if (round >= MAX_TOOL_ROUNDS) {
        console.log(`Max tool rounds (${MAX_TOOL_ROUNDS}) reached, final streaming call`);
      }

      // Final streaming response (after all tools executed, or no tools needed)
      const finalText = await this._callGatewayStream(messages, res);
      const { cleanResponse, saved } = UserMemory.parseAndSave(authContext.user_id, finalText);
      if (saved.length) console.log(`Memory saved for ${authContext.user_id}:`, saved.map(s => `${s.category}:${s.key}`).join(", "));

      res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
      res.end();
      return { reply: cleanResponse, usedTools };

    } catch (err) {
      console.error("Orchestrator error:", err.message);
      const fb = `Bağlantı sorunu yaşandı, lütfen tekrar deneyin. (${err.message})`;
      res.write(`data: ${JSON.stringify({ type: "chunk", text: fb })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
      res.end();
      return { reply: fb, usedTools: [] };
    }
  }

  // ── Non-streaming fallback ──
  async processMessage(message, authContext, sessionContext, previousMessages) {
    const tools = this._buildToolDefs(authContext.role);
    const messages = [];
    messages.push({ role: "system", content: this._buildSystemPrompt(authContext) });
    
    if (previousMessages?.length > 0) {
      for (const msg of previousMessages.slice(-10)) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }
    messages.push({ role: "user", content: message });

    let usedTools = [];
    let round = 0;

    while (round < MAX_TOOL_ROUNDS) {
      const result = await this._callGateway(messages, tools);
      const choice = result.choices?.[0];
      if (!choice) break;

      const toolCalls = choice.message?.tool_calls;
      if (toolCalls && toolCalls.length > 0 && choice.finish_reason !== "stop") {
        round++;
        usedTools.push(...toolCalls.map(tc => tc.function?.name));
        messages.push(choice.message);
        const toolResults = this._executeToolCalls(toolCalls, authContext);
        messages.push(...toolResults);
        continue;
      }

      const text = choice.message?.content || "";
      const { cleanResponse, saved } = UserMemory.parseAndSave(authContext.user_id, text);
      return { reply: cleanResponse || "Merhaba! 👋 Size nasıl yardımcı olabilirim?", usedTools };
    }

    return { reply: "Merhaba! 👋 Size nasıl yardımcı olabilirim?", usedTools };
  }
}

module.exports = new ChatOrchestrator();
