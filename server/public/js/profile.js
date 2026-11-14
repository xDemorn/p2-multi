async function changePassword() {
    const value = (id) => document.getElementById(id).value;
    const body = {
        current_password: value("current_password"),
        new_password: value("new_password"),
        confirm_new_password: value("confirm_new_password"),
    };

    try {
        await axios.post("/api/password", body);
    } catch (error) {
        alert(error.response?.data?.error || "No s'ha pogut canviar la contrasenya.");
        return;
    }
    for (const id of ["current_password", "new_password", "confirm_new_password"]) {
        document.getElementById(id).value = "";
    }
    document.getElementById("change-password-dialog").close();
    alert("Contrasenya canviada correctament");
}

async function startTwoFactorSetup() {
    try {
        const { data } = await axios.post("/api/2fa/setup");
        document.getElementById("totp_qr").src = data.qr;
        document.getElementById("totp_secret").textContent = data.secret;
        document.getElementById("totp_setup").hidden = false;
        document.getElementById("totp_start").hidden = true;
        document.getElementById("totp_activate").hidden = false;
    } catch (error) {
        alert(error.response?.data?.error || "No s'ha pogut iniciar la configuració del 2FA.");
    }
}

async function enableTwoFactor() {
    try {
        await axios.post("/api/2fa/enable", { code: document.getElementById("totp_enable_code").value });
    } catch (error) {
        alert(error.response?.data?.error || "No s'ha pogut activar el 2FA.");
        return;
    }
    location.reload();
}

async function disableTwoFactor() {
    try {
        await axios.post("/api/2fa/disable", { code: document.getElementById("totp_disable_code").value });
    } catch (error) {
        alert(error.response?.data?.error || "No s'ha pogut desactivar el 2FA.");
        return;
    }
    location.reload();
}

document.addEventListener("DOMContentLoaded", () => {
    const avatarInput = document.getElementById("data_avatar");
    const avatarPreview = document.querySelector(".profile-avatar-upload-preview");
    const avatarPreviewContainer = document.querySelector(".profile-avatar-upload-preview-container");
    const avatarCancel = document.querySelector(".profile-avatar-cancel");
    const avatarPicker = document.querySelector(".profile-avatar-picker");
    let previewUrl;

    if (!avatarInput || !avatarPreview || !avatarPreviewContainer || !avatarCancel || !avatarPicker) return;

    function previewAvatar(file) {
        if (previewUrl) URL.revokeObjectURL(previewUrl);

        if (!file) {
            avatarPreview.removeAttribute("src");
            avatarPreviewContainer.hidden = true;
            return;
        }

        previewUrl = URL.createObjectURL(file);
        avatarPreview.src = previewUrl;
        avatarPreviewContainer.hidden = false;
    }

    avatarInput.addEventListener("change", () => {
        previewAvatar(avatarInput.files[0]);
    });

    avatarPicker.addEventListener("dragover", (event) => {
        event.preventDefault();
        avatarPicker.classList.add("is-dragging");
    });

    avatarPicker.addEventListener("dragleave", () => {
        avatarPicker.classList.remove("is-dragging");
    });

    avatarPicker.addEventListener("drop", (event) => {
        event.preventDefault();
        avatarPicker.classList.remove("is-dragging");

        const [file] = event.dataTransfer.files;
        if (!file || !file.type.startsWith("image/")) return;

        const files = new DataTransfer();
        files.items.add(file);
        avatarInput.files = files.files;
        previewAvatar(file);
    });

    avatarCancel.addEventListener("click", () => {
        avatarInput.value = "";
        previewAvatar(null);
    });
});

function updateProfile() {
    const nickname = document.getElementById("data_nickname").value;
    const $avatar = document.getElementById("data_avatar");

    const data = new FormData();
    data.append("nickname", nickname);
    if ($avatar.files[0]) data.append("avatar", $avatar.files[0]);

    console.log(data)

    axios.put("/api/profile", data).then(res => {
        console.log(res);
    }).catch(err => {
        console.log(err);
    });
}