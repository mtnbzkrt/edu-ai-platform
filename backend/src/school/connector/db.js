const Database = require("better-sqlite3");
const path = require("path");
const DB_PATH = path.join(__dirname, "../../data/school.db");
const db = new Database(DB_PATH, { readonly: false });
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
module.exports = db;
