import axios from "axios";
import { API } from "../utils/constants.js";

const POLL_MS = 100;
const SAMPLES = 8;

const toState = (snapshot) => ({
  ...snapshot,
  players: new Map(Object.entries(snapshot.players ?? {})),
  boosts: new Map(Object.entries(snapshot.boosts ?? {})),
});

// todo por HTTP: las acciones son POST y el estado se consulta cada 100 ms
export async function joinGame({ token, roomId }) {
  const headers = { Authorization: `Bearer ${token}` };
  const { data } = await axios.post(`${API}/game/join`, { roomId: roomId || null }, { headers });

  let stateHandler = null;
  let leaveHandler = null;
  let timer = null;
  let samples = [];
  let offset = 0;
  let rtt = 0;
  let stopped = false;
  const handlers = new Map();

  const connection = {
    roomId: data.roomId,
    sessionId: data.playerId,
    state: toState(data.state),
    cursor: data.cursor,
    serverNow: () => Date.now() + offset,
    onMessage(type, handler) {
      handlers.set(type, handler);
    },
    onStateChange(handler) {
      stateHandler = handler;
      handler(connection.state);
    },
    onLeave(handler) {
      leaveHandler = handler;
    },
    send(type, payload) {
      const path = type === "selectTeam" ? "team" : type === "moveTo" ? "move" : null;
      if (!path) return;
      const body = type === "selectTeam" ? { team: payload } : payload;
      axios.post(`${API}/game/${connection.roomId}/${path}`, body, { headers })
        .catch((error) => handleFailure(error));
    },
    leave,
    start() {
      if (!stopped) poll();
    },
  };

  function stop() {
    stopped = true;
    clearTimeout(timer);
    window.removeEventListener("pagehide", leaveOnPageHide);
  }

  // al cerrar la pestaña avisamos con sendBeacon (el token va en el body)
  function leaveOnPageHide(event) {
    if (event.persisted || stopped) return; // bfcache: la página puede volver
    stop();
    navigator.sendBeacon?.(`${API}/game/${connection.roomId}/leave`, new URLSearchParams({ token }));
  }

  window.addEventListener("pagehide", leaveOnPageHide);

  // el servidor ya no nos acepta (token caducado, expulsado o sala borrada)
  function handleFailure(error) {
    const status = error.response?.status;
    if (![401, 404, 410].includes(status)) return;
    stop();
    leaveHandler?.();
  }

  async function leave() {
    stop();
    try {
      await axios.post(`${API}/game/${connection.roomId}/leave`, {}, { headers });
    } catch {
      // ya estábamos fuera
    }
  }

  async function poll() {
    if (stopped) return;
    const sentAt = Date.now();
    try {
      const { data } = await axios.get(`${API}/game/${connection.roomId}`, {
        headers,
        params: { since: connection.cursor, ...(samples.length ? { rtt } : {}) },
      });
      const receivedAt = Date.now();
      const roundTrip = receivedAt - sentAt;
      samples = [...samples, { rtt: roundTrip, offset: data.serverTime + roundTrip / 2 - receivedAt }].slice(-SAMPLES);
      // la respuesta más rápida es la que mejor estima el reloj
      offset = samples.reduce((best, sample) => (sample.rtt < best.rtt ? sample : best)).offset;
      rtt = Math.round(samples.reduce((sum, sample) => sum + sample.rtt, 0) / samples.length);

      connection.cursor = data.cursor;
      connection.state = { ...connection.state, ...toState(data.state) };
      for (const event of data.events) {
        handlers.get(event.type)?.(event.type === "error" ? event.message : event);
      }
      stateHandler?.(connection.state);
    } catch (error) {
      handleFailure(error);
    } finally {
      if (!stopped) timer = setTimeout(poll, Math.max(0, POLL_MS - (Date.now() - sentAt)));
    }
  }

  return connection;
}
