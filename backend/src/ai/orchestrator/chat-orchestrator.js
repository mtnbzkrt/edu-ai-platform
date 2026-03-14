const { executeTool, getToolsForRole } = require("../tools/tool-registry");
const connector = require("../../school/connector/school-connector");

// Simple AI response generation (mock - in production this calls Opus via OpenClaw)
// For demo: pattern-match user intent and use tools to build intelligent responses

class ChatOrchestrator {
  async processMessage(message, auth, sessionContext) {
    const role = auth.role;
    const msg = message.toLowerCase();
    const usedTools = [];
    let reply = "";

    try {
      if (role === "student") {
        reply = await this._handleStudent(msg, message, auth, usedTools);
      } else if (role === "teacher") {
        reply = await this._handleTeacher(msg, message, auth, usedTools);
      } else if (role === "parent") {
        reply = await this._handleParent(msg, message, auth, usedTools);
      } else {
        reply = "Merhaba! Size nasıl yardımcı olabilirim?";
      }
    } catch (e) {
      reply = `Bir hata oluştu: ${e.message || e}`;
    }

    return { reply, usedTools };
  }

  async _handleStudent(msg, original, auth, usedTools) {
    const profile = executeTool("get_self_profile", {}, auth);
    usedTools.push("get_self_profile");

    if (msg.includes("sınav") || msg.includes("not") || msg.includes("puan") || msg.includes("sonuç")) {
      const results = executeTool("get_self_exam_results", { limit: 5 }, auth);
      usedTools.push("get_self_exam_results");

      if (results.items.length === 0) return `${profile.full_name}, henüz kayıtlı sınav sonucun bulunmuyor.`;

      let text = `📊 **${profile.full_name}**, son sınav sonuçların:\n\n`;
      results.items.forEach((r, i) => {
        const emoji = r.score >= 70 ? "✅" : r.score >= 50 ? "⚠️" : "❌";
        text += `${emoji} **${r.exam_name}** (${r.exam_date}): **${r.score}/${r.max_score}**\n`;
      });

      const avg = Math.round(results.items.reduce((s, r) => s + r.score, 0) / results.items.length);
      text += `\n📈 Ortalaman: **${avg}/100**\n`;

      if (avg < 60) text += "\n💡 Ortalaman biraz düşük görünüyor. Hangi konularda zorlandığını birlikte inceleyelim mi?";
      else if (avg < 75) text += "\n💪 Fena değil! Biraz daha çalışmayla ortalaman yükselir. Zayıf konularına bakmak ister misin?";
      else text += "\n🌟 Harika gidiyorsun! Bu ivmeyi korumaya devam et.";

      // Add outcome analysis if scores are low
      if (avg < 70) {
        const outcomes = executeTool("get_self_outcome_breakdown", {
          subject: "math",
          examIds: results.items.slice(0, 2).map(r => r.exam_id)
        }, auth);
        usedTools.push("get_self_outcome_breakdown");

        const weak = outcomes.outcomes.filter(o => o.success_rate < 0.5);
        if (weak.length > 0) {
          text += "\n\n🔍 **Geliştirilmesi gereken konular:**\n";
          weak.sort((a, b) => a.success_rate - b.success_rate).forEach(o => {
            const pct = Math.round(o.success_rate * 100);
            text += `• ${o.outcome_name}: %${pct} başarı\n`;
          });
          text += "\nBu konularda sana yardımcı olabilirim. Hangisiyle başlayalım?";
        }
      }

      return text;
    }

    if (msg.includes("ödev")) {
      const assignments = executeTool("get_self_assignments", { status: "pending", limit: 10 }, auth);
      usedTools.push("get_self_assignments");

      if (assignments.items.length === 0) return "🎉 Tebrikler! Bekleyen ödevin yok.";

      let text = `📝 **Bekleyen ödevlerin:**\n\n`;
      assignments.items.forEach(a => {
        text += `• **${a.title}** (${a.subject}) — Son tarih: ${a.due_date}\n`;
      });
      text += `\nToplam ${assignments.items.length} bekleyen ödevin var. Yardıma ihtiyacın olursa sor!`;
      return text;
    }

    if (msg.includes("eksik") || msg.includes("zayıf") || msg.includes("konu") || msg.includes("tekrar")) {
      const results = executeTool("get_self_exam_results", { subject: "math", limit: 3 }, auth);
      usedTools.push("get_self_exam_results");
      const examIds = results.items.map(r => r.exam_id);
      if (examIds.length === 0) return "Henüz analiz yapacak yeterli sınav verim yok.";

      const outcomes = executeTool("get_self_outcome_breakdown", { subject: "math", examIds }, auth);
      usedTools.push("get_self_outcome_breakdown");

      const weak = outcomes.outcomes.filter(o => o.success_rate < 0.6).sort((a, b) => a.success_rate - b.success_rate);
      const strong = outcomes.outcomes.filter(o => o.success_rate >= 0.7).sort((a, b) => b.success_rate - a.success_rate);

      let text = `📊 **Konu Bazlı Analiz** (Son ${examIds.length} sınav)\n\n`;

      if (weak.length > 0) {
        text += "🔴 **Geliştirilmesi gereken konular:**\n";
        weak.forEach(o => text += `• ${o.outcome_name} — %${Math.round(o.success_rate * 100)}\n`);
      }
      if (strong.length > 0) {
        text += "\n🟢 **Güçlü olduğun konular:**\n";
        strong.forEach(o => text += `• ${o.outcome_name} — %${Math.round(o.success_rate * 100)}\n`);
      }

      text += "\n💡 Öncelikle en düşük başarı oranına sahip konulardan başlayarak tekrar yapmanı öneririm.";
      if (weak.length > 0) text += ` Özellikle **${weak[0].outcome_name}** konusuna odaklanabilirsin.`;

      return text;
    }

    if (msg.includes("plan") || msg.includes("çalışma") || msg.includes("program")) {
      const results = executeTool("get_self_exam_results", { subject: "math", limit: 3 }, auth);
      usedTools.push("get_self_exam_results");
      const examIds = results.items.map(r => r.exam_id);
      const outcomes = examIds.length > 0 ? executeTool("get_self_outcome_breakdown", { subject: "math", examIds }, auth) : { outcomes: [] };
      if (examIds.length > 0) usedTools.push("get_self_outcome_breakdown");

      const weak = outcomes.outcomes.filter(o => o.success_rate < 0.6).sort((a, b) => a.success_rate - b.success_rate);

      let text = `📅 **Haftalık Çalışma Planı** — ${profile.full_name}\n\n`;
      const days = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma"];
      const topics = weak.length > 0 ? weak.map(o => o.outcome_name) : ["Genel tekrar"];

      days.forEach((day, i) => {
        const topic = topics[i % topics.length];
        text += `📌 **${day}:** ${topic} (30 dk)\n`;
        if (i < 2) text += `   → Konu tekrarı + 5 örnek soru\n`;
        else if (i < 4) text += `   → Alıştırma çöz + hataları not et\n`;
        else text += `   → Mini tekrar quiz + genel değerlendirme\n`;
      });

      text += "\n💪 Küçük adımlarla ilerlersen büyük fark yaratırsın. Her gün 30 dakika yeter!";
      return text;
    }

    // Default greeting
    return `Merhaba ${profile.full_name}! 👋\n\nBen senin öğrenme asistanınım. Sana şu konularda yardımcı olabilirim:\n\n` +
      `📊 **Sınav sonuçlarım** — "Sınav sonuçlarımı göster"\n` +
      `📝 **Ödevlerim** — "Bekleyen ödevlerim ne?"\n` +
      `🔍 **Eksik konularım** — "Hangi konularda eksik var?"\n` +
      `📅 **Çalışma planı** — "Bana çalışma planı yap"\n\n` +
      `Ne hakkında konuşmak istersin?`;
  }

