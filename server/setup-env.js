import { copyFileSync, constants, existsSync } from "node:fs";

const envPath = new URL("./.env", import.meta.url);

if (!existsSync(envPath)) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Configure .env before starting in production; automatic setup is for local development only.");
  }
  copyFileSync(new URL("./.env.example", import.meta.url), envPath, constants.COPYFILE_EXCL);
  console.log("Created .env from .env.example for local development.");
}
