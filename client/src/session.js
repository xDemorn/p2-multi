import axios from "axios";
import { API, BASE } from "./utils/constants.js";

// el token va en sessionStorage: aguanta recargas, pero no cerrar la pestaña
const KEY = "torneo-token";

function read() {
  try { return sessionStorage.getItem(KEY); } catch { return null; }
}

let token = read();

export const getToken = () => token;

export function setToken(value) {
  token = value || null;
  try {
    if (token) sessionStorage.setItem(KEY, token);
    else sessionStorage.removeItem(KEY);
  } catch { /* private mode: the session simply won't survive a reload */ }
}

// el servidor está en otro dominio, así que el token va en la cabecera
export const api = axios.create({ baseURL: API, withCredentials: true });
api.interceptors.request.use((config) => {
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export function errorMessage(error, fallback) {
  if (error.response?.data?.error) return error.response.data.error;
  // sin respuesta: servidor caído, URL mal o CORS
  if (!error.response) return "No se puede conectar con el servidor. Comprueba que está en marcha e inténtalo de nuevo.";
  if (error.response.status === 429) return "Demasiados intentos. Espera unos minutos.";
  return `${fallback || "Algo ha fallado."} (código ${error.response.status})`;
}

// rutas del servidor como /uploads/x.png
export const assetUrl = (path) => (path ? new URL(path, `${BASE}/`).href : `${BASE}/icons/default.svg`);

export async function fetchMe() {
  const { data } = await api.get("/me");
  return data;
}

export async function logout() {
  try { await api.post("/logout"); } catch { /* the local session is cleared anyway */ }
  setToken(null);
}
