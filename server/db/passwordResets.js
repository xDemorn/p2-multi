export function createPasswordResetStore(db) {
  const findUser = db.prepare("SELECT id, email FROM users WHERE email = ?");
  const save = db.prepare(`
    INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET token_hash = excluded.token_hash, expires_at = excluded.expires_at
  `);
  const find = db.prepare("SELECT user_id FROM password_resets WHERE token_hash = ? AND expires_at > ?");
  const remove = db.prepare("DELETE FROM password_resets WHERE token_hash = ?");
  const prune = db.prepare("DELETE FROM password_resets WHERE expires_at <= ?");
  const update = db.prepare("UPDATE users SET hash = ? WHERE id = ?");
  const removeForUser = db.prepare("DELETE FROM password_resets WHERE user_id = ?");

  const consume = db.transaction((tokenHash, passwordHash, now) => {
    const reset = find.get(tokenHash, now);
    if (!reset) return false;
    if (update.run(passwordHash, reset.user_id).changes !== 1) return false;
    removeForUser.run(reset.user_id);
    return true;
  });

  return {
    findUserByEmail: (email) => findUser.get(email),
    save: (userId, tokenHash, expiresAt) => save.run(userId, tokenHash, expiresAt),
    find: (tokenHash, now) => find.get(tokenHash, now),
    remove: (tokenHash) => remove.run(tokenHash),
    prune: (now) => prune.run(now),
    // en una transacción para que dos peticiones no usen el mismo token
    consume: (tokenHash, passwordHash, now) => consume.immediate(tokenHash, passwordHash, now),
  };
}
