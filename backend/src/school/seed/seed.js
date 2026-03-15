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
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('student','teacher','parent','admin')),
    full_name TEXT NOT NULL,
    email TEXT,
    school_id TEXT DEFAULT 'school_main',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS students (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    grade_level INTEGER NOT NULL,
    branch TEXT NOT NULL,
    school_number TEXT,
    UNIQUE(user_id)
  );

  CREATE TABLE IF NOT EXISTS teachers (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    subjects TEXT NOT NULL,
    UNIQUE(user_id)
  );

  CREATE TABLE IF NOT EXISTS parents (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    UNIQUE(user_id)
  );

  CREATE TABLE IF NOT EXISTS parent_children (
    parent_id TEXT NOT NULL REFERENCES parents(id),
    student_id TEXT NOT NULL REFERENCES students(id),
    PRIMARY KEY(parent_id, student_id)
  );

  CREATE TABLE IF NOT EXISTS classes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    grade_level INTEGER NOT NULL,
    branch TEXT NOT NULL,
    subject TEXT NOT NULL,
    teacher_id TEXT NOT NULL REFERENCES teachers(id)
  );

  CREATE TABLE IF NOT EXISTS class_students (
    class_id TEXT NOT NULL REFERENCES classes(id),
    student_id TEXT NOT NULL REFERENCES students(id),
    PRIMARY KEY(class_id, student_id)
  );

  CREATE TABLE IF NOT EXISTS exams (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    subject TEXT NOT NULL,
    class_id TEXT REFERENCES classes(id),
    exam_date TEXT NOT NULL,
    max_score INTEGER DEFAULT 100,
    created_by TEXT REFERENCES teachers(id)
  );

  CREATE TABLE IF NOT EXISTS exam_results (
    id TEXT PRIMARY KEY,
    exam_id TEXT NOT NULL REFERENCES exams(id),
    student_id TEXT NOT NULL REFERENCES students(id),
    score INTEGER NOT NULL,
    UNIQUE(exam_id, student_id)
  );

  CREATE TABLE IF NOT EXISTS outcomes (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    subject TEXT NOT NULL,
    grade_level INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS exam_outcome_results (
    id TEXT PRIMARY KEY,
    exam_id TEXT NOT NULL REFERENCES exams(id),
    student_id TEXT NOT NULL REFERENCES students(id),
    outcome_id TEXT NOT NULL REFERENCES outcomes(id),
    correct_count INTEGER NOT NULL,
    total_count INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS assignments (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    subject TEXT NOT NULL,
    class_id TEXT REFERENCES classes(id),
    due_date TEXT,
    created_by TEXT REFERENCES teachers(id),
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS assignment_submissions (
    id TEXT PRIMARY KEY,
    assignment_id TEXT NOT NULL REFERENCES assignments(id),
    student_id TEXT NOT NULL REFERENCES students(id),
    status TEXT NOT NULL CHECK(status IN ('pending','submitted','graded','late')),
    submitted_at TEXT,
    score INTEGER,
    UNIQUE(assignment_id, student_id)
  );

  CREATE TABLE IF NOT EXISTS attendance (
    id TEXT PRIMARY KEY,
    student_id TEXT NOT NULL REFERENCES students(id),
    date TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('present','absent','late','excused')),
    UNIQUE(student_id, date)
  );

  CREATE TABLE IF NOT EXISTS ai_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    agent_key TEXT NOT NULL,
    session_type TEXT DEFAULT 'chat',
    title TEXT,
    status TEXT DEFAULT 'active',
    last_summary TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS ai_messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES ai_sessions(id),
    role TEXT NOT NULL CHECK(role IN ('user','assistant','system','tool')),
    content TEXT NOT NULL,
    used_tools TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    request_id TEXT,
    session_id TEXT,
    user_id TEXT,
    role TEXT,
    agent TEXT,
    tool_name TEXT,
    input_summary TEXT,
    response_size INTEGER,
    duration_ms INTEGER,
    school_id TEXT,
    success INTEGER,
    error_code TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS user_memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    category TEXT NOT NULL DEFAULT 'general',
    key TEXT NOT NULL,
    value TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, category, key)
  );
