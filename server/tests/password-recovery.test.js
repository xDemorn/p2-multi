import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import express from "express";
import Database from "better-sqlite3";
import argon2 from "argon2";
import { createPasswordResetStore } from "../db/passwordResets.js";
import { createPasswordRecoveryRouter, recoveryUrl } from "../passwordRecovery.js";
import { sendRecoveryEmail } from "../email.js";
import axios from "axios";
import { validateNewPassword } from "../passwordPolicy.js";

const OLD = "original-password-123";
const NEW = "K9!q2z-valid-password";
const EMAIL = "student@example.com";
const digest = (token) => createHash("sha256").update(token).digest("hex");
const tokenFrom = (mail) => new URL(mail.resetUrl).hash.slice("#reset-password=".length);
const waitFor = async (predicate) => {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("Background email task did not finish");
};

async function fixture(t, sendEmail, validatePassword) {
  t.mock.method(axios, "get", async () => ({ status: 200, data: "" }));
  const db = new Database(":memory:");
  db.exec(readFileSync(new URL("../db/create_db.sql", import.meta.url), "utf8"));
  db.prepare("INSERT INTO users (id, username, email, hash) VALUES (1, ?, ?, ?)")
    .run("student", EMAIL, await argon2.hash(OLD));
  const store = createPasswordResetStore(db);
  const mails = [], logs = [];
  let time = Date.now();
  const app = express();
  app.use(express.json());
  app.use("/api", createPasswordRecoveryRouter({
    store, now: () => time, baseUrl: () => new URL("http://localhost:2567/"),
    sendEmail: sendEmail || (async (mail) => { mails.push(mail); }),
    validatePassword: validatePassword || validateNewPassword,
    logger: { error: (...args) => logs.push(args.join(" ")) },
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    const closed = new Promise((resolve) => server.close(resolve));
    server.closeAllConnections();
    await closed;
    db.close();
  });
  const post = async (route, body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/${route}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json(), cache: response.headers.get("cache-control") };
  };
  return { db, store, mails, logs, post, advance: (ms) => { time += ms; } };
}

test("reset links use the configured public server URL, not the request host", (t) => {
  const saved = process.env.SERVER_URL;
  process.env.SERVER_URL = "https://game.example.com/";
  t.after(() => {
    if (saved === undefined) delete process.env.SERVER_URL; else process.env.SERVER_URL = saved;
  });
  assert.equal(recoveryUrl({ protocol: "http", get: () => "evil.example" }).href, "https://game.example.com/");
});

test("recovery stores only a token hash, keeps the old password until reset, and consumes once", async (t) => {
  const f = await fixture(t);
  const result = await f.post("forgot-password", { email: EMAIL });
  assert.equal(result.status, 200);
  assert.equal(result.cache, "no-store");
  await waitFor(() => f.mails.length === 1);
  const token = tokenFrom(f.mails[0]);
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.equal(new URL(f.mails[0].resetUrl).pathname, "/reset");
  const row = f.db.prepare("SELECT * FROM password_resets").get();
  assert.equal(row.token_hash, digest(token));
  assert.notEqual(row.token_hash, token);
  assert.ok(await argon2.verify(f.db.prepare("SELECT hash FROM users").get().hash, OLD));
  const request = { token, password: NEW, confirmPassword: NEW };
  assert.equal((await f.post("reset-password", request)).status, 200);
  const hash = f.db.prepare("SELECT hash FROM users").get().hash;
  assert.ok(hash.startsWith("$argon2id$"));
  assert.ok(await argon2.verify(hash, NEW));
  assert.equal(await argon2.verify(hash, OLD), false);
  assert.equal(f.db.prepare("SELECT count(*) AS n FROM password_resets").get().n, 0);
  assert.equal((await f.post("reset-password", request)).status, 400);
});

