const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const DB_PATH = path.join(__dirname, "../../data/school.db");
require("fs").mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ── SCHEMA ──
db.exec(`
  CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('student','teacher','parent','admin')), full_name TEXT NOT NULL, email TEXT, school_id TEXT DEFAULT 'school_main', created_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS students (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), grade_level INTEGER NOT NULL, branch TEXT NOT NULL, school_number TEXT, UNIQUE(user_id));
  CREATE TABLE IF NOT EXISTS teachers (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), subjects TEXT NOT NULL, UNIQUE(user_id));
  CREATE TABLE IF NOT EXISTS parents (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), UNIQUE(user_id));
  CREATE TABLE IF NOT EXISTS parent_children (parent_id TEXT NOT NULL REFERENCES parents(id), student_id TEXT NOT NULL REFERENCES students(id), PRIMARY KEY(parent_id, student_id));
  CREATE TABLE IF NOT EXISTS classes (id TEXT PRIMARY KEY, name TEXT NOT NULL, grade_level INTEGER NOT NULL, branch TEXT NOT NULL, subject TEXT NOT NULL, teacher_id TEXT NOT NULL REFERENCES teachers(id));
  CREATE TABLE IF NOT EXISTS class_students (class_id TEXT NOT NULL REFERENCES classes(id), student_id TEXT NOT NULL REFERENCES students(id), PRIMARY KEY(class_id, student_id));
  CREATE TABLE IF NOT EXISTS exams (id TEXT PRIMARY KEY, name TEXT NOT NULL, subject TEXT NOT NULL, class_id TEXT REFERENCES classes(id), exam_date TEXT NOT NULL, max_score INTEGER DEFAULT 100, created_by TEXT REFERENCES teachers(id));
  CREATE TABLE IF NOT EXISTS exam_results (id TEXT PRIMARY KEY, exam_id TEXT NOT NULL REFERENCES exams(id), student_id TEXT NOT NULL REFERENCES students(id), score INTEGER NOT NULL, UNIQUE(exam_id, student_id));
  CREATE TABLE IF NOT EXISTS outcomes (id TEXT PRIMARY KEY, code TEXT NOT NULL, name TEXT NOT NULL, subject TEXT NOT NULL, grade_level INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS exam_outcome_results (id TEXT PRIMARY KEY, exam_id TEXT NOT NULL REFERENCES exams(id), student_id TEXT NOT NULL REFERENCES students(id), outcome_id TEXT NOT NULL REFERENCES outcomes(id), correct_count INTEGER NOT NULL, total_count INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS assignments (id TEXT PRIMARY KEY, title TEXT NOT NULL, subject TEXT NOT NULL, class_id TEXT REFERENCES classes(id), due_date TEXT, created_by TEXT REFERENCES teachers(id), created_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS assignment_submissions (id TEXT PRIMARY KEY, assignment_id TEXT NOT NULL REFERENCES assignments(id), student_id TEXT NOT NULL REFERENCES students(id), status TEXT NOT NULL CHECK(status IN ('pending','submitted','graded','late')), submitted_at TEXT, score INTEGER, UNIQUE(assignment_id, student_id));
  CREATE TABLE IF NOT EXISTS attendance (id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id), date TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('present','absent','late','excused')), UNIQUE(student_id, date));
  CREATE TABLE IF NOT EXISTS ai_sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), agent_key TEXT NOT NULL, session_type TEXT DEFAULT 'chat', title TEXT, status TEXT DEFAULT 'active', last_summary TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS ai_messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES ai_sessions(id), role TEXT NOT NULL CHECK(role IN ('user','assistant','system','tool')), content TEXT NOT NULL, used_tools TEXT, created_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS audit_log (id TEXT PRIMARY KEY, request_id TEXT, session_id TEXT, user_id TEXT, role TEXT, agent TEXT, tool_name TEXT, input_summary TEXT, response_size INTEGER, duration_ms INTEGER, school_id TEXT, success INTEGER, error_code TEXT, created_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS user_memory (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, category TEXT NOT NULL DEFAULT 'general', key TEXT NOT NULL, value TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, category, key));
`);

