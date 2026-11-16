import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

test("seed users fill an empty database and leave a live one alone", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "iso-db-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const dbPath = join(dir, "data.db");
  const createSchema = () => execFileSync(process.execPath,
    [fileURLToPath(new URL("../db/create_db.js", import.meta.url))],
    { env: { ...process.env, DB_PATH: dbPath } });

  createSchema();
  const first = new Database(dbPath);
  assert.ok(first.prepare("SELECT COUNT(*) FROM users").pluck().get() > 0, "seed row missing");
  first.prepare("DELETE FROM users").run();
  first.prepare("INSERT INTO users (id, username, hash, email) VALUES (42, 'kept', 'x', 'kept@example.com')").run();
  first.close();

  createSchema();
  const second = new Database(dbPath);
  assert.deepEqual(second.prepare("SELECT id FROM users").all(), [{ id: 42 }]);
  second.close();
});
