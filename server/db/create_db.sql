CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username VARCHAR(63),
    hash VARCHAR(255),
    email VARCHAR(255),
    birth_date TEXT,
    nickname VARCHAR(150),
    avatar VARCHAR(255),
    isBanned BOOLEAN DEFAULT 0,
    reason TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS username_UNIQUE ON users (username ASC);

CREATE UNIQUE INDEX IF NOT EXISTS email_UNIQUE ON users (email ASC);