import { api, assetUrl, errorMessage, fetchMe } from "./session.js";
import { attachPasswordHelp } from "./passwordHelp.js";
import { $ } from "./utils/functions.js";

export function setupProfile({ onBack, onUpdated, onDeleted }) {
  let previewUrl;
  let personal = [];
  const passwordHelp = attachPasswordHelp({
    input: "new-password", confirm: "confirm-password", container: "profile-pw-help", getPersonal: () => personal,
  });
  const msg = (text = "", ok = false) => {
    $("profile-msg").textContent = text;
    $("profile-msg").classList.toggle("ok", ok);
    if (text) $("profile-msg").scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  function clearPreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = undefined;
    $("profile-avatar-input").value = "";
  }

  function fill(user) {
    clearPreview();
    personal = [user.username, user.email?.split("@")[0]];
    $("profile-avatar").src = assetUrl(user.avatar);
    $("profile-username").textContent = user.username;
    $("profile-email").textContent = user.email || "—";
    $("profile-birthdate").textContent = user.birthdate
      ? new Date(`${user.birthdate}T00:00:00`).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" })
      : "—";
    $("profile-nickname").value = user.nickname;
    const trophies = user.trophies ?? 0;
    $("profile-trophies").textContent = trophies;
    $("profile-trophies-label").textContent = trophies === 1 ? "copa ganada" : "copas ganadas";
    $("totp-badge").textContent = user.totpEnabled ? "Activada" : "Desactivada";
    $("totp-badge").classList.toggle("on", user.totpEnabled);
    $("totp-on").hidden = !user.totpEnabled;
    $("totp-off").hidden = user.totpEnabled;
    $("totp-setup").hidden = true;
    $("totp-start").hidden = false;
    ["totp-enable-code", "totp-disable-code"].forEach((id) => ($(id).value = ""));
    document.querySelectorAll("#profile details").forEach((details) => (details.open = false));
  }

  async function reload() {
    const user = await fetchMe();
    fill(user);
    onUpdated(user);
  }

  $("profile-avatar-input").onchange = () => {
    const [file] = $("profile-avatar-input").files;
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      clearPreview();
      return msg("La imagen supera los 2 MB.");
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(file);
    $("profile-avatar").src = previewUrl;
    msg("Pulsa «Guardar cambios» para usar este avatar.", true);
  };

  $("profile-form").onsubmit = async (event) => {
    event.preventDefault();
    const data = new FormData();
    data.append("nickname", $("profile-nickname").value.trim());
    const [file] = $("profile-avatar-input").files;
    if (file) data.append("avatar", file);
    try {
      await api.put("/profile", data);
      await reload();
      msg("Perfil actualizado.", true);
    } catch (e) {
      msg(errorMessage(e, "No se ha podido guardar el perfil."));
    }
  };

  $("password-form").onsubmit = async (event) => {
    event.preventDefault();
    const problem = passwordHelp.problem();
    if (problem) return msg(problem);
    try {
      await api.post("/password", {
        current_password: $("current-password").value,
        new_password: $("new-password").value,
        confirm_new_password: $("confirm-password").value,
      });
      $("password-form").reset();
      passwordHelp.update();
      $("password-form").closest("details").open = false;
      msg("Contraseña cambiada correctamente.", true);
    } catch (e) {
      msg(errorMessage(e, "No se ha podido cambiar la contraseña."));
    }
  };

  $("totp-start").onclick = async () => {
    try {
      const { data } = await api.post("/2fa/setup");
      $("totp-qr").src = data.qr;
      $("totp-secret").textContent = data.secret;
      $("totp-setup").hidden = false;
      $("totp-start").hidden = true;
      $("totp-enable-code").focus();
      msg();
    } catch (e) {
      msg(errorMessage(e, "No se ha podido iniciar la configuración del 2FA."));
    }
  };

  $("totp-enable").onclick = async () => {
    try {
      await api.post("/2fa/enable", { code: $("totp-enable-code").value.trim() });
      await reload();
      msg("Verificación en dos pasos activada.", true);
    } catch (e) {
      msg(errorMessage(e, "No se ha podido activar el 2FA."));
    }
  };

  $("totp-disable").onclick = async () => {
    try {
      await api.post("/2fa/disable", { code: $("totp-disable-code").value.trim() });
      await reload();
      msg("Verificación en dos pasos desactivada.", true);
    } catch (e) {
      msg(errorMessage(e, "No se ha podido desactivar el 2FA."));
    }
  };

  $("delete-form").onsubmit = async (event) => {
    event.preventDefault();
    if (!confirm("¿Seguro que quieres eliminar tu cuenta? No se puede deshacer.")) return;
    try {
      await api.post("/delete", { current_password: $("delete-password").value });
      $("delete-form").reset();
      onDeleted();
    } catch (e) {
      msg(errorMessage(e, "No se ha podido eliminar la cuenta."));
    }
  };

  $("profile-back").onclick = () => {
    clearPreview();
    onBack();
  };

  return {
    open(user) {
      msg();
      fill(user);
    },
  };
}
