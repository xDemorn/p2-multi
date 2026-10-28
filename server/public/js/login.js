function login() {
    const valid = (value) => value !== null && value !== undefined && value.trim() !== "";

    const username = document.getElementById("login_username").value;
    const password = document.getElementById("login_password").value;
    const $feedback = document.querySelector(".auth-feedback");

    if (!valid(username) || !valid(password)) {
        $feedback.textContent = "Si us plau, ompliu tots els camps.";
        return;
    }

    fetch("/api/login", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            username: username,
            password: password
        })
    }).then(res => res.json()).then(res => {
        console.log(res)

        location.href = "/";
    }).catch(err => {
        console.log(err);
    });
}