// ── CLEAR ──
const tables = ["user_memory","audit_log","ai_messages","ai_sessions","attendance","assignment_submissions","assignments","exam_outcome_results","exam_results","exams","class_students","classes","parent_children","parents","teachers","students","outcomes","users"];
tables.forEach(t => db.exec(`DELETE FROM ${t}`));

const hash = (pw) => bcrypt.hashSync(pw, 10);
const uid = () => uuidv4().slice(0,8);
const pw = hash("123456");
const apw = hash("admin123");

// ══════════════════════════════════════
// USERS — 20 öğrenci, 4 öğretmen, 6 veli, 1 admin
// ══════════════════════════════════════
const insUser = db.prepare("INSERT INTO users(id,username,password_hash,role,full_name,email,school_id) VALUES (?,?,?,?,?,?,?)");

// Öğrenciler
const studentNames = [
  ["u_stu1","ahmet","Ahmet Yılmaz"],["u_stu2","zeynep","Zeynep Demir"],["u_stu3","emre","Emre Kara"],
  ["u_stu4","elif","Elif Çelik"],["u_stu5","burak","Burak Arslan"],["u_stu6","selin","Selin Yıldız"],
  ["u_stu7","can","Can Özdemir"],["u_stu8","defne","Defne Aydın"],["u_stu9","mert","Mert Şahin"],
  ["u_stu10","ecrin","Ecrin Koç"],["u_stu11","yusuf","Yusuf Çetin"],["u_stu12","ada","Ada Korkmaz"],
  ["u_stu13","kerem","Kerem Polat"],["u_stu14","nehir","Nehir Erdoğan"],["u_stu15","arda","Arda Aksoy"],
  ["u_stu16","azra","Azra Güneş"],["u_stu17","emir","Emir Doğan"],["u_stu18","lina","Lina Yıldırım"],
  ["u_stu19","baran","Baran Kılıç"],["u_stu20","duru","Duru Öztürk"]
];
studentNames.forEach(([id,un,fn]) => insUser.run(id,un,pw,"student",fn,un+"@school.com","school_main"));

// Öğretmenler
[["u_tch1","ayse.ogretmen","Ayşe Kaya"],["u_tch2","mehmet.ogretmen","Mehmet Öztürk"],
 ["u_tch3","fatma.ogretmen","Fatma Demir"],["u_tch4","ali.ogretmen","Ali Yılmaz"]
].forEach(([id,un,fn]) => insUser.run(id,un,pw,"teacher",fn,un+"@school.com","school_main"));

// Veliler
[["u_par1","veli.yilmaz","Mehmet Yılmaz"],["u_par2","veli.demir","Fatma Demir"],
 ["u_par3","veli.kara","Hasan Kara"],["u_par4","veli.celik","Ayşe Çelik"],
 ["u_par5","veli.ozdemir","Mustafa Özdemir"],["u_par6","veli.aydin","Zehra Aydın"]
].forEach(([id,un,fn]) => insUser.run(id,un,pw,"parent",fn,un+"@parent.com","school_main"));

// Admin
insUser.run("u_admin","admin",apw,"admin","Sistem Yöneticisi","admin@school.com","school_main");

// ══════════════════════════════════════
// STUDENTS — 7A(6), 7B(5), 7C(4), 8A(5)
// ══════════════════════════════════════
const insStu = db.prepare("INSERT INTO students VALUES (?,?,?,?,?)");
const stuData = [
  ["stu_1","u_stu1",7,"A","1542"],["stu_2","u_stu2",7,"A","1543"],["stu_3","u_stu3",7,"A","1544"],
  ["stu_4","u_stu4",7,"A","1545"],["stu_5","u_stu5",7,"A","1546"],["stu_6","u_stu6",7,"A","1547"],
  ["stu_7","u_stu7",7,"B","1548"],["stu_8","u_stu8",7,"B","1549"],["stu_9","u_stu9",7,"B","1550"],
  ["stu_10","u_stu10",7,"B","1551"],["stu_11","u_stu11",7,"B","1552"],
  ["stu_12","u_stu12",7,"C","1553"],["stu_13","u_stu13",7,"C","1554"],
  ["stu_14","u_stu14",7,"C","1555"],["stu_15","u_stu15",7,"C","1556"],
  ["stu_16","u_stu16",8,"A","1557"],["stu_17","u_stu17",8,"A","1558"],
  ["stu_18","u_stu18",8,"A","1559"],["stu_19","u_stu19",8,"A","1560"],["stu_20","u_stu20",8,"A","1561"]
];
stuData.forEach(s => insStu.run(...s));