`);

// ── CLEAR ──
const tables = ["user_memory","audit_log","ai_messages","ai_sessions","attendance","assignment_submissions","assignments","exam_outcome_results","exam_results","exams","class_students","classes","parent_children","parents","teachers","students","outcomes","users"];
tables.forEach(t => db.exec(`DELETE FROM ${t}`));

// ── HELPERS ──
const hash = (pw) => bcrypt.hashSync(pw, 10);
const uid = () => uuidv4().slice(0,8);

// ── USERS ──
const users = [
  { id:"u_stu1", username:"ahmet", password_hash:hash("123456"), role:"student", full_name:"Ahmet Yılmaz", email:"ahmet@school.com" },
  { id:"u_stu2", username:"zeynep", password_hash:hash("123456"), role:"student", full_name:"Zeynep Demir", email:"zeynep@school.com" },
  { id:"u_stu3", username:"emre", password_hash:hash("123456"), role:"student", full_name:"Emre Kara", email:"emre@school.com" },
  { id:"u_stu4", username:"elif", password_hash:hash("123456"), role:"student", full_name:"Elif Çelik", email:"elif@school.com" },
  { id:"u_stu5", username:"burak", password_hash:hash("123456"), role:"student", full_name:"Burak Arslan", email:"burak@school.com" },
  { id:"u_stu6", username:"selin", password_hash:hash("123456"), role:"student", full_name:"Selin Yıldız", email:"selin@school.com" },
  { id:"u_tch1", username:"ayse.ogretmen", password_hash:hash("123456"), role:"teacher", full_name:"Ayşe Kaya", email:"ayse@school.com" },
  { id:"u_tch2", username:"mehmet.ogretmen", password_hash:hash("123456"), role:"teacher", full_name:"Mehmet Öztürk", email:"mehmet.oz@school.com" },
  { id:"u_par1", username:"veli.yilmaz", password_hash:hash("123456"), role:"parent", full_name:"Mehmet Yılmaz", email:"mehmet.y@parent.com" },
  { id:"u_par2", username:"veli.demir", password_hash:hash("123456"), role:"parent", full_name:"Fatma Demir", email:"fatma.d@parent.com" },
  { id:"u_admin", username:"admin", password_hash:hash("admin123"), role:"admin", full_name:"Sistem Yöneticisi", email:"admin@school.com" },
];
const insUser = db.prepare("INSERT INTO users(id,username,password_hash,role,full_name,email,school_id) VALUES (?,?,?,?,?,?,?)");
users.forEach(u => insUser.run(u.id, u.username, u.password_hash, u.role, u.full_name, u.email, "school_main"));

// ── STUDENTS ──
const students = [
  { id:"stu_1", user_id:"u_stu1", grade_level:7, branch:"A", school_number:"1542" },
  { id:"stu_2", user_id:"u_stu2", grade_level:7, branch:"A", school_number:"1543" },
  { id:"stu_3", user_id:"u_stu3", grade_level:7, branch:"A", school_number:"1544" },
  { id:"stu_4", user_id:"u_stu4", grade_level:7, branch:"B", school_number:"1545" },
  { id:"stu_5", user_id:"u_stu5", grade_level:8, branch:"A", school_number:"1546" },
  { id:"stu_6", user_id:"u_stu6", grade_level:8, branch:"A", school_number:"1547" },
];
const insStu = db.prepare("INSERT INTO students VALUES (?,?,?,?,?)");
students.forEach(s => insStu.run(s.id, s.user_id, s.grade_level, s.branch, s.school_number));

// ── TEACHERS ──
const teachersList = [
  { id:"t_1", user_id:"u_tch1", subjects:"math" },
  { id:"t_2", user_id:"u_tch2", subjects:"science" },
];
const insTch = db.prepare("INSERT INTO teachers VALUES (?,?,?)");
teachersList.forEach(t => insTch.run(t.id, t.user_id, t.subjects));

// ── PARENTS ──
const parentsList = [
  { id:"p_1", user_id:"u_par1" },
  { id:"p_2", user_id:"u_par2" },
];
const insPar = db.prepare("INSERT INTO parents VALUES (?,?)");
parentsList.forEach(p => insPar.run(p.id, p.user_id));

// ── PARENT-CHILD ──
db.prepare("INSERT INTO parent_children VALUES (?,?)").run("p_1","stu_1"); // Mehmet -> Ahmet
db.prepare("INSERT INTO parent_children VALUES (?,?)").run("p_2","stu_2"); // Fatma -> Zeynep

// ── CLASSES ──
const classesList = [
  { id:"7A-math", name:"7/A Matematik", grade_level:7, branch:"A", subject:"math", teacher_id:"t_1" },
  { id:"7B-math", name:"7/B Matematik", grade_level:7, branch:"B", subject:"math", teacher_id:"t_1" },
  { id:"8A-math", name:"8/A Matematik", grade_level:8, branch:"A", subject:"math", teacher_id:"t_1" },
  { id:"7A-sci", name:"7/A Fen Bilimleri", grade_level:7, branch:"A", subject:"science", teacher_id:"t_2" },
];
const insCls = db.prepare("INSERT INTO classes VALUES (?,?,?,?,?,?)");
classesList.forEach(c => insCls.run(c.id, c.name, c.grade_level, c.branch, c.subject, c.teacher_id));

// ── CLASS-STUDENTS ──
const cs = db.prepare("INSERT INTO class_students VALUES (?,?)");
["stu_1","stu_2","stu_3"].forEach(s => { cs.run("7A-math",s); cs.run("7A-sci",s); });
cs.run("7B-math","stu_4");
["stu_5","stu_6"].forEach(s => cs.run("8A-math",s));

// ── OUTCOMES ──
const outcomesList = [
  { id:"o1", code:"MATH-7-01", name:"Tam sayılarla işlemler", subject:"math", grade_level:7 },
  { id:"o2", code:"MATH-7-02", name:"Rasyonel sayılar", subject:"math", grade_level:7 },
  { id:"o3", code:"MATH-7-03", name:"Kesirlerde sıralama", subject:"math", grade_level:7 },
  { id:"o4", code:"MATH-7-04", name:"Yüzde problemleri", subject:"math", grade_level:7 },
  { id:"o5", code:"MATH-7-05", name:"Cebirsel ifadeler", subject:"math", grade_level:7 },
  { id:"o6", code:"MATH-7-06", name:"Denklemler", subject:"math", grade_level:7 },
  { id:"o7", code:"MATH-7-07", name:"Oran ve orantı", subject:"math", grade_level:7 },
  { id:"o8", code:"MATH-7-08", name:"Geometrik çizimler", subject:"math", grade_level:7 },
  { id:"o9", code:"SCI-7-01", name:"Maddenin yapısı", subject:"science", grade_level:7 },
  { id:"o10", code:"SCI-7-02", name:"Kuvvet ve hareket", subject:"science", grade_level:7 },
  { id:"o11", code:"MATH-8-01", name:"Üslü ifadeler", subject:"math", grade_level:8 },
  { id:"o12", code:"MATH-8-02", name:"Kareköklü ifadeler", subject:"math", grade_level:8 },
];
const insOut = db.prepare("INSERT INTO outcomes VALUES (?,?,?,?,?)");
outcomesList.forEach(o => insOut.run(o.id, o.code, o.name, o.subject, o.grade_level));

// ── EXAMS ──
const examsList = [
  { id:"exam_1", name:"Matematik 1. Yazılı", subject:"math", class_id:"7A-math", exam_date:"2026-01-20", max_score:100, created_by:"t_1" },
  { id:"exam_2", name:"Matematik 2. Yazılı", subject:"math", class_id:"7A-math", exam_date:"2026-02-15", max_score:100, created_by:"t_1" },
  { id:"exam_3", name:"Matematik Deneme 3", subject:"math", class_id:"7A-math", exam_date:"2026-03-01", max_score:100, created_by:"t_1" },
  { id:"exam_4", name:"Fen 1. Yazılı", subject:"science", class_id:"7A-sci", exam_date:"2026-01-22", max_score:100, created_by:"t_2" },
  { id:"exam_5", name:"8A Matematik Yazılı", subject:"math", class_id:"8A-math", exam_date:"2026-02-20", max_score:100, created_by:"t_1" },
];
const insExam = db.prepare("INSERT INTO exams VALUES (?,?,?,?,?,?,?)");
examsList.forEach(e => insExam.run(e.id, e.name, e.subject, e.class_id, e.exam_date, e.max_score, e.created_by));

// ── EXAM RESULTS ──
const results = [
  // exam_1
  ["r1","exam_1","stu_1",72], ["r2","exam_1","stu_2",85], ["r3","exam_1","stu_3",55],
  // exam_2
  ["r4","exam_2","stu_1",65], ["r5","exam_2","stu_2",90], ["r6","exam_2","stu_3",48],
  // exam_3
  ["r7","exam_3","stu_1",62], ["r8","exam_3","stu_2",88], ["r9","exam_3","stu_3",45],
  // exam_4 (science)
  ["r10","exam_4","stu_1",78], ["r11","exam_4","stu_2",70], ["r12","exam_4","stu_3",60],
  // exam_5 (8A)
  ["r13","exam_5","stu_5",74], ["r14","exam_5","stu_6",82],
];
const insRes = db.prepare("INSERT INTO exam_results VALUES (?,?,?,?)");
results.forEach(r => insRes.run(...r));

// ── OUTCOME RESULTS ──
const outcomeResults = [
  // Ahmet - exam_3 outcomes
  [uid(),"exam_3","stu_1","o1",3,4], [uid(),"exam_3","stu_1","o2",2,4], [uid(),"exam_3","stu_1","o3",1,4],
  [uid(),"exam_3","stu_1","o4",2,4], [uid(),"exam_3","stu_1","o5",3,4], [uid(),"exam_3","stu_1","o6",2,4],
  [uid(),"exam_3","stu_1","o7",1,3], [uid(),"exam_3","stu_1","o8",2,3],
  // Zeynep - exam_3 outcomes
  [uid(),"exam_3","stu_2","o1",4,4], [uid(),"exam_3","stu_2","o2",3,4], [uid(),"exam_3","stu_2","o3",3,4],
  [uid(),"exam_3","stu_2","o4",4,4], [uid(),"exam_3","stu_2","o5",3,4], [uid(),"exam_3","stu_2","o6",4,4],
  [uid(),"exam_3","stu_2","o7",3,3], [uid(),"exam_3","stu_2","o8",2,3],
  // Emre - exam_3 outcomes
  [uid(),"exam_3","stu_3","o1",2,4], [uid(),"exam_3","stu_3","o2",1,4], [uid(),"exam_3","stu_3","o3",1,4],
  [uid(),"exam_3","stu_3","o4",1,4], [uid(),"exam_3","stu_3","o5",2,4], [uid(),"exam_3","stu_3","o6",1,4],
  [uid(),"exam_3","stu_3","o7",1,3], [uid(),"exam_3","stu_3","o8",2,3],
];
const insOR = db.prepare("INSERT INTO exam_outcome_results VALUES (?,?,?,?,?,?)");
outcomeResults.forEach(r => insOR.run(...r));

// ── ASSIGNMENTS ──
const asgList = [
  { id:"asg_1", title:"Kesirler çalışma kağıdı", subject:"math", class_id:"7A-math", due_date:"2026-03-18", created_by:"t_1" },
  { id:"asg_2", title:"Denklemler alıştırma seti", subject:"math", class_id:"7A-math", due_date:"2026-03-22", created_by:"t_1" },
  { id:"asg_3", title:"Oran-orantı problemleri", subject:"math", class_id:"7A-math", due_date:"2026-03-25", created_by:"t_1" },
  { id:"asg_4", title:"Madde ve ısı deneyi raporu", subject:"science", class_id:"7A-sci", due_date:"2026-03-20", created_by:"t_2" },
];
const insAsg = db.prepare("INSERT INTO assignments(id,title,subject,class_id,due_date,created_by) VALUES (?,?,?,?,?,?)");
asgList.forEach(a => insAsg.run(a.id, a.title, a.subject, a.class_id, a.due_date, a.created_by));

// ── ASSIGNMENT SUBMISSIONS ──
const subs = [
  [uid(),"asg_1","stu_1","pending",null,null],
  [uid(),"asg_1","stu_2","submitted","2026-03-16",85],
  [uid(),"asg_1","stu_3","pending",null,null],
  [uid(),"asg_2","stu_1","pending",null,null],
  [uid(),"asg_2","stu_2","pending",null,null],
  [uid(),"asg_2","stu_3","pending",null,null],
  [uid(),"asg_3","stu_1","pending",null,null],
  [uid(),"asg_3","stu_2","submitted","2026-03-24",90],
  [uid(),"asg_3","stu_3","late","2026-03-27",40],
  [uid(),"asg_4","stu_1","submitted","2026-03-19",75],
  [uid(),"asg_4","stu_2","submitted","2026-03-18",92],
  [uid(),"asg_4","stu_3","pending",null,null],
];
const insSub = db.prepare("INSERT INTO assignment_submissions VALUES (?,?,?,?,?,?)");
subs.forEach(s => insSub.run(...s));

// ── ATTENDANCE ──
const attDates = [];
for (let d = 1; d <= 14; d++) {
  const dd = String(d).padStart(2,"0");
  const dayOfWeek = new Date(2026, 2, d).getDay();
  if (dayOfWeek > 0 && dayOfWeek < 6) attDates.push(`2026-03-${dd}`);
}
const insAtt = db.prepare("INSERT INTO attendance VALUES (?,?,?,?)");
["stu_1","stu_2","stu_3","stu_4","stu_5","stu_6"].forEach(sid => {
  attDates.forEach(dt => {
    let status = "present";
    if (sid === "stu_3" && (dt === "2026-03-05" || dt === "2026-03-10")) status = "absent";
    if (sid === "stu_1" && dt === "2026-03-12") status = "late";
    if (sid === "stu_3" && dt === "2026-03-03") status = "late";
    insAtt.run(uid(), sid, dt, status);
  });
});

db.close();
console.log("✅ Seed tamamlandı! Veritabanı:", DB_PATH);
console.log("\n📋 Kullanıcı Bilgileri:");
console.log("──────────────────────────────────────");
console.log("🎓 ÖĞRENCİ: ahmet / 123456  (Ahmet Yılmaz, 7/A)");
console.log("🎓 ÖĞRENCİ: zeynep / 123456  (Zeynep Demir, 7/A)");
console.log("🎓 ÖĞRENCİ: emre / 123456  (Emre Kara, 7/A)");
console.log("👩‍🏫 ÖĞRETMEN: ayse.ogretmen / 123456  (Ayşe Kaya, Matematik)");
console.log("👨‍🏫 ÖĞRETMEN: mehmet.ogretmen / 123456  (Mehmet Öztürk, Fen)");
console.log("👨 VELİ: veli.yilmaz / 123456  (Mehmet Yılmaz, Ahmet'in babası)");
console.log("👩 VELİ: veli.demir / 123456  (Fatma Demir, Zeynep'in annesi)");
console.log("🔑 ADMİN: admin / admin123");
