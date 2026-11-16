import { api, errorMessage } from "./session.js";
import { attachPasswordHelp } from "./passwordHelp.js";
import { audio } from "./audio.js";
import { API } from "./utils/constants.js";
import { $ } from "./utils/functions.js";

const MIN_AGE = 16;

function ageFrom(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const today = new Date();
  const hadBirthday = today.getMonth() + 1 > month || (today.getMonth() + 1 === month && today.getDate() >= day);
  return today.getFullYear() - year - (hadBirthday ? 0 : 1);
}

const PANELS =["login-panel", "register-panel", "forgot-panel", "reset-panel"];

export function setupAuth(onAuthenticated) {
  // token temporal del 2FA (solo prueba que la contraseña era buena)
  let pendingTwoFactor = null;
  let resetToken = "";
  const msg = (text = "", ok = false) => {
    $("msg").textContent = text;
    $("msg").classList.toggle("ok", ok);
    if (text) $("msg").scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  function resetTwoFactorStep() {
    pendingTwoFactor = null;
    $("totp").hidden = true;
    $("totp").value = "";
  }

  function showPanel(id) {
    PANELS.forEach((panel) => $(panel).classList.toggle("active", panel === id));
    msg();
    if (id === "login-panel") resetTwoFactorStep();
    $(id).querySelector("input:not([hidden])")?.focus();
  }

  document.querySelectorAll("[data-panel]").forEach((button) => {
    button.onclick = () => {
      audio.play("click");
      showPanel(button.dataset.panel);
    };
  });

  const busy = (form, value) => form.querySelectorAll("button").forEach((b) => (b.disabled = value));
  const submit = (id, handler) => {
    $(id).onsubmit = async (event) => {
      event.preventDefault();
      busy($(id), true);
      try { await handler(); } finally { busy($(id), false); }
    };
  };

  submit("login-panel", async () => {
    msg();
    try {
      if (pendingTwoFactor) {
        const { data } = await api.post("/login/2fa", { challenge: pendingTwoFactor, code: $("totp").value });
        $("pass").value = "";
        resetTwoFactorStep();
        return onAuthenticated(data.token);
      }
      const { data } = await api.post("/login", { username: $("user").value.trim(), password: $("pass").value });
      if (data.requires2fa) {
        pendingTwoFactor = data.challenge;
        $("totp").hidden = false;
        $("totp").focus();
        msg("Introduce el código de 6 dígitos de tu aplicación de autenticación.", true);
        return;
      }
      $("pass").value = "";
      await onAuthenticated(data.token);
    } catch (e) {
      const data = e.response?.data;
      if (pendingTwoFactor && e.response?.status === 401) resetTwoFactorStep();
      if (data?.banned) {
        msg(data.reason ? `Tu cuenta está bloqueada. Motivo: ${data.reason}` : "Tu cuenta está bloqueada.");
      } else if (data?.redirect) {
        window.location.assign(new URL(data.redirect, API).href);
      } else {
        msg(e.response?.status === 401 && !pendingTwoFactor ? "Usuario o contraseña incorrectos." : errorMessage(e));
      }
    }
  });

  const registerHelp = attachPasswordHelp({
    input: "reg-pass", confirm: "reg-confirm", container: "reg-pw-help",
    getPersonal: () => [$("reg-user").value.trim(), $("reg-email").value.trim().split("@")[0]],
  });
  $("reg-user").addEventListener("input", registerHelp.update);
  $("reg-email").addEventListener("input", registerHelp.update);
  const resetHelp = attachPasswordHelp({ input: "reset-pass", confirm: "reset-confirm", container: "reset-pw-help" });

  $("reg-birthdate").addEventListener("change", () => {
    const age = ageFrom($("reg-birthdate").value);
    $("reg-age").textContent = age === null ? "" : age >= MIN_AGE
      ? `✓ Tienes ${age} años.`
      : `✗ Debes tener al menos ${MIN_AGE} años (tienes ${age}).`;
    $("reg-age").classList.toggle("bad", age !== null && age < MIN_AGE);
  });

  submit("register-panel", async () => {
    msg();
    if ([...$("reg-user").value.trim()].length < 3) return msg("El nombre de usuario debe tener al menos 3 caracteres.");
    const age = ageFrom($("reg-birthdate").value);
    if (age === null || age < 0) return msg("La fecha de nacimiento no es válida.");
    if (age < MIN_AGE) return msg(`Debes tener al menos ${MIN_AGE} años para registrarte.`);
    const problem = registerHelp.problem();
    if (problem) return msg(problem);
    try {
      const { data } = await api.post("/register", {
        username: $("reg-user").value.trim(),
        email: $("reg-email").value.trim(),
        birthdate: $("reg-birthdate").value,
        password: $("reg-pass").value,
        confirm_password: $("reg-confirm").value,
      });
      $("register-panel").reset();
      $("reg-age").textContent = "";
      registerHelp.update();
      await onAuthenticated(data.token);
    } catch (e) {
      msg(errorMessage(e, "No se ha podido crear la cuenta."));
    }
  });

  submit("forgot-panel", async () => {
    msg();
    try {
      const { data } = await api.post("/forgot-password", { email: $("forgot-email").value.trim() });
      msg(data.message, true);
    } catch (e) {
      msg(errorMessage(e, "No se ha podido enviar el enlace."));
    }
  });

  submit("reset-panel", async () => {
    msg();
    const problem = resetHelp.problem();
    if (problem) return msg(problem);
    try {
      const { data } = await api.post("/reset-password", {
        token: resetToken, password: $("reset-pass").value, confirmPassword: $("reset-confirm").value,
      });
      resetToken = "";
      $("reset-panel").reset();
      resetHelp.update();
      showPanel("login-panel");
      msg(data.message, true);
    } catch (e) {
      msg(errorMessage(e, "No se ha podido cambiar la contraseña."));
    }
  });

  // los enlaces del correo llegan como #reset-password=<token>
  function consumeResetLink() {
    const token = new URLSearchParams(location.hash.slice(1)).get("reset-password");
    if (!token) return false;
    history.replaceState(null, "", location.pathname + location.search); // lo quitamos de la barra
    if (!/^[a-f0-9]{64}$/.test(token)) {
      showPanel("forgot-panel");
      msg("El enlace no es válido o ha caducado. Solicita uno nuevo.");
      return true;
    }
    resetToken = token;
    showPanel("reset-panel");
    return true;
  }

  return { showLogin: () => showPanel("login-panel"), consumeResetLink, message: msg };
}