// ══════════════════════════════════════
// TEACHERS — 4 öğretmen, farklı branşlar
// ══════════════════════════════════════
const insTch = db.prepare("INSERT INTO teachers VALUES (?,?,?)");
[["t_1","u_tch1","math"],["t_2","u_tch2","science"],["t_3","u_tch3","turkish"],["t_4","u_tch4","social"]
].forEach(t => insTch.run(...t));

// ══════════════════════════════════════
// PARENTS — 6 veli, her biri 1-2 çocuk
// ══════════════════════════════════════
const insPar = db.prepare("INSERT INTO parents VALUES (?,?)");
["p_1","p_2","p_3","p_4","p_5","p_6"].forEach((id,i) => insPar.run(id,"u_par"+(i+1)));

const insPC = db.prepare("INSERT INTO parent_children VALUES (?,?)");
insPC.run("p_1","stu_1"); // Yılmaz → Ahmet
insPC.run("p_2","stu_2"); // Demir → Zeynep
insPC.run("p_3","stu_3"); // Kara → Emre
insPC.run("p_4","stu_4"); // Çelik → Elif
insPC.run("p_4","stu_12"); // Çelik → Ada (iki çocuk)
insPC.run("p_5","stu_7"); // Özdemir → Can
insPC.run("p_6","stu_8"); // Aydın → Defne

// ══════════════════════════════════════
// CLASSES — 10 sınıf (mat+fen+türkçe+sosyal)
// ══════════════════════════════════════
const insCls = db.prepare("INSERT INTO classes VALUES (?,?,?,?,?,?)");
[
  ["7A-math","7/A Matematik",7,"A","math","t_1"],["7B-math","7/B Matematik",7,"B","math","t_1"],
  ["7C-math","7/C Matematik",7,"C","math","t_1"],["8A-math","8/A Matematik",8,"A","math","t_1"],
  ["7A-sci","7/A Fen Bilimleri",7,"A","science","t_2"],["7B-sci","7/B Fen Bilimleri",7,"B","science","t_2"],
  ["8A-sci","8/A Fen Bilimleri",8,"A","science","t_2"],
  ["7A-tur","7/A Türkçe",7,"A","turkish","t_3"],["7B-tur","7/B Türkçe",7,"B","turkish","t_3"],
  ["7A-sos","7/A Sosyal Bilgiler",7,"A","social","t_4"],
].forEach(c => insCls.run(...c));

// ── CLASS-STUDENTS ──
const cs = db.prepare("INSERT INTO class_students VALUES (?,?)");
// 7A öğrencileri
["stu_1","stu_2","stu_3","stu_4","stu_5","stu_6"].forEach(s => {
  cs.run("7A-math",s); cs.run("7A-sci",s); cs.run("7A-tur",s); cs.run("7A-sos",s);
});
// 7B öğrencileri
["stu_7","stu_8","stu_9","stu_10","stu_11"].forEach(s => {
  cs.run("7B-math",s); cs.run("7B-sci",s); cs.run("7B-tur",s);
});
// 7C öğrencileri
["stu_12","stu_13","stu_14","stu_15"].forEach(s => cs.run("7C-math",s));
// 8A öğrencileri
["stu_16","stu_17","stu_18","stu_19","stu_20"].forEach(s => {
  cs.run("8A-math",s); cs.run("8A-sci",s);
});

