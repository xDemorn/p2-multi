// Set at container start (/config.js); falls back to the local dev server.
const runtimeServerUrl = typeof window !== "undefined" ? window.__SERVER_URL__ : "";
export const BASE = (runtimeServerUrl || `http://${location.hostname}:2567`).replace(/\/+$/, "");
export const API = `${BASE}/api`;
export const HOST = `${BASE}`;
export const GRID = 60;
export const TW = 232;
export const TH = 110;
export const WORLD_SCALE = 0.5;
export const COLORS = [0xe74c3c, 0x3498db, 0x2ecc71, 0xf1c40f, 0x9b59b6, 0xe67e22];