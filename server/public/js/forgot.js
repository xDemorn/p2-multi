document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("forgot-form");
    const email = document.getElementById("forgot_email");
    const button = document.querySelector('[form="forgot-form"]');
    const feedback = document.querySelector(".auth-feedback");

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        feedback.textContent = "Enviant…";
        button.disabled = true;
        try {
            const { data } = await axios.post("/api/forgot-password", { email: email.value.trim() });
            feedback.textContent = data.message;
        } catch (error) {
            feedback.textContent = error.response?.data?.error || "No s'ha pogut connectar amb el servidor. Torna-ho a provar.";
        } finally {
            button.disabled = false;
        }
    });
});