// ══════════════════════════════════════
// OUTCOMES — 20 kazanım (mat+fen+türk+sos)
// ══════════════════════════════════════
const insOut = db.prepare("INSERT INTO outcomes VALUES (?,?,?,?,?)");
[
  ["o1","M.7.1","Tam sayılarla işlemler","math",7],["o2","M.7.2","Rasyonel sayılar","math",7],
  ["o3","M.7.3","Kesirlerde sıralama","math",7],["o4","M.7.4","Yüzde problemleri","math",7],
  ["o5","M.7.5","Cebirsel ifadeler","math",7],["o6","M.7.6","Denklemler","math",7],
  ["o7","M.7.7","Oran ve orantı","math",7],["o8","M.7.8","Geometrik çizimler","math",7],
  ["o9","F.7.1","Maddenin yapısı","science",7],["o10","F.7.2","Kuvvet ve hareket","science",7],
  ["o11","F.7.3","Elektrik devreleri","science",7],["o12","F.7.4","Işık ve ses","science",7],
  ["o13","M.8.1","Üslü ifadeler","math",8],["o14","M.8.2","Kareköklü ifadeler","math",8],
  ["o15","M.8.3","Doğrusal denklemler","math",8],["o16","M.8.4","Eşitsizlikler","math",8],
  ["o17","T.7.1","Sözcükte anlam","turkish",7],["o18","T.7.2","Cümlede anlam","turkish",7],
  ["o19","S.7.1","İlk Türk devletleri","social",7],["o20","S.7.2","Osmanlı kuruluş dönemi","social",7],
].forEach(o => insOut.run(...o));

// ══════════════════════════════════════
// EXAMS — 12 sınav, farklı dersler ve tarihler
// ══════════════════════════════════════
const insExam = db.prepare("INSERT INTO exams VALUES (?,?,?,?,?,?,?)");
[
  ["exam_1","Matematik 1. Yazılı","math","7A-math","2025-11-15",100,"t_1"],
  ["exam_2","Matematik 2. Yazılı","math","7A-math","2025-12-20",100,"t_1"],
  ["exam_3","Matematik 1. Dönem Sonu","math","7A-math","2026-01-15",100,"t_1"],
  ["exam_4","Matematik 2. Dönem 1. Yazılı","math","7A-math","2026-02-20",100,"t_1"],
  ["exam_5","Matematik Deneme Sınavı","math","7A-math","2026-03-10",100,"t_1"],
  ["exam_6","Fen 1. Yazılı","science","7A-sci","2025-11-18",100,"t_2"],
  ["exam_7","Fen 2. Yazılı","science","7A-sci","2025-12-22",100,"t_2"],
  ["exam_8","Fen 1. Dönem Sonu","science","7A-sci","2026-01-18",100,"t_2"],
  ["exam_9","Fen 2. Dönem 1. Yazılı","science","7A-sci","2026-02-25",100,"t_2"],
  ["exam_10","7B Matematik 1. Yazılı","math","7B-math","2025-11-15",100,"t_1"],
  ["exam_11","7B Matematik 2. Yazılı","math","7B-math","2026-02-20",100,"t_1"],
  ["exam_12","8A Matematik 1. Yazılı","math","8A-math","2026-02-20",100,"t_1"],
].forEach(e => insExam.run(...e));

// ══════════════════════════════════════
// EXAM RESULTS — Gerçekçi puan dağılımları
// ══════════════════════════════════════
const insRes = db.prepare("INSERT INTO exam_results VALUES (?,?,?,?)");

// Ahmet: Matematikte düşüş trendi, Fen'de stabil
[["r1","exam_1","stu_1",78],["r2","exam_2","stu_1",72],["r3","exam_3","stu_1",68],["r4","exam_4","stu_1",65],["r5","exam_5","stu_1",58],
 ["r6","exam_6","stu_1",82],["r7","exam_7","stu_1",78],["r8","exam_8","stu_1",80],["r9","exam_9","stu_1",76]].forEach(r=>insRes.run(...r));

// Zeynep: Genel olarak başarılı, yükseliş trendi
[["r10","exam_1","stu_2",82],["r11","exam_2","stu_2",85],["r12","exam_3","stu_2",88],["r13","exam_4","stu_2",90],["r14","exam_5","stu_2",92],
 ["r15","exam_6","stu_2",75],["r16","exam_7","stu_2",80],["r17","exam_8","stu_2",78],["r18","exam_9","stu_2",85]].forEach(r=>insRes.run(...r));

