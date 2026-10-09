document.addEventListener("DOMContentLoaded", () => {

    const form = document.getElementById("loginForm");
    const message = document.getElementById("message");

    if (!form) {
        console.error("❌ School Login: loginForm nicht gefunden.");
        return;
    }

    form.addEventListener("submit", async (event) => {

        event.preventDefault();

        const username =
            document.getElementById("username").value.trim();

        const password =
            document.getElementById("password").value;

        message.style.display = "none";
        message.textContent = "";

        try {

            const response = await fetch("/api/school-login", {

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

            if (!response.ok) {

                throw new Error(
                    data.error ||
                    "School Login fehlgeschlagen."
                );

            }

            /*
             * Ganz wichtig:
             * Der Server muss eine School-Session
             * zurückgeben.
             */

            if (data.mode !== "school") {

                throw new Error(
                    "Es wurde keine School-Session erstellt."
                );

            }

            /*
             * Beide Editionen verwenden dieselbe chat.html.
             * chat.html erkennt über /api/me,
             * ob die Session school oder standard ist.
             */

            window.location.href = "/chat.html";

        } catch (error) {

            console.error(
                "❌ School Login Fehler:",
                error
            );

            message.textContent =
                error.message ||
                "Anmeldung fehlgeschlagen.";

            message.style.display = "block";

        }

    });

});