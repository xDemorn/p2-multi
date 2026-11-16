import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPasswordResetStore } from "./passwordResets.js";
// así el esquema también se crea con node index.js
import "./create_db.js";

const dbPath = process.env.DB_PATH
    ? path.resolve(process.env.DB_PATH)
    : fileURLToPath(new URL("./data.db", import.meta.url));

const db = new Database(dbPath);
export const passwordResetStore = createPasswordResetStore(db);


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

export function addTrophy(id) {
    return db.prepare("UPDATE users SET trophies = trophies + 1 WHERE id = ?").run(id).changes;
}

export function updateUserPassword(username, hash) {
    return db.prepare("UPDATE users SET hash = ? WHERE username = ?").run(hash, username).changes;
}

export function deleteUser(id) {
    return db.transaction((userId) => {
        db.prepare("DELETE FROM password_resets WHERE user_id = ?").run(userId);
        return db.prepare("DELETE FROM users WHERE id = ?").run(userId).changes;
    }).immediate(id);
}

// totp_enabled sigue a 0 hasta confirmar el primer código
export function setUserTotpSecret(username, secret) {
    db.prepare("UPDATE users SET totp_secret = ?, totp_enabled = 0 WHERE username = ?").run(secret, username);
}

export function enableUserTotp(username) {
    return db.prepare("UPDATE users SET totp_enabled = 1 WHERE username = ?").run(username).changes;
}

export function clearUserTotp(username) {
    db.prepare("UPDATE users SET totp_secret = NULL, totp_enabled = 0 WHERE username = ?").run(username);
}