// Emre: Düşük performans, dalgalı
[["r19","exam_1","stu_3",45],["r20","exam_2","stu_3",52],["r21","exam_3","stu_3",38],["r22","exam_4","stu_3",48],["r23","exam_5","stu_3",42],
 ["r24","exam_6","stu_3",55],["r25","exam_7","stu_3",50],["r26","exam_8","stu_3",48],["r27","exam_9","stu_3",52]].forEach(r=>insRes.run(...r));

// Elif: Ortalama, stabil
[["r28","exam_1","stu_4",70],["r29","exam_2","stu_4",68],["r30","exam_3","stu_4",72],["r31","exam_4","stu_4",70],["r32","exam_5","stu_4",71],
 ["r33","exam_6","stu_4",65],["r34","exam_7","stu_4",68],["r35","exam_8","stu_4",70],["r36","exam_9","stu_4",66]].forEach(r=>insRes.run(...r));

// Burak: İyi başlayıp düşüş
[["r37","exam_1","stu_5",85],["r38","exam_2","stu_5",80],["r39","exam_3","stu_5",75],["r40","exam_4","stu_5",68],["r41","exam_5","stu_5",62],
 ["r42","exam_6","stu_5",78],["r43","exam_7","stu_5",72],["r44","exam_8","stu_5",70],["r45","exam_9","stu_5",65]].forEach(r=>insRes.run(...r));

// Selin: Fen'de çok iyi, Mat'ta orta
[["r46","exam_1","stu_6",65],["r47","exam_2","stu_6",68],["r48","exam_3","stu_6",62],["r49","exam_4","stu_6",66],["r50","exam_5","stu_6",64],
 ["r51","exam_6","stu_6",90],["r52","exam_7","stu_6",92],["r53","exam_8","stu_6",88],["r54","exam_9","stu_6",94]].forEach(r=>insRes.run(...r));

// 7B öğrencileri
[["r55","exam_10","stu_7",72],["r56","exam_11","stu_7",75],
 ["r57","exam_10","stu_8",88],["r58","exam_11","stu_8",90],
 ["r59","exam_10","stu_9",55],["r60","exam_11","stu_9",50],
 ["r61","exam_10","stu_10",78],["r62","exam_11","stu_10",80],
 ["r63","exam_10","stu_11",62],["r64","exam_11","stu_11",58]].forEach(r=>insRes.run(...r));

// 8A öğrencileri
[["r65","exam_12","stu_16",74],["r66","exam_12","stu_17",82],["r67","exam_12","stu_18",68],
 ["r68","exam_12","stu_19",90],["r69","exam_12","stu_20",55]].forEach(r=>insRes.run(...r));

// ══════════════════════════════════════
// OUTCOME RESULTS — Kazanım detayları (son sınavlar)
// ══════════════════════════════════════
const insOR = db.prepare("INSERT INTO exam_outcome_results VALUES (?,?,?,?,?,?)");

// Ahmet - exam_5 (Mat deneme) — kesirler ve orantıda zayıf
[[uid(),"exam_5","stu_1","o1",3,4],[uid(),"exam_5","stu_1","o2",2,4],[uid(),"exam_5","stu_1","o3",1,4],
 [uid(),"exam_5","stu_1","o4",2,4],[uid(),"exam_5","stu_1","o5",3,4],[uid(),"exam_5","stu_1","o6",2,4],
 [uid(),"exam_5","stu_1","o7",1,3],[uid(),"exam_5","stu_1","o8",1,3]].forEach(r=>insOR.run(...r));

// Ahmet - exam_4 outcomes
[[uid(),"exam_4","stu_1","o1",3,4],[uid(),"exam_4","stu_1","o2",2,4],[uid(),"exam_4","stu_1","o3",1,4],
 [uid(),"exam_4","stu_1","o4",2,4],[uid(),"exam_4","stu_1","o5",3,4],[uid(),"exam_4","stu_1","o6",2,4],
 [uid(),"exam_4","stu_1","o7",2,3],[uid(),"exam_4","stu_1","o8",2,3]].forEach(r=>insOR.run(...r));

