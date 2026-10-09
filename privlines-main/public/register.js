const form = document.getElementById("registerForm");
const message = document.getElementById("message");

form.addEventListener("submit", async (event) => {
event.preventDefault();

const username = document.getElementById("username").value.trim();
const password = document.getElementById("password").value;

try {
    const response = await fetch("/api/register", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            username: username,
            password: password
        })
    });

    const data = await response.json();

    if (response.ok) {
    message.textContent = "✅ Registrierung erfolgreich!";

    setTimeout(() => {
        window.location.href = "/login.html";
    }, 800); 
    
    } else {
        message.textContent = "❌ " + data.error;
    }

} catch (error) {
    console.error("Registrierungsfehler:", error);
    message.textContent = "❌ Server nicht erreichbar.";
}

});