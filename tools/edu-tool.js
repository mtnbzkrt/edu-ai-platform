#!/usr/bin/env node
/**
 * edu-tool.js — Agent'ların okul verilerine erişim CLI aracı
 * 
 * Kullanım:
 *   node edu-tool.js <tool_name> [--param value ...] --token <jwt>
 * 
 * Örnekler:
 *   node edu-tool.js get_self_profile --token eyJ...
 *   node edu-tool.js get_self_exam_results --limit 5 --token eyJ...
 *   node edu-tool.js get_self_assignments --status pending --limit 10 --token eyJ...
 *   node edu-tool.js get_self_outcome_breakdown --exam_ids 1,2,3 --token eyJ...
 *   node edu-tool.js list_teacher_classes --token eyJ...
 *   node edu-tool.js get_class_exam_results --class_id 1 --token eyJ...
 *   node edu-tool.js list_my_children --token eyJ...
 *   node edu-tool.js get_child_exam_results --child_id 3 --limit 5 --token eyJ...
 */

const BASE_URL = process.env.EDU_API_URL || "https://edu.getinstaapp.com";

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args[0] === "--help") {
    console.log(`Kullanım: node edu-tool.js <tool_name> [--param value ...] --token <jwt>

Öğrenci araçları:
  get_self_profile
  get_self_exam_results       [--limit N] [--subject S]
  get_self_assignments        [--limit N] [--status S]
  get_self_outcome_breakdown  [--exam_ids 1,2,3] [--subject S]

Öğretmen araçları:
  list_teacher_classes
  list_class_students         --class_id N [--limit N]
  get_class_exam_results      --class_id N [--subject S]
  get_class_outcome_breakdown --class_id N [--subject S]
  get_student_exam_results    --student_id N [--limit N]

Veli araçları:
  list_my_children
  get_child_exam_results      --child_id N [--limit N]
  get_child_assignments       --child_id N [--limit N]
  get_child_attendance        --child_id N`);
    process.exit(0);
  }

  const toolName = args[0];
  let token = null;
  const params = {};

  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--token" && args[i + 1]) {
      token = args[++i];
    } else if (args[i].startsWith("--") && args[i + 1]) {
      const key = args[i].slice(2);
      let val = args[++i];
      // Handle comma-separated arrays (exam_ids)
      if (val.includes(",")) {
        val = val.split(",").map(v => isNaN(v) ? v : Number(v));
      } else if (!isNaN(val) && val !== "") {
        val = Number(val);
      }
      params[key] = val;
    }
  }

  if (!token) {
    console.error("Hata: --token parametresi gerekli");
    process.exit(1);
  }

  try {
    const url = `${BASE_URL}/api/ai/tools/${toolName}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ input: params })
    });

    const data = await res.json();
    
    if (!data.ok) {
      console.error(`Hata (${data.error?.code || res.status}): ${data.error?.message || "Bilinmeyen hata"}`);
      process.exit(1);
    }

    console.log(JSON.stringify(data.data, null, 2));
  } catch (err) {
    console.error(`Bağlantı hatası: ${err.message}`);
    process.exit(1);
  }
}

main();
