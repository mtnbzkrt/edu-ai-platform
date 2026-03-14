const Anthropic = require("@anthropic-ai/sdk");
const { executeTool, getToolsForRole } = require("../tools/tool-registry");

const API_KEY = process.env.ANTHROPIC_API_KEY || "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";

const client = new Anthropic({ apiKey: API_KEY });

// ── SYSTEM PROMPTS ──
const SYSTEM_PROMPTS = {
  "learner-agent": `Sen bir öğrenci öğrenme asistanısın. Adın "Eğitim AI".

GÖREV:
- Öğrencinin öğrenmesini kolaylaştır
- Konuları yaşına uygun, sade ve adım adım anlat
- Sınav/ödev verilerini yorumla
- Eksik konuları tespit et ve çalışma önerileri ver
- Konu anlatımı istediğinde detaylı, örnekli, mini quiz'li ders anlat

DAVRANIŞIN:
- Sıcak, destekleyici, cesaretlendirici ol
- Öğrenciyi utandırma veya etiketleme
- Cevabı hemen verme, yönlendirici ol
- Kademeli anlatım kullan (açıklama → örnek → mini soru)
- Eksik veya belirsiz veri varsa açıkça söyle
- Türkçe konuş

VERİ ERİŞİMİ:
Sana sunulan tool'ları kullanarak öğrencinin sınav sonuçlarını, ödevlerini, kazanım kırılımını çekebilirsin.
Sadece konu anlatımı isteniyorsa tool çağırmana gerek yok.
Performans, eksik konu, çalışma planı gibi konularda tool'ları kullan.

KONU ANLATIMI:
Konu anlatımı istediğinde:
1. Konuyu tanımla
2. Temel kuralları ver
3. 2-3 çözümlü örnek ver
4. Mini quiz sorusu sor
5. İpucu sun

YASAKLAR:
- Başka öğrencilerin verisine erişme
- Psikolojik/medikal tanı koyma
- Ham tool verisini açıklamasız verme`,

  "teacher-agent": `Sen bir öğretmen karar destek ve analiz asistanısın. Adın "Eğitim AI".

GÖREV:
- Öğretmene sınıf ve öğrenci analizi yap
- Sınav, kazanım, ödev verilerini yorumla
- Risk altındaki öğrencileri tespit et
- Sınav/ödev/quiz üretiminde yardımcı ol
- Kısa, net ve uygulanabilir içgörüler sun

DAVRANIŞIN:
- Profesyonel, net, sistematik ol
- Öğrencileri etiketleme ama veri bazlı analiz yap
- Önce tespit, sonra yorum, sonra aksiyon önerisi
- Türkçe konuş

VERİ ERİŞİMİ:
Tool'ları kullanarak sınıf listeleri, sınav sonuçları, kazanım kırılımları çekebilirsin.

YASAKLAR:
- Yetkisiz öğrenci verisine erişme
- Tek sınavdan büyük hüküm çıkarma
- Psikolojik tanı koyma`,

  "parent-agent": `Sen bir veli bilgilendirme asistanısın. Adın "Eğitim AI".

GÖREV:
- Veliye çocuğunun durumunu sade ve anlaşılır anlat
- Sınav, ödev, devamsızlık verilerini yorumla
- Kaygı artırmadan, yapıcı öneriler sun
- Evde uygulanabilir destek önerileri ver

DAVRANIŞIN:
- Sakin, şefkatli ama net ol
- Çocuğu etiketleme
- Teknik jargon kullanma
- Güçlü alanları da belirt
- Türkçe konuş

VERİ ERİŞİMİ:
Sadece velinin kendi çocuğunun verilerine erişebilirsin.

YASAKLAR:
- Başka çocukların verisi
- Kesin tanı/etiket
- Aşırı kaygı artıran dil`
};

