import { $ } from "./utils/functions.js";

export function createPlayerPings(getRoom) {
  const rows = new Map();
  let open = false;

  function toggle() {
    if (getRoom()?.state.phase !== "playing") return;
    open = !open;
    sync(getRoom().state);
  }

  function sync(state) {
    const list = $("player-pings");
    const playing = state.phase === "playing";
    if (!playing) open = false;
    $("ping-toggle").hidden = !playing;
    $("ping-toggle").setAttribute("aria-expanded", String(playing && open));
    list.hidden = !playing || !open;
    if (list.hidden) return;

    state.players.forEach((player, id) => {
      let row = rows.get(id);
      if (!row) {
        row = document.createElement("div");
        row.className = "player-ping";
        row.setAttribute("role", "listitem");
        row.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="2" y="16" width="4" height="6" rx="1"/><rect x="8" y="11" width="4" height="11" rx="1"/><rect x="14" y="6" width="4" height="16" rx="1"/><rect x="20" y="2" width="4" height="20" rx="1"/></svg><span class="player-ping-name"></span><span class="player-ping-value"></span>';
        list.appendChild(row);
        rows.set(id, row);
      }
      const ping = player.ping;
      const color = ping < 0 ? "#c4b795" : ping < 100 ? "#b5d583" : ping < 250 ? "#f1cf76" : "#f49a7e";
      row.querySelector("svg").style.color = color;
      row.querySelector(".player-ping-name").textContent = player.name + (id === getRoom().sessionId ? " (tú)" : "");
      row.querySelector(".player-ping-value").textContent = ping < 0 ? "—" : `${ping} ms`;
      row.title = ping < 0 ? `${player.name}: esperando medición de ping` : `${player.name}: ${ping} ms de ping`;
    });

    for (const [id, row] of rows) {
      if (!state.players.has(id)) {
        row.remove();
        rows.delete(id);
      }
    }
  }

  function reset() {
    for (const row of rows.values()) row.remove();
    rows.clear();
    open = false;
  }

  $("ping-toggle").onclick = toggle;
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
      || getRoom()?.state.phase !== "playing") return;
    if (event.target instanceof HTMLElement
      && (event.target.isContentEditable || event.target.closest("input, textarea, select"))) return;
    event.preventDefault();
    if (!event.repeat) toggle();
  });

  return { sync, reset };
}
