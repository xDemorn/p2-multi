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

// columnas añadidas después (2FA y copas)
const userColumns = db.prepare("PRAGMA table_info(users)").all().map((column) => column.name);
for (const [name, definition] of [
  ["totp_secret", "TEXT"], ["totp_enabled", "BOOLEAN DEFAULT 0"], ["trophies", "INTEGER NOT NULL DEFAULT 0"],
]) {
  if (!userColumns.includes(name)) db.exec(`ALTER TABLE users ADD COLUMN ${name} ${definition}`);
}

// los usuarios de prueba solo se cargan si la tabla está vacía
if (db.prepare("SELECT COUNT(*) FROM users").pluck().get() === 0) {
  db.exec(fs.readFileSync(new URL("./seed.sql", import.meta.url), "utf8"));
}

db.close();
