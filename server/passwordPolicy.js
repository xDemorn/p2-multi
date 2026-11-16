import { createHash } from "node:crypto";
import axios from "axios";

// la usan el registro, la recuperación y el cambio de contraseña
export async function validateNewPassword(password) {
  if (typeof password !== "string" || [...password].length < 12) {
    return "La contraseña debe tener como mínimo 12 caracteres.";
  }
  try {
    // SHA-1 solo para consultar HIBP; la contraseña se guarda con Argon2
    const hash = createHash("sha1").update(password).digest("hex").toUpperCase();
    const response = await axios.get(`https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`, {
      headers: { "Add-Padding": "true" },
      timeout: 5000,
    });
    const compromised = String(response.data).split(/\r?\n/).some((line) => {
      const [suffix, count] = line.split(":");
      return suffix?.toUpperCase() === hash.slice(5) && Number(count) > 0;
    });
    if (compromised) return "Esta contraseña ya es conocida y no es segura. Prueba con una frase de varias palabras que puedas recordar.";
  } catch {
    // si HIBP no responde, dejamos continuar
    console.warn("Password policy: HIBP_UNAVAILABLE");
  }
  return null;
}
