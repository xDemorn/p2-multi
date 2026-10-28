import jwt from "jsonwebtoken";

if (process.env.NODE_ENV === "production" && !process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET must be set in production");
}

export const jwtSecret = process.env.JWT_SECRET || "change-me-in-production";

export const createToken = (u) => jwt.sign({ id: u.id, username: u.username }, jwtSecret, { expiresIn: "1h" });

export function attachUser(req, res, next) {
  const token = req.cookies.token;
  res.locals.user = null;

  if (token) {
    try {
      req.user = jwt.verify(token, jwtSecret);
      res.locals.user = req.user;
    } catch (err) {
      res.clearCookie("token"); // expired or invalid
    }
  }
  next();
}

export function auth(req, res, next) {
  if (!req.user) return res.redirect("/login");
  next();
}