test("unknown accounts receive the same response without sending email", async (t) => {
  const f = await fixture(t);
  const existing = await f.post("forgot-password", { email: EMAIL });
  const missing = await f.post("forgot-password", { email: "missing@example.com" });
  assert.deepEqual(missing, existing);
  await waitFor(() => f.mails.length === 1);
  assert.equal(f.mails[0].recipientEmail, EMAIL);
});

test("new requests replace old links; expired, mismatched and short passwords cannot change credentials", async (t) => {
  const f = await fixture(t);
  await f.post("forgot-password", { email: EMAIL });
  await waitFor(() => f.mails.length === 1);
  const oldToken = tokenFrom(f.mails[0]);
  f.advance(61000);
  await f.post("forgot-password", { email: EMAIL });
  await waitFor(() => f.mails.length === 2);
  const token = tokenFrom(f.mails[1]);
  const request = { token, password: NEW, confirmPassword: NEW };
  assert.equal((await f.post("reset-password", { ...request, token: oldToken })).status, 400);
  assert.equal((await f.post("reset-password", { ...request, password: "short" })).status, 400);
  assert.equal((await f.post("reset-password", { ...request, confirmPassword: OLD })).status, 400);
  assert.ok(f.store.find(digest(token), Date.now()));
  f.advance(30 * 60000);
  assert.equal((await f.post("reset-password", request)).status, 400);
  assert.ok(await argon2.verify(f.db.prepare("SELECT hash FROM users").get().hash, OLD));
});

test("simultaneous resets cannot both consume the same token", async (t) => {
  const f = await fixture(t);
  await f.post("forgot-password", { email: EMAIL });
  await waitFor(() => f.mails.length === 1);
  const request = { token: tokenFrom(f.mails[0]), password: NEW, confirmPassword: NEW };
  const results = await Promise.all([f.post("reset-password", request), f.post("reset-password", request)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
});

test("a short password is rejected without changing credentials or consuming the recovery token", async (t) => {
  const f = await fixture(t);
  await f.post("forgot-password", { email: EMAIL });
  await waitFor(() => f.mails.length === 1);
  const token = tokenFrom(f.mails[0]);
  const response = await f.post("reset-password", { token, password: "short", confirmPassword: "short" });
  assert.equal(response.status, 400);
  assert.match(response.body.error, /12 caracteres/);
  assert.ok(f.store.find(digest(token), Date.now()));
  assert.ok(await argon2.verify(f.db.prepare("SELECT hash FROM users").get().hash, OLD));
});

test("a breached password leaves the old credentials and recovery token intact", async (t) => {
  const f = await fixture(t, undefined, async () => "Esta contraseña ya es conocida y no es segura. Prueba con una frase de varias palabras que puedas recordar.");
  await f.post("forgot-password", { email: EMAIL });
  await waitFor(() => f.mails.length === 1);
  const token = tokenFrom(f.mails[0]);
  const response = await f.post("reset-password", { token, password: "123456789012", confirmPassword: "123456789012" });
  assert.equal(response.status, 400);
  assert.match(response.body.error, /no es segura/);
  assert.ok(f.store.find(digest(token), Date.now()));
  assert.ok(await argon2.verify(f.db.prepare("SELECT hash FROM users").get().hash, OLD));
});

test("per-email cooldown and per-IP limits apply independently of account existence", async (t) => {
  const f = await fixture(t);
  await f.post("forgot-password", { email: EMAIL });
  await f.post("forgot-password", { email: EMAIL });
  await waitFor(() => f.mails.length === 1);
  for (let i = 0; i < 3; i++) assert.equal((await f.post("forgot-password", { email: `unknown${i}@example.com` })).status, 200);
  assert.equal((await f.post("forgot-password", { email: EMAIL })).status, 429);
  f.advance(15 * 60000);
  assert.equal((await f.post("forgot-password", { email: "unknown@example.com" })).status, 200);
  for (let i = 0; i < 10; i++) assert.equal((await f.post("reset-password", {})).status, 400);
  assert.equal((await f.post("reset-password", {})).status, 429);
});

test("per-email hourly quota persists beyond the minute cooldown", async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 3; i++) {
    await f.post("forgot-password", { email: EMAIL });
    await waitFor(() => f.mails.length === i + 1);
    f.advance(61000);
  }
  assert.equal((await f.post("forgot-password", { email: EMAIL })).status, 200);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.mails.length, 3);
});

