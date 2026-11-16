import { Router } from "express";
import { getUser } from "../db/utils.js";
import { auth } from "../utils.js";

export function createPagesRouter({ render }) {
  const router = Router();

  // con CLIENT_URL todo pasa por el cliente (el #token del reset se conserva)
  const clientUrl = process.env.CLIENT_URL?.replace(/\/+$/, "");
  if (clientUrl) {
    router.get(["/", "/login", "/register", "/profile", "/forgot", "/reset", "/delete"], (req, res) =>
      res.redirect(`${clientUrl}/`));
  }

  router.get("/", (req, res) => render(res, "home"));
  router.get("/login", (req, res) => render(res, "login"));
  router.get("/register", (req, res) => render(res, "register"));
  router.get("/forgot", (req, res) => render(res, "forgot"));
  router.get("/reset", (req, res) => render(res, "reset"));

  router.get("/delete", auth, (req, res) => {
    if (!getUser(req.user.username)) return res.redirect("/");
    render(res, "delete");
  });

  router.get("/banned", auth, (req, res) => {
    const user = getUser(req.user.username);
    if (!user) {
      res.clearCookie("token");
      return res.redirect("/login");
    }
    if (!user.isBanned) return res.redirect("/");
    render(res, "banned", { DATA_REASON: user.reason });
  });

  router.get("/profile", auth, (req, res) => {
    const user = getUser(req.user.username);
    render(res, "profile", {
      DATA_USERNAME: req.user.username,
      DATA_EMAIL: user.email,
      DATA_BIRTHDATE: user.birthdate,
      DATA_NICKNAME: user.nickname,
      DATA_AVATAR: user.avatar,
      DATA_TOTP_ENABLED: Boolean(user.totp_enabled),
    });
  });

  return router;
}
