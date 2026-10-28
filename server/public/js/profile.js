function changePassword() {
    console.log("Changing password...");
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

    fetch("/api/profile", { method: "PUT", body: data }).then(res => res.json()).then(res => {
        console.log(res);
    }).catch(err => {
        console.log(err);
    });
}