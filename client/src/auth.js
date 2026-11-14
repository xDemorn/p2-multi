import axios from "axios";
import { API, BASE } from "./utils/constants.js";
import { $ } from "./utils/functions.js";

export function setupAuth(onAuthenticated) {
  // Set by the password step; it only proves the password was correct.
  let pendingTwoFactor = null;

  function resetTwoFactorStep() {
    pendingTwoFactor = null;
    $("totp").hidden = true;
    $("totp").value = "";
  }

  function showLogin() {
    resetTwoFactorStep();
    $("msg").textContent = "";
  }

  $("register").href = `${BASE}/register`;
  $("forgot-password-link").href = `${BASE}/forgot`;
  $("profile-link").href = `${BASE}/profile`;

  async function auth() {
    $("msg").textContent = "";
    if (pendingTwoFactor) {
      try {
        const { data } = await axios.post(
          `${API}/login/2fa`,
          { challenge: pendingTwoFactor, code: $("totp").value },
          { withCredentials: true },
        );
        await onAuthenticated(data.token, $("room-id").value.trim());
      } catch (e) {
        if (e.response?.status === 401) resetTwoFactorStep();
        $("msg").textContent = e.response?.data?.error || e.message;
      }
      return;
    }

    const payload = { username: $("user").value.trim(), password: $("pass").value };
    try {
      const { data } = await axios.post(`${API}/login`, payload, { withCredentials: true });
      if (data.requires2fa) {
        pendingTwoFactor = data.challenge;
        $("totp").hidden = false;
        $("totp").focus();
        $("msg").textContent = "Introduce el código de 6 dígitos de tu aplicación de autenticación.";
        return;
      }
      await onAuthenticated(data.token, $("room-id").value.trim());
    } catch (e) {
      const data = e.response?.data;
      if (data?.banned) {
        $("msg").textContent = data.reason
          ? `Tu cuenta está bloqueada. Motivo: ${data.reason}`
          : "Tu cuenta está bloqueada.";
      } else if (data?.redirect) {
        window.location.assign(new URL(data.redirect, API).href);
      } else {
        $("msg").textContent = data?.error || e.message;
      }
    }
  }

  $("login-panel").onsubmit = (event) => {
    event.preventDefault();
    auth();
  };

  return { showLogin };
}
