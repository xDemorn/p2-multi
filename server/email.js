import axios from "axios";

// Backend only: never expose these settings through Vite or /config.js.
export async function sendRecoveryEmail({ recipientEmail, resetUrl }) {
  const { BREVO_API_KEY, BREVO_SENDER_EMAIL, BREVO_SENDER_NAME } = process.env;
  if (!BREVO_API_KEY || !BREVO_SENDER_EMAIL || !BREVO_SENDER_NAME) {
    throw new Error("BREVO_NOT_CONFIGURED");
  }

  let response;
  try {
    response = await axios.post("https://api.brevo.com/v3/smtp/email", {
      sender: { email: BREVO_SENDER_EMAIL, name: BREVO_SENDER_NAME },
      to: [{ email: recipientEmail }],
      subject: "Recupera tu contraseña — El torneo de los magos",
      textContent: `Para cambiar tu contraseña, abre este enlace:\n${resetUrl}\n\n` +
        "El enlace caduca en 30 minutos y solo se puede usar una vez. " +
        "Si no lo has solicitado, ignora este mensaje.",
    }, {
      headers: { "api-key": BREVO_API_KEY, Accept: "application/json" },
      timeout: 10000,
      validateStatus: () => true,
    });
  } catch (error) {
    if (error?.code === "ECONNABORTED" || error?.code === "ETIMEDOUT") throw new Error("BREVO_TIMEOUT");
    const known = ["EACCES", "EPERM", "ENOTFOUND", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT"];
    throw new Error(known.includes(error?.code) ? `BREVO_NETWORK_${error.code}` : "BREVO_NETWORK_ERROR");
  }

  // Do not include provider response bodies, recipients or request data in errors.
  if (response.status < 200 || response.status >= 300) throw new Error(`BREVO_HTTP_${response.status}`);
}
