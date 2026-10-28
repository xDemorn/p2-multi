import { TH, TW } from "./constants.js";

export const $ = (id) => document.getElementById(id);

// ---------- isometric helpers ----------
export const toScreen = (x, y) => ({ x: (x - y) * TW / 2, y: (x + y) * TH / 2 });
export const toGrid = (sx, sy) => ({ x: (sx / (TW / 2) + sy / (TH / 2)) / 2, y: (sy / (TH / 2) - sx / (TW / 2)) / 2 });