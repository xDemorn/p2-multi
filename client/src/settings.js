import { audio } from "./audio.js";
import { $ } from "./utils/functions.js";

// botón de música y panel de ajustes (no pausa la partida)
export function setupSettings({ onLeave }) {
  let confirming = false;
  let inRoom = false;

  function setOpen(open) {
    $("settings-panel").hidden = !open;
    $("settings-toggle").setAttribute("aria-expanded", String(open));
    resetLeave();
    if (open) $("settings-close").focus();
  }

  function resetLeave() {
    confirming = false;
    $("settings-leave").textContent = "Volver al menú principal";
  }

  function render({ music, effects, muted, musicOn }) {
    $("music-volume").value = Math.round(music * 100);
    $("effects-volume").value = Math.round(effects * 100);
    $("music-volume-value").textContent = `${Math.round(music * 100)}%`;
    $("effects-volume-value").textContent = `${Math.round(effects * 100)}%`;
    $("mute-all").checked = muted;
    $("music-on").checked = musicOn;
    const playing = musicOn && !muted;
    $("music-toggle").setAttribute("aria-pressed", String(playing));
    $("music-toggle").classList.toggle("off", !playing);
    $("music-toggle").title = playing ? "Quitar música" : "Poner música";
  }

  $("music-volume").oninput = () => audio.set({ music: $("music-volume").value / 100 });
  $("effects-volume").oninput = () => audio.set({ effects: $("effects-volume").value / 100 });
  $("effects-volume").onchange = () => audio.play("spell"); // para oír el nuevo volumen
  $("mute-all").onchange = () => audio.set({ muted: $("mute-all").checked });
  $("music-on").onchange = () => audio.set({ musicOn: $("music-on").checked });
  // si estaba todo silenciado, el botón también lo quita
  $("music-toggle").onclick = () => {
    const { musicOn, muted } = audio.settings();
    const playing = musicOn && !muted;
    audio.set(playing ? { musicOn: false } : { musicOn: true, muted: false });
  };

  $("settings-toggle").onclick = () => setOpen($("settings-panel").hidden);
  $("settings-close").onclick = () => setOpen(false);
  $("settings-leave").onclick = () => {
    if (!confirming) {
      confirming = true;
      $("settings-leave").textContent = "¿Seguro? Pulsa otra vez para salir";
      return;
    }
    setOpen(false);
    onLeave();
  };

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    // en los menús Esc solo cierra; en la sala también abre
    if (!inRoom && $("settings-panel").hidden) return;
    event.preventDefault();
    setOpen($("settings-panel").hidden);
  });

  audio.onChange(render);

  return {
    // dentro de una sala se puede volver al menú
    setInRoom(value) {
      inRoom = value;
      $("settings-leave").hidden = !value;
      $("settings-hint").hidden = !value;
      $("settings-close").textContent = value ? "Seguir jugando" : "Cerrar";
      $("settings-panel").hidden || setOpen(false);
    },
  };
}
