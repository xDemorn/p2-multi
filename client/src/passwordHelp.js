import { $ } from "./utils/functions.js";

export const MIN_PASSWORD = 12;

const SEQUENCES = ["0123456789", "abcdefghijklmnopqrstuvwxyz", "qwertyuiop", "asdfghjkl", "zxcvbnm"];
const COMMON = ["password", "contraseña", "contrasena", "qwerty", "123456", "admin", "iloveyou", "letmein", "bienvenido"];

function hasSimplePattern(password) {
  const lower = password.toLowerCase();
  if (/(.)\1{3,}/.test(lower)) return true; // aaaa, 1111
  if (COMMON.some((word) => lower.includes(word))) return true;
  return SEQUENCES.some((seq) => {
    for (let i = 0; i + 4 <= seq.length; i++) {
      const chunk = seq.slice(i, i + 4);
      if (lower.includes(chunk) || lower.includes([...chunk].reverse().join(""))) return true;
    }
    return false;
  });
}

export function evaluatePassword(password, personal = []) {
  const length = [...password].length;
  const lower = password.toLowerCase();
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z\d\s]/].filter((re) => re.test(password)).length;
  const words = password.trim().split(/\s+/).filter((w) => w.length >= 3).length;
  const checks = {
    length: length >= MIN_PASSWORD,
    personal: !personal.some((value) => value && value.length >= 3 && lower.includes(value.toLowerCase())),
    pattern: !hasSimplePattern(password),
    variety: words >= 3 || classes >= 3,
  };
  let level = "empty";
  if (length > 0) level = "weak";
  if (checks.length && checks.personal && checks.pattern) level = "ok";
  if (level === "ok" && checks.variety && length >= 16) level = "strong";
  return { length, checks, level, valid: checks.length && checks.personal };
}

const LEVELS = {
  empty: { text: "", width: 0 },
  weak: { text: "Débil", width: 30 },
  ok: { text: "Aceptable", width: 65 },
  strong: { text: "Fuerte", width: 100 },
};

// barra de seguridad y consejos bajo el campo de contraseña.
// getPersonal: datos que no puede contener (usuario, correo)
export function attachPasswordHelp({ input, confirm, container, getPersonal = () => [] }) {
  const box = $(container);
  box.className = "pw-help";
  box.innerHTML = `
    <div class="pw-bar" aria-hidden="true"><span></span></div>
    <div class="pw-head"><span class="pw-level"></span><span class="pw-count"></span></div>
    <ul class="pw-tips">
      <li data-check="length">Al menos ${MIN_PASSWORD} caracteres</li>
      <li data-check="personal">Que no incluya tu usuario ni tu correo</li>
      <li data-check="pattern">Evita repeticiones y secuencias (aaaa, 1234, qwerty…)</li>
      <li data-check="variety" class="optional">Mejor aún: varias palabras o mezcla letras, números y símbolos</li>
    </ul>
    <p class="pw-match" aria-live="polite"></p>`;

  function update() {
    const password = $(input).value;
    const result = evaluatePassword(password, getPersonal());
    const level = LEVELS[result.level];
    box.dataset.level = result.level;
    box.querySelector(".pw-bar span").style.width = `${level.width}%`;
    box.querySelector(".pw-level").textContent = level.text;
    box.querySelector(".pw-count").textContent = `${result.length} / ${MIN_PASSWORD} caracteres`;
    box.querySelectorAll("[data-check]").forEach((li) => {
      li.classList.toggle("done", password.length > 0 && result.checks[li.dataset.check]);
    });

    const match = box.querySelector(".pw-match");
    const repeat = confirm ? $(confirm).value : "";
    match.textContent = !repeat ? "" : repeat === password ? "✓ Las contraseñas coinciden" : "✗ Las contraseñas no coinciden";
    match.classList.toggle("bad", Boolean(repeat) && repeat !== password);
    return result;
  }

  $(input).addEventListener("input", update);
  if (confirm) $(confirm).addEventListener("input", update);
  update();

  return {
    update,
    // devuelve el motivo para no enviar el formulario, o ""
    problem() {
      const result = update();
      if (!result.checks.length) return `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres (ahora tiene ${result.length}).`;
      if (!result.checks.personal) return "La contraseña no puede contener tu usuario ni tu correo.";
      if (confirm && $(confirm).value !== $(input).value) return "Las contraseñas no coinciden.";
      return "";
    },
  };
}
