document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("reset-form");
    const password = document.getElementById("new_password");
    const confirmPassword = document.getElementById("confirm_new_password");
    const button = document.querySelector('[form="reset-form"]');
    const feedback = document.querySelector(".auth-feedback");
    let token = new URLSearchParams(location.hash.slice(1)).get("reset-password") || "";

    // The token stays in memory: no history entry and no persistence.
    history.replaceState(null, "", location.pathname + location.search);

    if (!/^[a-f0-9]{64}$/.test(token)) {
        token = "";
        form.hidden = true;
        button.hidden = true;
        feedback.textContent = "L'enllaç no és vàlid o ha caducat. Sol·licita'n un de nou.";
        return;
    }

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (password.value !== confirmPassword.value) {
            feedback.textContent = "Les contrasenyes no coincideixen.";
            confirmPassword.focus();
            return;
        }
        feedback.textContent = "Desant…";
        button.disabled = true;
        try {
            const { data } = await axios.post("/api/reset-password", {
                token,
                password: password.value,
                confirmPassword: confirmPassword.value,
            });
            token = "";
            form.reset();
            form.hidden = true;
            button.hidden = true;
            feedback.textContent = data.message;
        } catch (error) {
            feedback.textContent = error.response?.data?.error || "No s'ha pogut canviar la contrasenya. Torna-ho a provar.";
            button.disabled = false;
        }
    });
});
