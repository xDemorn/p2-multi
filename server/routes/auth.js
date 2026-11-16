import { Router } from "express";
import argon2 from "argon2";
import { getUser, insertUser } from "../db/utils.js";
import { validateNewPassword } from "../passwordPolicy.js";
import {
  ageFromBirthdate, createToken, createTwoFactorChallenge, EMAIL_RE, MIN_AGE,
  readRegisterBody, setAuthCookie,
} from "../utils.js";

export function createAuthRouter({ allowedOrigins }) {
  const router = Router();

  router.post("/register", async (req, res) => {
    const { username, password, confirm, email, birthdate } = readRegisterBody(req.body);
    const fail = (message, status = 400) => res.status(status).json({ error: message });

    if (!username || !email || !birthdate || !password) {
      return fail("Usuario, correo, fecha de nacimiento y contraseña son obligatorios.");
    }
    if ([...username].length < 3) return fail("El nombre de usuario debe tener al menos 3 caracteres.");
    if (!EMAIL_RE.test(email)) return fail("El correo electrónico no es válido.");
    const age = ageFromBirthdate(birthdate);
    if (age === null || age < 0) return fail("La fecha de nacimiento no es válida.");
    if (age < MIN_AGE) return fail(`Debes tener al menos ${MIN_AGE} años.`);
    if (confirm !== null && confirm !== password) return fail("Las contraseñas no coinciden.");

    try {
      const passwordError = await validateNewPassword(password);
      if (passwordError) return fail(passwordError);
      const hash = await argon2.hash(password);
      const id = insertUser(username, hash, email, birthdate);
      const token = createToken({ id, username });
      setAuthCookie(res, token);
      res.status(201).json({ token });
    } catch (error) {
      if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
        return fail(
          error.message.includes("email") ? "Este correo ya está registrado." : "Ese nombre de usuario ya está en uso.",
          409,
        );
      }
      console.error("Registration failed:", error);
      if (error.code === "SQLITE_BUSY" || error.code === "SQLITE_LOCKED") {
        return fail("Base de datos bloqueada. Guarda o revierte los cambios en DB Browser y cierra la base de datos antes de reintentar.", 503);
      }
      return fail("No se ha podido crear el usuario. Consulta la terminal del servidor.", 500);
    }
  });

  router.post("/login", async (req, res) => {
    const { username, password } = req.body ?? {};
    const user = getUser(username);
    if (!user || !(await argon2.verify(user.hash, String(password ?? "")))) {
      return res.status(401).json({ error: "Wrong username or password" });
    }
    if (user.isBanned) {
      if (allowedOrigins?.includes(req.get("origin"))) res.clearCookie("token");
      else setAuthCookie(res, createToken({ id: user.id, username: user.username, isBanned: true }));
      return res.status(403).json({
        error: "Aquest compte està bloquejat.", banned: true, reason: user.reason, redirect: "/banned",
      });
    }
    // con 2FA todavía no hay sesión, solo el token temporal
    if (user.totp_enabled) {
      return res.json({ requires2fa: true, challenge: createTwoFactorChallenge(user) });
    }
    const token = createToken({ id: user.id, username: user.username });
    setAuthCookie(res, token);
    res.json({ token });
  });

  router.post("/logout", (req, res) => {
    res.clearCookie("token");
    res.json({ ok: true });
  });

  return router;
}