test("Brevo failure leaves a generic response and logs no sensitive error content", async (t) => {
  const f = await fixture(t, async () => { throw new Error("sensitive-provider-body-and-token"); });
  const result = await f.post("forgot-password", { email: EMAIL });
  assert.equal(result.status, 200);
  await waitFor(() => f.logs.length === 1);
  assert.deepEqual(f.logs, ["Password recovery: RECOVERY_FAILED"]);
  assert.equal(f.db.prepare("SELECT count(*) AS n FROM password_resets").get().n, 0);
  assert.ok(await argon2.verify(f.db.prepare("SELECT hash FROM users").get().hash, OLD));
});

test("a late failure for an older email cannot delete the newer link", async (t) => {
  const mails = [];
  let rejectFirst;
  const f = await fixture(t, (mail) => {
    mails.push(mail);
    return mails.length === 1 ? new Promise((_resolve, reject) => { rejectFirst = reject; }) : Promise.resolve();
  });
  await f.post("forgot-password", { email: EMAIL });
  await waitFor(() => mails.length === 1);
  f.advance(61000);
  await f.post("forgot-password", { email: EMAIL });
  await waitFor(() => mails.length === 2);
  rejectFirst(new Error("BREVO_HTTP_500"));
  await waitFor(() => f.logs.length === 1);
  assert.ok(f.store.find(digest(tokenFrom(mails[1])), Date.now()));
});

test("Brevo adapter uses the official REST endpoint, server key and verified sender configuration", async (t) => {
  const saved = { ...process.env };
  t.after(() => {
    for (const name of ['BREVO_API_KEY', 'BREVO_SENDER_EMAIL', 'BREVO_SENDER_NAME']) {
      if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name];
    }
  });
  process.env.BREVO_API_KEY = "test-placeholder-key";
  process.env.BREVO_SENDER_EMAIL = "sender@example.com";
  process.env.BREVO_SENDER_NAME = "Test game";
  const mock = t.mock.method(axios, "post", async () => ({ status: 201 }));
  await sendRecoveryEmail({ recipientEmail: EMAIL, resetUrl: "https://example.com/#reset-password=test" });
  const [url, body, options] = mock.mock.calls[0].arguments;
  assert.equal(url, "https://api.brevo.com/v3/smtp/email");
  assert.equal(options.headers['api-key'], "test-placeholder-key");
  assert.deepEqual(body.sender, { email: "sender@example.com", name: "Test game" });
  assert.deepEqual(body.to, [{ email: EMAIL }]);
  assert.ok(body.subject);
  assert.ok(body.textContent.includes("https://example.com/#reset-password=test"));
  mock.mock.mockImplementation(async () => ({ status: 401 }));
  await assert.rejects(sendRecoveryEmail({ recipientEmail: EMAIL, resetUrl: "test" }), /^Error: BREVO_HTTP_401$/);
  mock.mock.mockImplementation(async () => {
    throw Object.assign(new Error("sensitive network details"), { code: "EACCES" });
  });
  await assert.rejects(sendRecoveryEmail({ recipientEmail: EMAIL, resetUrl: "test" }), /^Error: BREVO_NETWORK_EACCES$/);
  mock.mock.mockImplementation(async () => { throw Object.assign(new Error("sensitive timeout"), { code: "ECONNABORTED" }); });
  await assert.rejects(sendRecoveryEmail({ recipientEmail: EMAIL, resetUrl: "test" }), /^Error: BREVO_TIMEOUT$/);
  delete process.env.BREVO_API_KEY;
  await assert.rejects(sendRecoveryEmail({ recipientEmail: EMAIL, resetUrl: "test" }), /BREVO_NOT_CONFIGURED/);
});
