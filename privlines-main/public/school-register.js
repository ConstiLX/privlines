document.addEventListener("DOMContentLoaded", () => {

    const form = document.getElementById("registerForm");
    const message = document.getElementById("message");

    if (!form) {
        console.error("❌ School Registrierung: registerForm nicht gefunden.");
        return;
    }

    form.addEventListener("submit", async (event) => {

        event.preventDefault();

        const username =
            document.getElementById("username").value.trim();

        const password =
            document.getElementById("password").value;

        const passwordConfirm =
            document.getElementById("passwordConfirm").value;

        message.style.display = "none";
        message.textContent = "";

        // Passwörter vergleichen
        if (password !== passwordConfirm) {

            message.textContent =
                "Die Passwörter stimmen nicht überein.";

            message.style.display = "block";

            return;
        }

        // Mindestlänge prüfen
        if (password.length < 8) {

            message.textContent =
                "Das Passwort muss mindestens 8 Zeichen lang sein.";

            message.style.display = "block";

            return;
        }

        // Benutzername prüfen
        if (username.length < 3) {

            message.textContent =
                "Der Benutzername muss mindestens 3 Zeichen lang sein.";

            message.style.display = "block";

            return;
        }

        try {

            const response = await fetch("/api/school-register", {

                method: "POST",

                headers: {
                    "Content-Type": "application/json"
                },

                credentials: "include",

                body: JSON.stringify({
                    username: username,
                    password: password
                })

            });

            const data = await response.json();

            if (!response.ok) {

                throw new Error(
                    data.error ||
                    "Die School Registrierung ist fehlgeschlagen."
                );

            }

            console.log(
                "✅ School Account erfolgreich erstellt."
            );

            // Nach erfolgreicher Registrierung
            window.location.href = "/school-login.html";

        } catch (error) {

            console.error(
                "❌ School Registrierung Fehler:",
                error
            );

            message.textContent =
                error.message ||
                "Die Registrierung ist fehlgeschlagen.";

            message.style.display = "block";

        }

    });

});