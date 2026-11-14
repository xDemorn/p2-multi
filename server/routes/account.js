import path from "node:path";
import { rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Router } from "express";
import argon2 from "argon2";
import multer from "multer";
import { deleteUser, getUser, updateUserPassword, updateUserProfile } from "../db/utils.js";
import { validateNewPassword } from "../passwordPolicy.js";
import { auth } from "../utils.js";

export function createAccountRouter({ uploadsDir }) {
  const router = Router();
  const storage = multer.diskStorage({
    destination: (req, file, callback) => callback(null, uploadsDir),
    filename: (req, file, callback) => {
      // Random name: avoids collisions and ignores the user-supplied filename.
      const extension = path.extname(file.originalname).toLowerCase();
      callback(null, randomUUID() + extension);
    },
  });
  const upload = multer({
    storage,
    limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
    fileFilter: (req, file, callback) => {
      const allowed = ["image/jpeg", "image/png", "image/webp"];
      callback(null, allowed.includes(file.mimetype));
    },
  });

  router.put("/profile", auth, upload.single("avatar"), async (req, res) => {
    const nickname = (req.body.nickname || "").trim();
    const user = getUser(req.user.username);
    if (!user) return res.status(404).json({ error: "User not found" });

    const avatar = req.file ? `/uploads/${req.file.filename}` : user.avatar;
    updateUserProfile(user.username, nickname, avatar);
    if (req.file && user.avatar?.startsWith("/uploads/")) {
      await rm(path.join(uploadsDir, path.basename(user.avatar)), { force: true });
    }
    res.json({ ok: true, nickname, avatar });
  });

  router.post("/password", auth, async (req, res) => {
    const { current_password, new_password, confirm_new_password } = req.body ?? {};
    const user = getUser(req.user.username);
    if (!user) {
      res.clearCookie("token");
      return res.status(401).json({ error: "La sessió no és vàlida. Torna a iniciar sessió." });
    }
    if (!current_password || !new_password || !confirm_new_password) {
      return res.status(400).json({ error: "Omple tots els camps de contrasenya." });
    }
    if (new_password !== confirm_new_password) {
      return res.status(400).json({ error: "Les contrasenyes noves no coincideixen." });
    }
    const passwordError = await validateNewPassword(String(new_password));
    if (passwordError) return res.status(400).json({ error: passwordError });
    if (!(await argon2.verify(user.hash, String(current_password)))) {
      return res.status(401).json({ error: "La contrasenya actual no és correcta." });
    }

    updateUserPassword(user.username, await argon2.hash(new_password));
    res.json({ ok: true });
  });

  router.post("/delete", (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "La sessió no és vàlida. Torna a iniciar sessió." });
    next();
  }, async (req, res) => {
    const user = getUser(req.user.username);
    if (!user) {
      res.clearCookie("token");
      return res.status(401).json({ error: "La sessió no és vàlida. Torna a iniciar sessió." });
    }

    const showError = (status, message) => res.status(status).json({ error: message });
    const password = req.body?.current_password;
    if (typeof password !== "string" || !password) {
      return showError(400, "Introdueix la contrasenya actual.");
    }

    let matches;
    try {
      matches = await argon2.verify(user.hash, password);
    } catch (error) {
      console.error("Account deletion password check failed:", error);
      return showError(500, "No s'ha pogut verificar la contrasenya. Torna-ho a provar.");
    }
    if (!matches) return showError(401, "La contrasenya no és correcta.");

    try {
      if (!deleteUser(user.id)) {
        res.clearCookie("token");
        return showError(401, "La sessió no és vàlida. Torna a iniciar sessió.");
      }
    } catch (error) {
      console.error("Account deletion failed:", error);
      return showError(500, "No s'ha pogut eliminar el compte. Torna-ho a provar.");
    }

    res.clearCookie("token");
    if (user.avatar?.startsWith("/uploads/")) {
      try {
        await rm(path.join(uploadsDir, path.basename(user.avatar)), { force: true });
      } catch (error) {
        console.error("Could not remove deleted account avatar:", error);
      }
    }
    return res.sendStatus(204);
  });

  return router;
}
