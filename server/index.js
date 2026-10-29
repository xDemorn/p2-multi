import http from "http";
import express from "express";
import cors from "cors";
import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { Eta } from "eta";
import path from "node:path";
import { mkdir, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import cookieParser from "cookie-parser";
import multer from "multer";
import { GameRoom } from "./GameRoom.js";
import { insertUser, getUser, updateUserProfile } from './db/utils.js';
import { createToken, attachUser, auth } from "./utils.js";

const PORT = process.env.PORT || 2567;

const uploadsDir = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(import.meta.dirname, "public", "uploads");

await mkdir(uploadsDir, { recursive: true });

const app = express();
const allowedOrigins = process.env.CLIENT_ORIGIN?.split(",").map((o) => o.trim()).filter(Boolean);
app.use(cors(allowedOrigins ? { origin: allowedOrigins } : {}));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use("/uploads", express.static(uploadsDir));
app.use(express.static(path.join(import.meta.dirname, "public")));
app.get("/healthz", (req, res) => res.json({ ok: true }));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    // Random name: avoids collisions and ignores the user-supplied filename
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, randomUUID() + ext);
  },
});

const eta = new Eta({ views: path.join(import.meta.dirname, "templates") })

/* PAGES */
const render = (res, view, data = {}) => res.send(eta.render(view, { ...res.locals, ...data }));

app.use(attachUser);
app.get("/", (req, res) => {
  render(res, "home");
});

app.get("/login", (req, res) => {
  res.send(eta.render("login"));
});

app.get("/register", (req, res) => {
  render(res, "register");
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    cb(null, allowed.includes(file.mimetype));
  },
});

app.get("/profile", auth, (req, res) => {
  const user = getUser(req.user.username);
  
  render(res, "profile", {
    DATA_USERNAME: req.user.username,
    DATA_EMAIL: user.email,
    DATA_BIRTHDATE: user.birthdate,
    DATA_NICKNAME: user.nickname,
    DATA_AVATAR: user.avatar
  });
});

/* API */

const setAuthCookie = (res, t) => res.cookie("token", t, { httpOnly: true, secure: process.env.COOKIE_SECURE === "production", sameSite: "lax", maxAge: 60 * 60 * 1000 });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_AGE = 16;

function ageFromBirthdate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const birth = new Date(Date.UTC(year, month - 1, day));
  if (birth.getUTCFullYear() !== year || birth.getUTCMonth() !== month - 1 || birth.getUTCDate() !== day) return null;
  const now = new Date();
  const hadBirthday = now.getUTCMonth() > month - 1 || (now.getUTCMonth() === month - 1 && now.getUTCDate() >= day);
  return now.getUTCFullYear() - year - (hadBirthday ? 0 : 1);
}

function readRegisterBody(body = {}) {
  const text = (value) => (typeof value === "string" ? value.trim() : "");
  return {
    username: text(body.username) || text(body.user_name),
    password: typeof body.password === "string" ? body.password : typeof body.user_password === "string" ? body.user_password : "",
    confirm: typeof body.confirm_password === "string" ? body.confirm_password : null,
    email: text(body.email) || text(body.user_email),
    birthdate: text(body.birthdate),
  };
}

app.post("/api/register", async (req, res) => {
  const { username, password, confirm, email, birthdate } = readRegisterBody(req.body);
  console.log(username, password, confirm, email, birthdate)

  const fail = (message, status = 400) => res.status(status).json({ error: message });

  if (!username || !email || !birthdate || !password) {
    return fail("Usuario, correo, fecha de nacimiento y contraseña son obligatorios.");
  }
  if (!EMAIL_RE.test(email)) return fail("El correo electrónico no es válido.");
  const age = ageFromBirthdate(birthdate);
  if (age === null || age < 0) return fail("La fecha de nacimiento no es válida.");
  if (age < MIN_AGE) return fail(`Debes tener al menos ${MIN_AGE} años.`);
  if (confirm !== null && confirm !== password) return fail("Las contraseñas no coinciden.");

  try {
    const hash = await argon2.hash(password);
    const id = insertUser(username, hash, email, birthdate);
    const token = createToken({ id, username });
    setAuthCookie(res, token);
    res.status(201).json({ token });
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return fail(error.message.includes("email") ? "Este correo ya está registrado." : "Ese nombre de usuario ya está en uso.", 409);
    }
    console.error("Registration failed:", error);
    if (error.code === "SQLITE_BUSY" || error.code === "SQLITE_LOCKED") {
      return fail("Base de datos bloqueada. Guarda o revierte los cambios en DB Browser y cierra la base de datos antes de reintentar.", 503);
    }
    return fail("No se ha podido crear el usuario. Consulta la terminal del servidor.", 500);
  }
});

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body ?? {};
  const user = getUser(username);
  if (!user || !(await argon2.verify(user.hash, String(password ?? "")))) {
    return res.status(401).json({ error: "Wrong username or password" });
  }
  const token = createToken({ id: user.id, username: user.username });
  setAuthCookie(res, token);
  res.json({ token });
});

app.put("/api/profile", auth, upload.single("avatar"), async (req, res) => {
  const nickname = (req.body.nickname || "").trim();
  const user = getUser(req.user.username);

  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  const avatar = req.file ? `/uploads/${req.file.filename}` : user.avatar;
  updateUserProfile(user.username, nickname, avatar);

  if (req.file && user.avatar?.startsWith("/uploads/")) {
    await rm(path.join(uploadsDir, path.basename(user.avatar)), { force: true });
  }

  res.json({ ok: true, nickname, avatar });
});

app.post("/api/logout", (req, res) => {
  res.clearCookie("token");
  res.json({ ok: true });
});

app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: "API route not found" });
  }

  res.status(404).send(eta.render("404"));
});

const server = http.createServer(app);
const gameServer = new Server({ transport: new WebSocketTransport({ server }) });
gameServer.define("game", GameRoom);
gameServer.listen(PORT).then(() => console.log(`Server on :${PORT}`));