// Ahmet - exam_9 (Fen) — genel olarak iyi
[[uid(),"exam_9","stu_1","o9",3,4],[uid(),"exam_9","stu_1","o10",3,4],
 [uid(),"exam_9","stu_1","o11",2,4],[uid(),"exam_9","stu_1","o12",3,4]].forEach(r=>insOR.run(...r));

// Zeynep - exam_5 — güçlü performans
[[uid(),"exam_5","stu_2","o1",4,4],[uid(),"exam_5","stu_2","o2",4,4],[uid(),"exam_5","stu_2","o3",3,4],
 [uid(),"exam_5","stu_2","o4",4,4],[uid(),"exam_5","stu_2","o5",4,4],[uid(),"exam_5","stu_2","o6",3,4],
 [uid(),"exam_5","stu_2","o7",3,3],[uid(),"exam_5","stu_2","o8",3,3]].forEach(r=>insOR.run(...r));

// Emre - exam_5 — çoğu alanda zayıf
[[uid(),"exam_5","stu_3","o1",2,4],[uid(),"exam_5","stu_3","o2",1,4],[uid(),"exam_5","stu_3","o3",1,4],
 [uid(),"exam_5","stu_3","o4",1,4],[uid(),"exam_5","stu_3","o5",1,4],[uid(),"exam_5","stu_3","o6",1,4],
 [uid(),"exam_5","stu_3","o7",1,3],[uid(),"exam_5","stu_3","o8",2,3]].forEach(r=>insOR.run(...r));

// Elif - exam_5
[[uid(),"exam_5","stu_4","o1",3,4],[uid(),"exam_5","stu_4","o2",3,4],[uid(),"exam_5","stu_4","o3",2,4],
 [uid(),"exam_5","stu_4","o4",3,4],[uid(),"exam_5","stu_4","o5",3,4],[uid(),"exam_5","stu_4","o6",2,4],
 [uid(),"exam_5","stu_4","o7",2,3],[uid(),"exam_5","stu_4","o8",2,3]].forEach(r=>insOR.run(...r));

// Burak - exam_5
[[uid(),"exam_5","stu_5","o1",3,4],[uid(),"exam_5","stu_5","o2",2,4],[uid(),"exam_5","stu_5","o3",2,4],
 [uid(),"exam_5","stu_5","o4",2,4],[uid(),"exam_5","stu_5","o5",2,4],[uid(),"exam_5","stu_5","o6",2,4],
 [uid(),"exam_5","stu_5","o7",1,3],[uid(),"exam_5","stu_5","o8",2,3]].forEach(r=>insOR.run(...r));

// Selin - exam_5
[[uid(),"exam_5","stu_6","o1",3,4],[uid(),"exam_5","stu_6","o2",2,4],[uid(),"exam_5","stu_6","o3",2,4],
 [uid(),"exam_5","stu_6","o4",2,4],[uid(),"exam_5","stu_6","o5",2,4],[uid(),"exam_5","stu_6","o6",2,4],
 [uid(),"exam_5","stu_6","o7",2,3],[uid(),"exam_5","stu_6","o8",2,3]].forEach(r=>insOR.run(...r));

// ══════════════════════════════════════
// ASSIGNMENTS — 10 ödev, farklı dersler
// ══════════════════════════════════════
const insAsg = db.prepare("INSERT INTO assignments(id,title,subject,class_id,due_date,created_by) VALUES (?,?,?,?,?,?)");
[
  ["asg_1","Kesirler çalışma kağıdı","math","7A-math","2026-03-05","t_1"],
  ["asg_2","Denklemler alıştırma seti","math","7A-math","2026-03-12","t_1"],
  ["asg_3","Oran-orantı problemleri","math","7A-math","2026-03-18","t_1"],
  ["asg_4","Cebirsel ifadeler testi","math","7A-math","2026-03-25","t_1"],
  ["asg_5","Geometrik çizimler projesi","math","7A-math","2026-04-01","t_1"],
  ["asg_6","Madde ve ısı deneyi raporu","science","7A-sci","2026-03-08","t_2"],
  ["asg_7","Kuvvet ve hareket soruları","science","7A-sci","2026-03-15","t_2"],
  ["asg_8","Elektrik devreleri ödevi","science","7A-sci","2026-03-22","t_2"],
  ["asg_9","7B Kesirler ödevi","math","7B-math","2026-03-10","t_1"],
  ["asg_10","8A Üslü ifadeler","math","8A-math","2026-03-15","t_1"],
].forEach(a => insAsg.run(...a));

