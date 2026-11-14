// Afegeix aquí el teu codi JavaScript
// Afegeix aquí el teu codi JavaScript

function calcularEdad(fechaNacimiento) {
    if (!fechaNacimiento) return null;

    const [anio, mes, dia] = fechaNacimiento.split('-').map(Number);
    const nacimiento = new Date(anio, mes - 1, dia);
    const hoy = new Date();
    let edad = hoy.getFullYear() - nacimiento.getFullYear();

    if (
        hoy.getMonth() < nacimiento.getMonth() ||
        (hoy.getMonth() === nacimiento.getMonth() && hoy.getDate() < nacimiento.getDate())
    ) {
        edad--;
    }

    return edad;
}

function animarBotonYEnviar(form, button, actionName) {
    const inputHidden = document.createElement('input');
    inputHidden.type = 'hidden';
    inputHidden.name = actionName;
    inputHidden.value = '1';
    form.appendChild(inputHidden);

    const animatedElement = button.querySelector('.cat-runner') || button;
    button.disabled = true;
    animatedElement.addEventListener('animationend', () => form.submit(), { once: true });
    button.classList.add('cat-running');
}

function animarBoton(button) {
    const animatedElement = button.querySelector('.cat-runner') || button;
    const finished = new Promise((resolve) => {
        animatedElement.addEventListener('animationend', resolve, { once: true });
        setTimeout(resolve, 1200); // fallback si les animacions estan desactivades
    });
    button.disabled = true;
    button.classList.add('cat-running');
    return finished;
}

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.home-action').forEach((link) => {
        link.addEventListener('click', (event) => {
            event.preventDefault();
            const cat = link.querySelector('.home-cat');
            cat.addEventListener('animationend', () => {
                window.location.assign(link.href);
            }, { once: true });
            link.classList.add('home-action-running');
        });
    });

    const deleteForm = document.getElementById('delete-form');
    if (deleteForm) {
        const deleteButton = deleteForm.querySelector('[name="delete"]');
        const feedback = document.querySelector('.auth-feedback');
        deleteForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            feedback.textContent = '';
            deleteButton.disabled = true;
            try {
                await axios.post('/api/delete', new URLSearchParams(new FormData(deleteForm)));
                window.location.assign('/');
            } catch (error) {
                feedback.textContent = error.response?.data?.error || 'No s\'ha pogut eliminar el compte.';
                deleteButton.disabled = false;
            }
        });
        return;
    }

    const registerButton = document.querySelector('[name="register"]');
    const loginButton = document.querySelector('[name="login"]');

    if (loginButton && !registerButton) {
        const loginForm = loginButton.form;
        loginForm.addEventListener('submit', (event) => {
            event.preventDefault();
            animarBotonYEnviar(loginForm, loginButton, 'login');
        });
        return;
    }

    if (!registerButton) return;
    const form = registerButton.closest('form');

    const minimumPasswordLength = 12;
    const minimumAge = 16;
    const passwordInput = form.querySelector('input[name="user_password"]');
    const confirmPasswordInput = document.getElementById('confirm_password');
    const passwordMatchResult = document.getElementById('password-match-result');
    const birthDateInput = document.getElementById('birthdate');
    const ageResult = document.getElementById('age-result');
    const passwordCount = document.getElementById('password-count');
    const passwordProgress = document.getElementById('password-progress');

    function updatePasswordLength() {
        const characterCount = [...passwordInput.value].length;
        passwordCount.textContent = `${characterCount} caràcters (mínim ${minimumPasswordLength})`;
        passwordProgress.value = Math.min(characterCount, minimumPasswordLength);
    }

    passwordInput.addEventListener('input', updatePasswordLength);
    updatePasswordLength();

    function updatePasswordMatch() {
        if (confirmPasswordInput.value === '') {
            passwordMatchResult.textContent = '';
        } else if (passwordInput.value === confirmPasswordInput.value) {
            passwordMatchResult.textContent = 'Les contrasenyes coincideixen.';
        } else {
            passwordMatchResult.textContent = 'Les contrasenyes no coincideixen.';
        }
    }

    passwordInput.addEventListener('input', updatePasswordMatch);
    confirmPasswordInput.addEventListener('input', updatePasswordMatch);

    birthDateInput.addEventListener('change', () => {
        const age = calcularEdad(birthDateInput.value);

        if (age === null) {
            ageResult.textContent = '';
        } else if (age >= minimumAge) {
            ageResult.textContent = `Tens ${age} anys; compleixes l'edat mínima.`;
        } else {
            ageResult.textContent = `Has de tenir com a mínim ${minimumAge} anys.`;
        }
    });

    form.addEventListener('submit', async (event) => {
        const password = passwordInput.value;

        event.preventDefault();

        if (password !== confirmPasswordInput.value) {
            updatePasswordMatch();
            alert('Les contrasenyes no coincideixen.');
            confirmPasswordInput.focus();
            return;
        }

        const age = calcularEdad(birthDateInput.value);
        if (age === null || age < minimumAge) {
            ageResult.textContent = `Has de tenir com a mínim ${minimumAge} anys.`;
            birthDateInput.focus();
            return;
        }

        if ([...password].length < minimumPasswordLength) {
            alert(`La contrasenya ha de tenir com a mínim ${minimumPasswordLength} caràcters`);
            return;
        }

        await animarBoton(registerButton);

        const feedback = document.querySelector('.auth-feedback');
        feedback.textContent = '';
        try {
            await axios.post(form.action, new URLSearchParams(new FormData(form)));
            window.location.assign('/');
        } catch (err) {
            feedback.textContent = err.response?.data?.error || 'No s\'ha pogut crear el compte.';
            registerButton.disabled = false;
            registerButton.classList.remove('cat-running');
        }
    });
});

function logout() {
    axios.post("/api/logout").then(() => {
        window.location.reload();
    }).catch(err => {
        console.log(err);
    });
}