  async _handleTeacher(msg, original, auth, usedTools) {
    const classes = executeTool("list_teacher_classes", {}, auth);
    usedTools.push("list_teacher_classes");

    if (msg.includes("sınıf") && (msg.includes("liste") || msg.includes("hangi") || msg.includes("göster"))) {
      let text = `📚 **Sınıflarınız:**\n\n`;
      classes.classes.forEach(c => {
        text += `• **${c.name}** (${c.subject})\n`;
      });
      return text;
    }

    if (msg.includes("başarı") || msg.includes("performans") || msg.includes("analiz") || msg.includes("sonuç")) {
      const targetClass = classes.classes[0]; // Default to first class
      const examResults = executeTool("get_class_exam_results", { class_id: targetClass.class_id, subject: targetClass.subject, limit: 50 }, auth);
      usedTools.push("get_class_exam_results");

      const outcomes = executeTool("get_class_outcome_breakdown", { class_id: targetClass.class_id, subject: targetClass.subject }, auth);
      usedTools.push("get_class_outcome_breakdown");

      let text = `📊 **${targetClass.name} — Sınıf Analizi**\n\n`;

      // Group by exam
      const byExam = {};
      examResults.items.forEach(r => {
        if (!byExam[r.exam_name]) byExam[r.exam_name] = [];
        byExam[r.exam_name].push(r);
      });

      Object.entries(byExam).forEach(([name, results]) => {
        const avg = Math.round(results.reduce((s, r) => s + r.score, 0) / results.length);
        const min = Math.min(...results.map(r => r.score));
        const max = Math.max(...results.map(r => r.score));
        text += `📝 **${name}**\n`;
        text += `   Ortalama: ${avg} | En düşük: ${min} | En yüksek: ${max}\n\n`;
      });

      if (outcomes.outcomes.length > 0) {
        text += `🔍 **Kazanım Bazlı Analiz:**\n`;
        outcomes.outcomes.forEach(o => {
          const pct = Math.round(o.average_success_rate * 100);
          const bar = pct >= 60 ? "🟢" : pct >= 40 ? "🟡" : "🔴";
          text += `${bar} ${o.outcome_name}: %${pct}\n`;
        });

        const weakest = outcomes.outcomes.filter(o => o.average_success_rate < 0.5);
        if (weakest.length > 0) {
          text += `\n⚠️ **Öneriler:**\n`;
          weakest.forEach(o => {
            text += `• "${o.outcome_name}" konusunda sınıf genelinde %${Math.round(o.average_success_rate * 100)} başarı var. Bu konuda ek çalışma önerilir.\n`;
          });
        }
      }

      return text;
    }

    if (msg.includes("risk") || msg.includes("düşük") || msg.includes("sorunlu") || msg.includes("zorlan")) {
      const targetClass = classes.classes[0];
      const examResults = executeTool("get_class_exam_results", { class_id: targetClass.class_id, limit: 50 }, auth);
      usedTools.push("get_class_exam_results");

      // Find students with consistently low scores
      const studentScores = {};
      examResults.items.forEach(r => {
        if (!studentScores[r.student_id]) studentScores[r.student_id] = { name: r.student_name, scores: [] };
        studentScores[r.student_id].scores.push(r.score);
      });

      const atRisk = Object.entries(studentScores)
        .map(([id, data]) => ({
          id, name: data.name,
          avg: Math.round(data.scores.reduce((s, v) => s + v, 0) / data.scores.length),
          trend: data.scores.length >= 2 ? data.scores[0] - data.scores[data.scores.length - 1] : 0
        }))
        .filter(s => s.avg < 60 || s.trend < -10)
        .sort((a, b) => a.avg - b.avg);

      let text = `🚨 **${targetClass.name} — Risk Analizi**\n\n`;
      if (atRisk.length === 0) {
        text += "✅ Bu sınıfta belirgin risk grubu tespit edilmedi.";
      } else {
        atRisk.forEach(s => {
          text += `⚠️ **${s.name}** — Ortalama: ${s.avg}`;
          if (s.trend < -10) text += ` (düşüş eğilimi: ${s.trend} puan)`;
          text += "\n";
        });
        text += "\n💡 Bu öğrenciler için bireysel görüşme veya ek etüt düşünülebilir.";
      }
      return text;
    }

    if (msg.includes("öğrenci") && msg.includes("listele")) {
      const targetClass = classes.classes[0];
      const studentsData = executeTool("list_class_students", { class_id: targetClass.class_id }, auth);
      usedTools.push("list_class_students");

      let text = `👥 **${targetClass.name} Öğrenci Listesi:**\n\n`;
      studentsData.items.forEach((s, i) => {
        text += `${i + 1}. ${s.full_name}\n`;
      });
      text += `\nToplam: ${studentsData.pagination.total} öğrenci`;
      return text;
    }

    // Default
    return `Merhaba ${auth.full_name}! 👋\n\nSize şu konularda yardımcı olabilirim:\n\n` +
      `📚 **Sınıflarım** — "Sınıflarımı göster"\n` +
      `📊 **Sınıf analizi** — "Sınıf başarı analizi"\n` +
      `🚨 **Risk analizi** — "Riskli öğrenciler"\n` +
      `👥 **Öğrenci listesi** — "Öğrencileri listele"\n\n` +
      `${classes.classes.length} sınıfınız mevcut. Ne hakkında konuşalım?`;
  }

