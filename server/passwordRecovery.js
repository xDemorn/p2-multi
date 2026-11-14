import { Router } from "express";
import { randomBytes, createHash } from "node:crypto";
import argon2 from "argon2";
import { sendRecoveryEmail } from "./email.js";
import { validateNewPassword } from "./passwordPolicy.js";

const MINUTE = 60_000;
const GENERIC_MESSAGE = "Si existe una cuenta asociada a ese correo, recibirás un enlace para recuperar la contraseña.";
const INVALID_LINK = "El enlace no es válido o ha caducado. Solicita uno nuevo.";
const digest = (value) => createHash("sha256").update(value).digest("hex");

// Fixed windows, bounded memory and lazy cleanup. Suitable for one server process.
export function createLimiter(now) {
  const entries = new Map();
  let nextCleanup = 0;
  return (key, limit, duration) => {
    const time = now();
    if (time >= nextCleanup) {
      for (const [id, entry] of entries) if (entry.until <= time) entries.delete(id);
      nextCleanup = time + MINUTE;
    }
    let entry = entries.get(key);
    if (!entry || entry.until <= time) {
      if (entries.size >= 10000) return false;
      entry = { count: 0, until: time + duration };
      entries.set(key, entry);
    }
    return ++entry.count <= limit;
  };
}

// The Host header is user-controlled, so production must configure the public URL.
export function recoveryUrl(req) {
  const configured = process.env.SERVER_URL || process.env.RENDER_EXTERNAL_URL;
  if (configured) return new URL("/", configured);
  if (process.env.NODE_ENV === "production") throw new Error("SERVER_URL must be set in production");
  return new URL("/", `${req.protocol}://${req.get("host")}`);
}

export function createPasswordRecoveryRouter({
  store, sendEmail = sendRecoveryEmail, now = Date.now, validatePassword = validateNewPassword,
  baseUrl = recoveryUrl, logger = console,
}) {
  const router = Router();
  const allow = createLimiter(now);
  const safeLog = (error) => {
    const code = /^BREVO_HTTP_\d{3}$/.test(error?.message) ||
      /^BREVO_NETWORK_(EACCES|EPERM|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ERROR)$/.test(error?.message) ||
      ["BREVO_NOT_CONFIGURED", "BREVO_TIMEOUT"].includes(error?.message)
      ? error.message : "RECOVERY_FAILED";
    logger.error("Password recovery:", code);
  };

  router.use(["/forgot-password", "/reset-password"], (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });

  router.post("/forgot-password", (req, res) => {
    if (!allow(`forgot-ip:${req.ip}`, 5, 15 * MINUTE)) {
      return res.status(429).json({ error: "Demasiadas solicitudes. Inténtalo en 15 minutos." });
    }
    const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Introduce un correo electrónico válido." });
    }
    const key = digest(email.toLowerCase());
    const perMinute = allow(`email-minute:${key}`, 1, MINUTE);
    const perHour = allow(`email-hour:${key}`, 3, 60 * MINUTE);
    res.json({ message: GENERIC_MESSAGE });
    if (!perMinute || !perHour) return;

    // Respond before querying accounts or contacting Brevo, on both account paths.
    // This best-effort task is intentionally not a durable email queue.
    setImmediate(async () => {
      let tokenHash;
      try {
        store.prune(now());
        const user = store.findUserByEmail(email);
        if (!user) return;
        const url = baseUrl(req);
        const token = randomBytes(32).toString("hex");
        tokenHash = digest(token);
        url.pathname = "/reset";
        url.hash = `reset-password=${token}`;
        store.save(user.id, tokenHash, now() + 30 * MINUTE);
        await sendEmail({ recipientEmail: user.email, resetUrl: url.toString() });
      } catch (error) {
        if (tokenHash) {
          try { store.remove(tokenHash); } catch { /* Keep logging free of database values. */ }
        }
        safeLog(error);
      }
    });
  });

  router.post("/reset-password", async (req, res) => {
    if (!allow(`reset-ip:${req.ip}`, 10, 15 * MINUTE)) {
      return res.status(429).json({ error: "Demasiados intentos. Inténtalo en 15 minutos." });
    }
    const { token, password, confirmPassword } = req.body ?? {};
    if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) {
      return res.status(400).json({ error: INVALID_LINK });
    }
    if (password !== confirmPassword) {
      return res.status(400).json({ error: "Las contraseñas no coinciden." });
    }
    try {
      const tokenHash = digest(token);
      if (!store.find(tokenHash, now())) return res.status(400).json({ error: INVALID_LINK });
      const passwordError = await validatePassword(password);
      if (passwordError) return res.status(400).json({ error: passwordError });
      const hash = await argon2.hash(password, { type: argon2.argon2id });
      if (!store.consume(tokenHash, hash, now())) return res.status(400).json({ error: INVALID_LINK });
      res.clearCookie("token");
      return res.json({ message: "Contraseña actualizada. Ya puedes iniciar sesión." });
    } catch (error) {
      safeLog(error);
      return res.status(503).json({ error: "No se ha podido cambiar la contraseña. Inténtalo más tarde." });
    }
  });

  return router;
}
