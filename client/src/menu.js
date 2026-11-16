import { assetUrl } from "./session.js";
import { $ } from "./utils/functions.js";

// menú principal
export function setupMenu({ onQuickPlay, onCreateRoom, onJoinRoom, onProfile, onLogout }) {
  const msg = (text = "") => ($("home-msg").textContent = text);
  const buttons = ["quick-play", "create-room", "join-toggle", "open-profile", "logout"];

  async function run(action) {
    msg();
    buttons.forEach((id) => ($(id).disabled = true));
    try {
      await action();
    } catch (error) {
      msg(error.message);
    } finally {
      buttons.forEach((id) => ($(id).disabled = false));
    }
  }

  function setJoinOpen(open) {
    $("join-form").hidden = !open;
    $("join-toggle").setAttribute("aria-expanded", String(open));
    $("join-toggle").classList.toggle("active", open);
    if (open) $("room-code").focus();
  }

  $("quick-play").onclick = () => run(onQuickPlay);
  $("create-room").onclick = () => run(onCreateRoom);
  $("join-toggle").onclick = () => setJoinOpen($("join-form").hidden);
  $("join-form").onsubmit = (event) => {
    event.preventDefault();
    const code = $("room-code").value.trim();
    if (code) run(() => onJoinRoom(code));
  };
  $("open-profile").onclick = () => run(onProfile);
  $("logout").onclick = () => run(onLogout);

  return {
    render(user) {
      $("home-avatar").src = assetUrl(user.avatar);
      $("home-name").textContent = user.nickname || user.username;
      $("home-trophies").textContent = user.trophies ?? 0;
      $("room-code").value = "";
      setJoinOpen(false);
    },
    message: msg,
  };
}
