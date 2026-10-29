import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dbPath = process.env.DB_PATH
    ? path.resolve(process.env.DB_PATH)
    : fileURLToPath(new URL("./data.db", import.meta.url));

const db = new Database(dbPath);


export function insertUser(username, hash, email, birthdate) {
    const info = db.prepare("INSERT INTO users (username, hash, email, birthdate) VALUES (?, ?, ?, ?)").run(username, hash, email, birthdate);
    return Number(info.lastInsertRowid);
}

export function getUser(username) {
    return db.prepare("SELECT * FROM users WHERE username = ?").get(username ?? "");
}

export function updateUserProfile(username, nickname, avatar) {
    db.prepare(`
        UPDATE users
        SET nickname = ?, avatar = ?
        WHERE username = ?
    `).run(nickname, avatar, username);
}