  async _handleParent(msg, original, auth, usedTools) {
    const children = executeTool("list_my_children", {}, auth);
    usedTools.push("list_my_children");

    if (children.children.length === 0) return "Sistemde kayıtlı çocuğunuz bulunmuyor.";

    const child = children.children[0];

    if (msg.includes("sınav") || msg.includes("not") || msg.includes("sonuç") || msg.includes("durum") || msg.includes("nasıl")) {
      const exams = executeTool("get_child_exam_results", { child_id: child.child_id, limit: 5 }, auth);
      usedTools.push("get_child_exam_results");

      const attendance = executeTool("get_child_attendance", { child_id: child.child_id, period: "this_month" }, auth);
      usedTools.push("get_child_attendance");

      const assignments = executeTool("get_child_assignments", { child_id: child.child_id, limit: 10 }, auth);
      usedTools.push("get_child_assignments");

      let text = `📋 **${child.full_name} — Aylık Durum Raporu**\n`;
      text += `Sınıf: ${child.grade_level}/${child.branch}\n\n`;

      // Exam summary
      text += `📊 **Sınav Sonuçları:**\n`;
      if (exams.items.length > 0) {
        exams.items.forEach(e => {
          const emoji = e.score >= 70 ? "✅" : e.score >= 50 ? "⚠️" : "❌";
          text += `${emoji} ${e.exam_name}: ${e.score}/${e.max_score}\n`;
        });
        const avg = Math.round(exams.items.reduce((s, r) => s + r.score, 0) / exams.items.length);
        text += `Ortalama: ${avg}\n`;
      } else {
        text += "Henüz sınav sonucu yok.\n";
      }

      // Attendance
      text += `\n📅 **Devam Durumu (Bu Ay):**\n`;
      text += `Devamsız: ${attendance.summary.absent_days} gün | Geç kaldı: ${attendance.summary.late_days} gün\n`;

      // Assignments
      const pending = assignments.items.filter(a => a.status === "pending");
      text += `\n📝 **Ödevler:**\n`;
      text += `Bekleyen: ${pending.length} ödev\n`;

      // Overall assessment
      const avg = exams.items.length > 0 ? Math.round(exams.items.reduce((s, r) => s + r.score, 0) / exams.items.length) : null;
      text += `\n💬 **Genel Değerlendirme:**\n`;
      if (avg !== null) {
        if (avg >= 75) text += `${child.full_name} genel olarak iyi gidiyor. Sınav ortalaması tatmin edici düzeyde. Bu ivmeyi korumak için düzenli çalışmaya devam etmesi yeterli.`;
        else if (avg >= 55) text += `${child.full_name} ortalama düzeyde ilerliyor. Bazı konularda ek çalışma yapması faydalı olabilir. Düzenli günlük tekrar ile kısa sürede gelişme gösterebilir.`;
        else text += `${child.full_name}'ın son dönemde bazı konularda zorlandığı görünüyor. Panik yapmaya gerek yok — düzenli ve kısa çalışma seansları ile toparlanabilir. Öğretmeniyle görüşmeniz de faydalı olabilir.`;
      }

      if (attendance.summary.absent_days > 3) text += `\n\n⚠️ Devamsızlık biraz yüksek (${attendance.summary.absent_days} gün). Dersleri takip edebilmesi için devam durumuna dikkat edilmesi önerilir.`;

      return text;
    }

    if (msg.includes("ödev")) {
      const assignments = executeTool("get_child_assignments", { child_id: child.child_id, limit: 10 }, auth);
      usedTools.push("get_child_assignments");

      let text = `📝 **${child.full_name}'ın Ödevleri:**\n\n`;
      assignments.items.forEach(a => {
        const emoji = a.status === "submitted" ? "✅" : a.status === "pending" ? "⏳" : a.status === "late" ? "❌" : "📝";
        text += `${emoji} ${a.title} — ${a.status === "pending" ? "Bekliyor" : a.status === "submitted" ? "Teslim edildi" : a.status === "late" ? "Geç teslim" : a.status}\n`;
      });
      return text;
    }

    if (msg.includes("devam") || msg.includes("yoklama") || msg.includes("devamsız")) {
      const attendance = executeTool("get_child_attendance", { child_id: child.child_id, period: "this_month" }, auth);
      usedTools.push("get_child_attendance");

      return `📅 **${child.full_name} — Devam Durumu (Bu Ay)**\n\n` +
        `✅ Katıldı: ${attendance.summary.present_days} gün\n` +
        `❌ Devamsız: ${attendance.summary.absent_days} gün\n` +
        `⏰ Geç kaldı: ${attendance.summary.late_days} gün`;
    }

    // Default
    return `Merhaba ${auth.full_name}! 👋\n\n` +
      `Çocuğunuz **${child.full_name}** (${child.grade_level}/${child.branch}) hakkında soru sorabilirsiniz:\n\n` +
      `📊 **Durum raporu** — "Çocuğum nasıl gidiyor?"\n` +
      `📝 **Ödevler** — "Ödevlerini yapıyor mu?"\n` +
      `📅 **Devam** — "Devamsızlık durumu ne?"\n` +
      `📈 **Sınavlar** — "Sınav sonuçları nasıl?"\n`;
  }
}

module.exports = new ChatOrchestrator();
