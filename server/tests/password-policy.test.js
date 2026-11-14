import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import axios from "axios";
import { validateNewPassword } from "../passwordPolicy.js";

test("registration, recovery and change share a twelve character minimum", async (t) => {
  t.mock.method(axios, "get", () => assert.fail("Short passwords must not query HIBP"));
  for (const value of [undefined, null, 123, "", "short", "abcdefghijk", "😀".repeat(11)]) {
    assert.match(await validateNewPassword(value), /12 caracteres/);
  }
});

test("twelve characters suffice when not breached, without extra composition requirements", async (t) => {
  t.mock.method(axios, "get", async () => ({ status: 200, data: "" }));
  for (const password of ["abcdefghijkl", "123456789012", "            ", "😀".repeat(12), "una frase larga con espacios"]) {
    assert.equal(await validateNewPassword(password), null);
  }
});

test("a twelve-character breached password is rejected using only a five-character hash prefix", async (t) => {
  const password = "123456789012";
  const hash = createHash("sha1").update(password).digest("hex").toUpperCase();
  t.mock.method(axios, "get", async (url, options) => {
    assert.equal(url, `https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`);
    assert.equal(options.headers["Add-Padding"], "true");
    return { status: 200, data: `${hash.slice(5)}:100` };
  });
  assert.match(await validateNewPassword(password), /no es segura/);
});

test("padding is ignored and provider outages preserve the original registration behavior", async (t) => {
  const password = "K9!q2z-long-enough";
  const suffix = createHash("sha1").update(password).digest("hex").toUpperCase().slice(5);
  const get = t.mock.method(axios, "get", async () => ({ status: 200, data: `${suffix}:0` }));
  assert.equal(await validateNewPassword(password), null);

  get.mock.mockImplementation(async () => {
    throw new Error("sensitive details");
  });
  const warn = t.mock.method(console, "warn", () => {});
  assert.equal(await validateNewPassword(password), null);
  assert.deepEqual(warn.mock.calls.map((call) => call.arguments[0]), ["Password policy: HIBP_UNAVAILABLE"]);
});
