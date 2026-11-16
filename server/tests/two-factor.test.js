import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import { generate } from "otplib";
import { createTwoFactorRouter } from "../twoFactor.js";
import { createToken, createTwoFactorChallenge, jwtSecret } from "../utils.js";
import { createGameRouter } from "../routes/game.js";

async function fixture(t) {
  const rows = new Map();
  const users = {
    getUser: (username) => rows.get(username),
    setUserTotpSecret: (username, secret) => Object.assign(rows.get(username), { totp_secret: secret, totp_enabled: 0 }),
    enableUserTotp: (username) => { rows.get(username).totp_enabled = 1; return 1; },
    clearUserTotp: (username) => Object.assign(rows.get(username), { totp_secret: null, totp_enabled: 0 }),
  };
  rows.set("student", { id: 1, username: "student", totp_secret: null, totp_enabled: 0 });

  let time = Date.now();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (req.get("x-no-session")) return next();
    req.user = { username: "student" };
    next();
  });
  app.use("/api", createTwoFactorRouter({ now: () => time, users }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    const closed = new Promise((resolve) => server.close(resolve));
    server.closeAllConnections();
    await closed;
  });
  const post = async (route, body = {}, headers = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/${route}`, {
      method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json(), cache: response.headers.get("cache-control") };
  };
  return { rows, post, advance: (ms) => { time += ms; } };
}

test("the secret stays pending until a valid code enables it, and a valid code is needed to disable", async (t) => {
  const f = await fixture(t);
  const setup = await f.post("2fa/setup");
  assert.equal(setup.status, 200);
  assert.equal(setup.cache, "no-store");
  assert.match(setup.body.secret, /^[A-Z2-7]+$/);
  assert.ok(setup.body.qr.startsWith("data:image/png;base64,"));
  const { secret } = setup.body;
  assert.deepEqual(f.rows.get("student"), { id: 1, username: "student", totp_secret: secret, totp_enabled: 0 });

  assert.equal((await f.post("2fa/enable", { code: "000000" })).status, 400);
  assert.equal(f.rows.get("student").totp_enabled, 0);

  assert.equal((await f.post("2fa/enable", { code: await generate({ secret }) })).status, 200);
  assert.equal(f.rows.get("student").totp_enabled, 1);
  assert.equal((await f.post("2fa/setup")).status, 409);

  assert.equal((await f.post("2fa/disable", { code: "000000" })).status, 400);
  assert.equal(f.rows.get("student").totp_enabled, 1);
  assert.equal((await f.post("2fa/disable", { code: await generate({ secret }) })).status, 200);
  assert.deepEqual(f.rows.get("student"), { id: 1, username: "student", totp_secret: null, totp_enabled: 0 });
});

test("enabling before setup fails and anonymous requests are rejected", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.post("2fa/enable", { code: "123456" })).status, 400);
  const anonymous = await f.post("2fa/setup", {}, { "x-no-session": "1" });
  assert.equal(anonymous.status, 401);
});

test("repeated wrong codes are rate limited", async (t) => {
  const f = await fixture(t);
  await f.post("2fa/setup");
  for (let i = 0; i < 10; i++) assert.equal((await f.post("2fa/enable", { code: "000000" })).status, 400);
  assert.equal((await f.post("2fa/enable", { code: "000000" })).status, 429);
  f.advance(15 * 60000);
  assert.equal((await f.post("2fa/enable", { code: "000000" })).status, 400);
});

test("login needs both a valid challenge and a valid code before issuing a session token", async (t) => {
  const f = await fixture(t);
  const { secret } = (await f.post("2fa/setup")).body;
  await f.post("2fa/enable", { code: await generate({ secret }) });
  const challenge = createTwoFactorChallenge({ id: 1, username: "student" });

  assert.equal((await f.post("login/2fa", { challenge, code: "000000" })).status, 400);
  assert.equal((await f.post("login/2fa", { challenge: "garbage", code: await generate({ secret }) })).status, 401);
  // un token de sesión normal no vale como challenge
  const session = createToken({ id: 1, username: "student" });
  assert.equal((await f.post("login/2fa", { challenge: session, code: await generate({ secret }) })).status, 401);

  const ok = await f.post("login/2fa", { challenge, code: await generate({ secret }) });
  assert.equal(ok.status, 200);
  const payload = jwt.verify(ok.body.token, jwtSecret);
  assert.equal(payload.username, "student");
  assert.equal(payload.scope, undefined);

  // al desactivar el 2FA, los challenges pendientes dejan de valer
  await f.post("2fa/disable", { code: await generate({ secret }) });
  assert.equal((await f.post("login/2fa", { challenge, code: await generate({ secret }) })).status, 401);
});

test("a 2FA challenge cannot open a game room session", async () => {
  const app = express();
  app.use("/api/game", createGameRouter());
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const challenge = createTwoFactorChallenge({ id: 1, username: "student" });
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/game/join`, {
      method: "POST",
      headers: { authorization: `Bearer ${challenge}` },
    });
    assert.equal(response.status, 401);
  } finally {
    server.close();
  }
});
