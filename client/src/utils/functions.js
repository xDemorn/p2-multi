import { TH, TW } from "./constants.js";

export const $ = (id) => document.getElementById(id);

// avisa cuando cambia la pantalla (para el sonido)
export const screenListeners = new Set();
let currentScreen = null;

export function show(id) {
  document.querySelectorAll(".screen").forEach((screen) => screen.classList.toggle("active", screen.id === id));
  if (id === currentScreen) return;
  const previous = currentScreen;
  currentScreen = id;
  screenListeners.forEach((listener) => listener(id, previous));
}

// --- isométrico ---
export const toScreen = (x, y) => ({ x: (x - y) * TW / 2, y: (x + y) * TH / 2 });
export const toGrid = (sx, sy) => ({ x: (sx / (TW / 2) + sy / (TH / 2)) / 2, y: (sy / (TH / 2) - sx / (TW / 2)) / 2 });