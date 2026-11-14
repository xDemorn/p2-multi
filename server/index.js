import http from "node:http";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { Eta } from "eta";
import { GameRoom } from "./GameRoom.js";
import { getUser, passwordResetStore } from "./db/utils.js";
import { createPasswordRecoveryRouter } from "./passwordRecovery.js";
import { createTwoFactorRouter } from "./twoFactor.js";
import { attachUser } from "./utils.js";
import { createAccountRouter } from "./routes/account.js";
import { createAuthRouter } from "./routes/auth.js";
import { createPagesRouter } from "./routes/pages.js";

const PORT = process.env.PORT || 2567;
const uploadsDir = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(import.meta.dirname, "public", "uploads");
await mkdir(uploadsDir, { recursive: true });

const app = express();
// Set only for a known reverse-proxy topology, never trust forwarded headers blindly.
const proxyHops = Number(process.env.TRUST_PROXY_HOPS || 0);
if (!Number.isInteger(proxyHops) || proxyHops < 0 || proxyHops > 5) {
  throw new Error("TRUST_PROXY_HOPS must be an integer between 0 and 5");
}
app.set("trust proxy", proxyHops);
const allowedOrigins = process.env.CLIENT_ORIGIN?.split(",").map((origin) => origin.trim()).filter(Boolean);
app.use(cors(allowedOrigins ? { origin: allowedOrigins, credentials: true } : {}));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use("/uploads", express.static(uploadsDir));
app.use("/vendor/axios", express.static(path.join(import.meta.dirname, "node_modules", "axios", "dist")));
app.use(express.static(path.join(import.meta.dirname, "public")));
app.get("/healthz", (req, res) => res.json({ ok: true }));

const eta = new Eta({ views: path.join(import.meta.dirname, "templates") });
const render = (res, view, data = {}) => res.send(eta.render(view, { ...res.locals, ...data }));

app.use(attachUser);
app.use((req, res, next) => {
  const user = req.user && getUser(req.user.username);
  if (!user?.isBanned || req.path === "/banned" || req.path === "/api/logout") return next();
  if (req.path.startsWith("/api/")) {
    if (allowedOrigins?.includes(req.get("origin"))) res.clearCookie("token");
    return res.status(403).json({
      error: "Aquest compte està bloquejat.", banned: true, reason: user.reason, redirect: "/banned",
    });
  }
  return res.redirect("/banned");
});

app.use(createPagesRouter({ render }));
app.use("/api", createPasswordRecoveryRouter({ store: passwordResetStore }));
app.use("/api", createTwoFactorRouter());
app.use("/api", createAuthRouter({ allowedOrigins }));
app.use("/api", createAccountRouter({ uploadsDir }));

app.use((req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "API route not found" });
  res.status(404).send(eta.render("404"));
});

const server = http.createServer(app);
const gameServer = new Server({ transport: new WebSocketTransport({ server }) });
gameServer.define("game", GameRoom);
gameServer.listen(PORT).then(() => console.log(`Server on :${PORT}`));