// ── SUBMISSIONS ──
const insSub = db.prepare("INSERT INTO assignment_submissions VALUES (?,?,?,?,?,?)");
// 7A öğrencileri — çeşitli durumlar
["stu_1","stu_2","stu_3","stu_4","stu_5","stu_6"].forEach(sid => {
  // asg_1 (geçmiş)
  if(sid==="stu_1") insSub.run(uid(),"asg_1",sid,"graded","2026-03-04",60);
  else if(sid==="stu_2") insSub.run(uid(),"asg_1",sid,"graded","2026-03-03",95);
  else if(sid==="stu_3") insSub.run(uid(),"asg_1",sid,"late","2026-03-08",35);
  else if(sid==="stu_4") insSub.run(uid(),"asg_1",sid,"graded","2026-03-05",72);
  else if(sid==="stu_5") insSub.run(uid(),"asg_1",sid,"graded","2026-03-04",80);
  else insSub.run(uid(),"asg_1",sid,"graded","2026-03-05",68);

  // asg_2 (geçmiş)
  if(sid==="stu_1") insSub.run(uid(),"asg_2",sid,"graded","2026-03-11",55);
  else if(sid==="stu_2") insSub.run(uid(),"asg_2",sid,"graded","2026-03-10",90);
  else if(sid==="stu_3") insSub.run(uid(),"asg_2",sid,"late","2026-03-15",30);
  else insSub.run(uid(),"asg_2",sid,"graded","2026-03-11",65+Math.floor(Math.random()*15));

  // asg_3 (yakın geçmiş)
  if(sid==="stu_2") insSub.run(uid(),"asg_3",sid,"submitted","2026-03-16",null);
  else if(sid==="stu_3") insSub.run(uid(),"asg_3",sid,"pending",null,null);
  else insSub.run(uid(),"asg_3",sid,"submitted","2026-03-17",null);

  // asg_4 (gelecek)
  insSub.run(uid(),"asg_4",sid,"pending",null,null);

  // asg_5 (gelecek)
  insSub.run(uid(),"asg_5",sid,"pending",null,null);

  // Fen ödevleri
  if(sid==="stu_1") { insSub.run(uid(),"asg_6",sid,"graded","2026-03-07",78); insSub.run(uid(),"asg_7",sid,"graded","2026-03-14",72); insSub.run(uid(),"asg_8",sid,"pending",null,null); }
  else if(sid==="stu_2") { insSub.run(uid(),"asg_6",sid,"graded","2026-03-06",92); insSub.run(uid(),"asg_7",sid,"graded","2026-03-13",88); insSub.run(uid(),"asg_8",sid,"submitted","2026-03-20",null); }
  else if(sid==="stu_3") { insSub.run(uid(),"asg_6",sid,"late","2026-03-12",40); insSub.run(uid(),"asg_7",sid,"pending",null,null); insSub.run(uid(),"asg_8",sid,"pending",null,null); }
  else { insSub.run(uid(),"asg_6",sid,"graded","2026-03-07",70); insSub.run(uid(),"asg_7",sid,"submitted","2026-03-14",null); insSub.run(uid(),"asg_8",sid,"pending",null,null); }
});

// 7B — asg_9
["stu_7","stu_8","stu_9","stu_10","stu_11"].forEach(sid => {
  if(sid==="stu_8") insSub.run(uid(),"asg_9",sid,"graded","2026-03-09",88);
  else if(sid==="stu_9") insSub.run(uid(),"asg_9",sid,"pending",null,null);
  else insSub.run(uid(),"asg_9",sid,"submitted","2026-03-10",null);
});

