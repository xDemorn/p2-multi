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
  res.send(eta.render("register"));
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
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
    DATA_BIRTHDATE: user.birth_date,
    DATA_NICKNAME: user.nickname,
    DATA_AVATAR: user.avatar || "/icons/default.svg"
  });
});

/* API */

const setAuthCookie = (res, t) => res.cookie("token", t, { httpOnly: true, secure: process.env.COOKIE_SECURE === "production", sameSite: "lax", maxAge: 60 * 60 * 1000 });

app.post("/api/register", async (req, res) => {
  const { username, password } = req.body ?? {};
  const wantsJson = req.is("application/json") || req.get("accept")?.includes("application/json");
  if (typeof username !== "string" || typeof password !== "string" || !username || !password) {
    return res.status(400).json({ error: "Username and password required" });
  }
  try {
    const hash = await argon2.hash(password);
    const id = insertUser(username, hash);
    const token = createToken({ id, username });
    setAuthCookie(res, token);
    if (wantsJson) return res.status(201).json({ token });
    res.redirect('/login');
  } catch {
    res.status(409).json({ error: "Username already taken" });
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