// ── TOOL DEFINITIONS FOR CLAUDE ──
function getToolDefinitions(role) {
  const allTools = {
    student: [
      {
        name: "get_self_profile",
        description: "Oturum açmış öğrencinin profilini getirir (ad, sınıf, şube).",
        input_schema: { type: "object", properties: {}, required: [] }
      },
      {
        name: "get_self_exam_results",
        description: "Öğrencinin sınav sonuçlarını getirir. Ders, limit ve tarih aralığı ile filtrelenebilir.",
        input_schema: {
          type: "object",
          properties: {
            subject: { type: "string", description: "Ders adı: math, science vb." },
            limit: { type: "integer", description: "Kaç sonuç getirilsin (max 50)", default: 5 },
            date_range: {
              type: "object",
              properties: {
                start: { type: "string", description: "Başlangıç tarihi YYYY-MM-DD" },
                end: { type: "string", description: "Bitiş tarihi YYYY-MM-DD" }
              }
            }
          }
        }
      },
      {
        name: "get_self_outcome_breakdown",
        description: "Öğrencinin konu/kazanım bazlı performans kırılımını verir. Hangi konularda güçlü, hangi konularda zayıf olduğunu gösterir.",
        input_schema: {
          type: "object",
          properties: {
            subject: { type: "string", description: "Ders adı" },
            examIds: { type: "array", items: { type: "string" }, description: "Analiz edilecek sınav ID'leri" }
          }
        }
      },
      {
        name: "get_self_assignments",
        description: "Öğrencinin ödevlerini getirir.",
        input_schema: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["pending", "submitted", "graded", "late"], description: "Ödev durumu filtresi" },
            limit: { type: "integer", description: "Kaç ödev getirilsin", default: 10 }
          }
        }
      }
    ],
    teacher: [
      {
        name: "list_teacher_classes",
        description: "Öğretmenin erişebildiği sınıfları listeler.",
        input_schema: { type: "object", properties: {}, required: [] }
      },
      {
        name: "list_class_students",
        description: "Bir sınıftaki öğrencileri listeler.",
        input_schema: {
          type: "object",
          properties: {
            class_id: { type: "string", description: "Sınıf ID" },
            page: { type: "integer", default: 1 },
            limit: { type: "integer", default: 30 }
          },
          required: ["class_id"]
        }
      },
      {
        name: "get_student_exam_results",
        description: "Belirli bir öğrencinin sınav sonuçlarını getirir.",
        input_schema: {
          type: "object",
          properties: {
            student_id: { type: "string", description: "Öğrenci ID" },
            subject: { type: "string" },
            limit: { type: "integer", default: 5 },
            date_range: { type: "object", properties: { start: { type: "string" }, end: { type: "string" } } }
          },
          required: ["student_id"]
        }
      },
      {
        name: "get_class_exam_results",
        description: "Bir sınıfın sınav sonuçlarını getirir.",
        input_schema: {
          type: "object",
          properties: {
            class_id: { type: "string" },
            subject: { type: "string" },
            exam_id: { type: "string" },
            limit: { type: "integer", default: 50 }
          },
          required: ["class_id"]
        }
      },
      {
        name: "get_class_outcome_breakdown",
        description: "Sınıfın konu/kazanım bazlı ortalama başarı kırılımını getirir.",
        input_schema: {
          type: "object",
          properties: {
            class_id: { type: "string" },
            subject: { type: "string" },
            exam_id: { type: "string" }
          },
          required: ["class_id"]
        }
      }
    ],
    parent: [
      {
        name: "list_my_children",
        description: "Velinin bağlı olduğu çocukları listeler.",
        input_schema: { type: "object", properties: {}, required: [] }
      },
      {
        name: "get_child_exam_results",
        description: "Velinin çocuğunun sınav sonuçlarını getirir.",
        input_schema: {
          type: "object",
          properties: {
            child_id: { type: "string" },
            limit: { type: "integer", default: 5 },
            date_range: { type: "object", properties: { start: { type: "string" }, end: { type: "string" } } }
          },
          required: ["child_id"]
        }
      },
      {
        name: "get_child_assignments",
        description: "Velinin çocuğunun ödevlerini getirir.",
        input_schema: {
          type: "object",
          properties: {
            child_id: { type: "string" },
            status: { type: "string" },
            limit: { type: "integer", default: 10 }
          },
          required: ["child_id"]
        }
      },
      {
        name: "get_child_attendance",
        description: "Velinin çocuğunun devamsızlık bilgisini getirir.",
        input_schema: {
          type: "object",
          properties: {
            child_id: { type: "string" },
            period: { type: "string", enum: ["this_month", "this_week", "last_month"], default: "this_month" }
          },
          required: ["child_id"]
        }
      }
    ]
  };

  return allTools[role] || [];
}

// ── MAIN ORCHESTRATOR ──
class ChatOrchestrator {
  async processMessage(message, auth, sessionContext) {
    const agentKey = sessionContext.agent_key || this._getAgentKey(auth.role);
    const systemPrompt = SYSTEM_PROMPTS[agentKey] || SYSTEM_PROMPTS["learner-agent"];
    const tools = getToolDefinitions(auth.role);
    const usedTools = [];

    // Build messages with conversation history
    const messages = [];

    // Add previous messages from session if available
    if (sessionContext.previousMessages) {
      for (const pm of sessionContext.previousMessages.slice(-10)) {
        if (pm.role === "user" || pm.role === "assistant") {
          messages.push({ role: pm.role, content: pm.content });
        }
      }
    }

    messages.push({ role: "user", content: message });

    try {
      // Call Claude with tools
      let response = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
        system: systemPrompt,
        tools: tools.length > 0 ? tools : undefined,
        messages
      });

      // Tool use loop - Claude may want to call tools
      let iterations = 0;
      const MAX_ITERATIONS = 5;

      while (response.stop_reason === "tool_use" && iterations < MAX_ITERATIONS) {
        iterations++;
        const toolUseBlocks = response.content.filter(b => b.type === "tool_use");
        const toolResults = [];

        for (const toolUse of toolUseBlocks) {
          usedTools.push(toolUse.name);
          try {
            const result = executeTool(toolUse.name, toolUse.input || {}, auth);
            toolResults.push({
              type: "tool_result",
              tool_use_id: toolUse.id,
              content: JSON.stringify(result)
            });
          } catch (e) {
            toolResults.push({
              type: "tool_result",
              tool_use_id: toolUse.id,
              content: JSON.stringify({ error: e.code || "ERROR", message: e.message }),
              is_error: true
            });
          }
        }

        // Continue conversation with tool results
        messages.push({ role: "assistant", content: response.content });
        messages.push({ role: "user", content: toolResults });

        response = await client.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 2000,
          system: systemPrompt,
          tools: tools.length > 0 ? tools : undefined,
          messages
        });
      }

      // Extract final text response
      const textBlocks = response.content.filter(b => b.type === "text");
      const reply = textBlocks.map(b => b.text).join("\n") || "Bir yanıt oluşturulamadı.";

      return { reply, usedTools };

    } catch (e) {
      console.error("AI Error:", e.message);
      // Fallback
      return {
        reply: `⚠️ AI servisi şu an yanıt veremedi. Hata: ${e.message}\n\nLütfen tekrar deneyin.`,
        usedTools
      };
    }
  }

  _getAgentKey(role) {
    return { student: "learner-agent", teacher: "teacher-agent", parent: "parent-agent" }[role] || "learner-agent";
  }
}

module.exports = new ChatOrchestrator();