// 8A — asg_10
["stu_16","stu_17","stu_18","stu_19","stu_20"].forEach(sid => {
  if(sid==="stu_19") insSub.run(uid(),"asg_10",sid,"graded","2026-03-13",95);
  else if(sid==="stu_20") insSub.run(uid(),"asg_10",sid,"pending",null,null);
  else insSub.run(uid(),"asg_10",sid,"submitted","2026-03-14",null);
});

// ══════════════════════════════════════
// ATTENDANCE — Ekim 2025'ten Mart 2026'ya (iş günleri)
// ══════════════════════════════════════
const insAtt = db.prepare("INSERT INTO attendance VALUES (?,?,?,?)");
const allStudents = stuData.map(s=>s[0]);

// Son 3 ay devamsızlık (Ocak-Mart 2026)
function getWorkdays(year, month) {
  const days = [];
  const d = new Date(year, month-1, 1);
  while (d.getMonth() === month-1) {
    if (d.getDay() > 0 && d.getDay() < 6) days.push(d.toISOString().slice(0,10));
    d.setDate(d.getDate()+1);
  }
  return days;
}

const months = [[2026,1],[2026,2],[2026,3]];
const workdays = months.flatMap(([y,m]) => getWorkdays(y,m)).filter(d => d <= "2026-03-14");

allStudents.forEach(sid => {
  workdays.forEach(dt => {
    let status = "present";
    // Emre: sık devamsız
    if(sid==="stu_3" && Math.random()<0.15) status = "absent";
    if(sid==="stu_3" && status==="present" && Math.random()<0.08) status = "late";
    // Can: ara sıra geç
    if(sid==="stu_7" && Math.random()<0.06) status = "late";
    // Duru: birkaç gün devamsız
    if(sid==="stu_20" && (dt==="2026-02-10"||dt==="2026-02-11"||dt==="2026-03-05")) status = "absent";
    // Ahmet: 1-2 geç kalma
    if(sid==="stu_1" && (dt==="2026-03-12"||dt==="2026-02-05")) status = "late";
    // Elif: mazaretli izin
    if(sid==="stu_4" && (dt==="2026-01-20"||dt==="2026-01-21")) status = "excused";
    insAtt.run(uid(), sid, dt, status);
  });
});

db.close();

console.log("✅ Zengin seed tamamlandı!");
console.log("\n📊 Özet:");
console.log("  20 öğrenci (7A:6, 7B:5, 7C:4, 8A:5)");
console.log("  4 öğretmen (Mat, Fen, Türkçe, Sosyal)");
console.log("  6 veli (biri 2 çocuklu)");
console.log("  10 sınıf");
console.log("  12 sınav");
console.log("  10 ödev");
console.log("  ~" + workdays.length + " gün devamsızlık kaydı x 20 öğrenci");
console.log("\n📋 Giriş Bilgileri:");
console.log("  🎓 ahmet/123456 (7A, düşüş trendi)");
console.log("  🎓 zeynep/123456 (7A, yükseliş trendi)");
console.log("  🎓 emre/123456 (7A, düşük performans)");
console.log("  🎓 elif/123456 (7A, stabil orta)");
console.log("  🎓 burak/123456 (7A, düşüş)");
console.log("  🎓 selin/123456 (7A, fen güçlü)");
console.log("  🎓 can/123456 (7B)");
console.log("  🎓 defne/123456 (7B, başarılı)");
console.log("  👩🏫 ayse.ogretmen/123456 (Mat)");
console.log("  👨🏫 mehmet.ogretmen/123456 (Fen)");
console.log("  👩🏫 fatma.ogretmen/123456 (Türkçe)");
console.log("  👨🏫 ali.ogretmen/123456 (Sosyal)");
console.log("  👨 veli.yilmaz/123456 (Ahmet'in babası)");
console.log("  👩 veli.demir/123456 (Zeynep'in annesi)");
console.log("  👨 veli.kara/123456 (Emre'nin babası)");
console.log("  👩 veli.celik/123456 (Elif+Ada'nın annesi)");
console.log("  🔑 admin/admin123");
