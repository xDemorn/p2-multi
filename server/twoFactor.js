import { Router } from "express";
import QRCode from "qrcode";
import { generateSecret, generateURI, verify } from "otplib";
import { getUser, setUserTotpSecret, enableUserTotp, clearUserTotp } from "./db/utils.js";
import { auth, createToken, readTwoFactorChallenge, setAuthCookie } from "./utils.js";
import { createLimiter } from "./passwordRecovery.js";

const ISSUER = "El torneo de los magos";
const MINUTE = 60_000;
const CODE_RE = /^\d{6}$/;
const INVALID_SESSION = "La sessió no és vàlida. Torna a iniciar sessió.";
const EXPIRED = "La verificació ha caducat. Torna a iniciar sessió.";
const TOO_MANY = "Massa intents. Torna-ho a provar d'aquí a 15 minuts.";
const WRONG_CODE = "El codi no és correcte. Comprova l'hora del dispositiu i torna-ho a provar.";

export const totpCodeMatches = async (secret, code) =>
  Boolean(secret) && typeof code === "string" && CODE_RE.test(code.trim()) &&
  (await verify({ secret, token: code.trim() })).valid;

export function createTwoFactorRouter({
  now = Date.now,
  users = { getUser, setUserTotpSecret, enableUserTotp, clearUserTotp },
} = {}) {
  const router = Router();
  const allow = createLimiter(now);

  // que no se guarden en caché los códigos
  router.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });

  router.post("/2fa/setup", auth, async (req, res) => {
    const user = users.getUser(req.user.username);
    if (!user) return res.status(401).json({ error: INVALID_SESSION });
    if (user.totp_enabled) return res.status(409).json({ error: "El 2FA ja està activat." });

    const secret = generateSecret();
    users.setUserTotpSecret(user.username, secret);
    const qr = await QRCode.toDataURL(generateURI({ issuer: ISSUER, label: user.username, secret }));
    res.json({ secret, qr });
  });

  router.post("/2fa/enable", auth, async (req, res) => {
    const user = users.getUser(req.user.username);
    if (!user) return res.status(401).json({ error: INVALID_SESSION });
    if (user.totp_enabled) return res.status(409).json({ error: "El 2FA ja està activat." });
    if (!user.totp_secret) return res.status(400).json({ error: "Inicia la configuració del 2FA primer." });
    if (!allow(`2fa-enable:${user.username}`, 10, 15 * MINUTE)) return res.status(429).json({ error: TOO_MANY });
    if (!(await totpCodeMatches(user.totp_secret, req.body?.code))) {
      return res.status(400).json({ error: WRONG_CODE });
    }
    users.enableUserTotp(user.username);
    res.json({ ok: true });
  });

  // para desactivarlo hace falta un código válido
  router.post("/2fa/disable", auth, async (req, res) => {
    const user = users.getUser(req.user.username);
    if (!user) return res.status(401).json({ error: INVALID_SESSION });
    if (!user.totp_enabled) return res.status(409).json({ error: "El 2FA no està activat." });
    if (!allow(`2fa-disable:${user.username}`, 10, 15 * MINUTE)) return res.status(429).json({ error: TOO_MANY });
    if (!(await totpCodeMatches(user.totp_secret, req.body?.code))) {
      return res.status(400).json({ error: WRONG_CODE });
    }
    users.clearUserTotp(user.username);
    res.json({ ok: true });
  });

  // segundo paso del login
  router.post("/login/2fa", async (req, res) => {
    let challenge;
    try {
      challenge = readTwoFactorChallenge(req.body?.challenge);
    } catch {
      return res.status(401).json({ error: EXPIRED });
    }
    const user = users.getUser(challenge.username);
    if (!user?.totp_enabled) return res.status(401).json({ error: EXPIRED });
    if (user.isBanned) {
      return res.status(403).json({
        error: "Aquest compte està bloquejat.", banned: true, reason: user.reason, redirect: "/banned",
      });
    }
    if (!allow(`2fa-login:${user.username}`, 10, 15 * MINUTE)) return res.status(429).json({ error: TOO_MANY });
    if (!(await totpCodeMatches(user.totp_secret, req.body?.code))) {
      return res.status(400).json({ error: WRONG_CODE });
    }
    const token = createToken({ id: user.id, username: user.username });
    setAuthCookie(res, token);
    res.json({ token });
  });

  return router;
}
