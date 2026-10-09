document.addEventListener("DOMContentLoaded", () => {

    const form = document.getElementById("loginForm");
    const message = document.getElementById("message");

    if (!form) {
        console.error("❌ Login: loginForm nicht gefunden.");
        return;
    }

    form.addEventListener("submit", async (event) => {

        event.preventDefault();

        const username = document
            .getElementById("username")
            .value
            .trim();

        const password = document
            .getElementById("password")
            .value;

        // Alte Fehlermeldung ausblenden
        message.style.display = "none";
        message.textContent = "";

        try {

            const response = await fetch("/api/login", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                credentials: "include",
                body: JSON.stringify({
                    username,
                    password
                })
            });

            const data = await response.json();

            // Login fehlgeschlagen
            if (!response.ok) {

                message.textContent =
                    data.error || "Benutzername oder Passwort ist falsch.";

                message.style.display = "block";

                return;
            }

            // Sicherheitsprüfung
            if (data.mode && data.mode !== "standard") {

                message.textContent =
                    "Ungültige Anmeldung.";

                message.style.display = "block";

                return;
            }

            // Erfolgreich eingeloggt
            window.location.href = "/chat.html";

        } catch (error) {

            console.error("❌ Login Fehler:", error);

            message.textContent =
                "Verbindung zum Server fehlgeschlagen.";

            message.style.display = "block";
        }

    });

});