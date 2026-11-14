import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dbPath = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : fileURLToPath(new URL("./data.db", import.meta.url));

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
const sql = fs.readFileSync(new URL("./create_db.sql", import.meta.url), "utf8");

db.exec(sql);

// Databases created before 2FA existed need the columns added in place.
const userColumns = db.prepare("PRAGMA table_info(users)").all().map((column) => column.name);
for (const [name, definition] of [["totp_secret", "TEXT"], ["totp_enabled", "BOOLEAN DEFAULT 0"]]) {
  if (!userColumns.includes(name)) db.exec(`ALTER TABLE users ADD COLUMN ${name} ${definition}`);
}

db.close();
