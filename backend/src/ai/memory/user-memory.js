/**
 * Per-user memory manager
 * Stores and retrieves persistent memory for each user
 * Categories: preferences, learning_style, strengths, weaknesses, notes, goals
 */
const path = require("path");
const Database = require("better-sqlite3");
const dbPath = path.join(__dirname, "../../school/seed/data/school.db");

let _db;
function getDb() {
  if (!_db) {
    _db = new Database(dbPath);
    _db.pragma("journal_mode = WAL");
    // Ensure table exists
    _db.exec(`
      CREATE TABLE IF NOT EXISTS user_memory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        category TEXT NOT NULL DEFAULT 'general',
        key TEXT NOT NULL,
        value TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, category, key)
      )
    `);
  }
  return _db;
}

const UserMemory = {
  /** Get all memories for a user */
  getAll(userId) {
    const db = getDb();
    return db.prepare("SELECT category, key, value, updated_at FROM user_memory WHERE user_id = ? ORDER BY category, updated_at DESC").all(userId);
  },

  /** Get memories by category */
  getByCategory(userId, category) {
    const db = getDb();
    return db.prepare("SELECT key, value, updated_at FROM user_memory WHERE user_id = ? AND category = ? ORDER BY updated_at DESC").all(userId, category);
  },

  /** Get a specific memory */
  get(userId, category, key) {
    const db = getDb();
    const row = db.prepare("SELECT value FROM user_memory WHERE user_id = ? AND category = ? AND key = ?").get(userId, category, key);
    return row?.value || null;
  },

  /** Set (upsert) a memory */
  set(userId, category, key, value) {
    const db = getDb();
    db.prepare(`
      INSERT INTO user_memory (user_id, category, key, value, updated_at) 
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(user_id, category, key) DO UPDATE SET value = ?, updated_at = datetime('now')
    `).run(userId, category, key, value, value);
  },

  /** Delete a memory */
  delete(userId, category, key) {
    const db = getDb();
    db.prepare("DELETE FROM user_memory WHERE user_id = ? AND category = ? AND key = ?").run(userId, category, key);
  },

  /** Build memory context string for agent */
  buildContext(userId) {
    const memories = this.getAll(userId);
    if (!memories.length) return "";

    let ctx = "\n[KULLANICI HAFIZASI - bu bilgileri kullanarak kisisellestirilmis yanit ver]\n";
    const grouped = {};
    for (const m of memories) {
      if (!grouped[m.category]) grouped[m.category] = [];
      grouped[m.category].push(m);
    }

    const labels = {
      preferences: "Tercihler",
      learning_style: "Ogrenme Stili",
      strengths: "Guclu Yonler",
      weaknesses: "Gelisim Alanlari", 
      goals: "Hedefler",
      notes: "Notlar",
      personality: "Kisilik",
      general: "Genel"
    };

    for (const [cat, items] of Object.entries(grouped)) {
      ctx += `\n### ${labels[cat] || cat}\n`;
      for (const item of items) {
        ctx += `- ${item.key}: ${item.value}\n`;
      }
    }

    return ctx;
  },

  /** Parse agent response for memory commands 
   *  Agent can include [HAFIZA_KAYDET:category:key:value] tags in response
   */
  parseAndSave(userId, agentResponse) {
    const regex = /\[HAFIZA_KAYDET:([^:]+):([^:]+):([^\]]+)\]/g;
    let match;
    const saved = [];
    while ((match = regex.exec(agentResponse)) !== null) {
      const [, category, key, value] = match;
      this.set(userId, category.trim(), key.trim(), value.trim());
      saved.push({ category: category.trim(), key: key.trim(), value: value.trim() });
    }
    // Remove memory tags from visible response
    const cleanResponse = agentResponse.replace(regex, "").trim();
    return { cleanResponse, saved };
  }
};

module.exports = UserMemory;
