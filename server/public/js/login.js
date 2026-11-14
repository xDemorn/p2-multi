// Set by the password step; it only proves the password was correct.
let pendingChallenge = null;

const feedback = () => document.querySelector(".auth-feedback");
const valid = (value) => value !== null && value !== undefined && value.trim() !== "";

function showTwoFactorStep(challenge) {
    pendingChallenge = challenge;
    document.getElementById("two-factor-step").hidden = false;
    document.querySelector(".login-submit .button-label").textContent = "Verificar";
    document.getElementById("totp").focus();
}

document.getElementById("login-form").addEventListener("submit", (event) => {
    event.preventDefault();
    login();
});

function verifyTwoFactor(code, $feedback) {
    axios.post("/api/login/2fa", { challenge: pendingChallenge, code: code }).then(() => {
        location.href = "/";
    }).catch(err => {
        const data = err.response?.data;
        if (data?.redirect) {
            location.href = data.redirect;
        } else if (err.response?.status === 401) {
            // The challenge expired or was already used: start over with the password.
            location.reload();
        } else {
            $feedback.textContent = data?.error || "No s'ha pogut verificar el codi. Torna-ho a provar.";
        }
    });
}

function login() {
    const username = document.getElementById("login_username").value;
    const password = document.getElementById("login_password").value;
    const $feedback = feedback();
    $feedback.textContent = "";

    if (pendingChallenge) {
        const code = document.getElementById("totp").value;
        if (!/^\d{6}$/.test(code.trim())) {
            $feedback.textContent = "El codi ha de tenir 6 dígits.";
            return;
        }
        verifyTwoFactor(code, $feedback);
        return;
    }

    if (!valid(username) || !valid(password)) {
        $feedback.textContent = "Si us plau, ompliu tots els camps.";
        return;
    }

    axios.post("/api/login", { username: username, password: password }).then(({ data }) => {
        if (data.requires2fa) {
            showTwoFactorStep(data.challenge);
            $feedback.textContent = "Falta el codi de verificació.";
        } else if (data.redirect) {
            location.href = data.redirect;
        } else {
            location.href = "/";
        }
    }).catch(err => {
        const data = err.response?.data;
        if (data?.redirect) {
            location.href = data.redirect;
        } else if (err.response?.status === 401) {
            $feedback.textContent = "Nom d'usuari o contrasenya incorrectes.";
        } else if (err.response) {
            $feedback.textContent = "No s'ha pogut iniciar sessió. Torna-ho a provar.";
        } else {
            $feedback.textContent = "No s'ha pogut connectar amb el servidor. Torna-ho a provar.";
        }
    });
}
