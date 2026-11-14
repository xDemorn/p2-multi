CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username VARCHAR(63),
    hash VARCHAR(255),
    email VARCHAR(255),
    birthdate TEXT,
    nickname VARCHAR(150) default '',
    avatar VARCHAR(255) default '/icons/default.svg',
    isBanned BOOLEAN DEFAULT 0,
    reason TEXT,
    totp_secret TEXT,
    totp_enabled BOOLEAN DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS username_UNIQUE ON users (username ASC);

CREATE UNIQUE INDEX IF NOT EXISTS email_UNIQUE ON users (email ASC);

CREATE TABLE IF NOT EXISTS password_resets (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at INTEGER NOT NULL
);
