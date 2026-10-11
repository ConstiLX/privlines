const socket = io();

const messages = document.getElementById("messages");
const messageInput = document.getElementById("messageInput");
const sendButton = document.getElementById("sendButton");
const status = document.getElementById("status");

let currentUser = null;
let schoolId = null;


// =====================================================
// SCHUL-ID ERMITTELN
// =====================================================

function getSchoolId() {

    // Variante 1: ?schoolId=1
    const params = new URLSearchParams(window.location.search);
    const querySchoolId = params.get("schoolId");

    if (querySchoolId) {
        return Number(querySchoolId);
    }

    // Variante 2: ?school=1
    const querySchool = params.get("school");

    if (querySchool) {
        return Number(querySchool);
    }

    // Variante 3: letzte Zahl aus der URL
    const match = window.location.pathname.match(/(\d+)$/);

    if (match) {
        return Number(match[1]);
    }

    return null;
}


// =====================================================
// EINGELOGGTEN BENUTZER LADEN
// =====================================================

async function loadUser() {

    try {

        const response = await fetch(
            "/api/me",
            {
                credentials: "include"
            }
        );

        if (!response.ok) {

            window.location.href = "/login.html";

            return false;
        }

        currentUser = await response.json();

        console.log(
            "👤 Eingeloggt als:",
            currentUser.username
        );

        console.log(
            "PrivLines-Modus:",
            currentUser.mode
        );


        // =================================================
        // MODUS SETZEN
        // =================================================

        document.body.classList.remove(
            "standard-mode",
            "school-mode"
        );

        if (currentUser.mode === "school") {

            document.body.classList.add(
                "school-mode"
            );

            console.log(
                "🏫 School Edition aktiviert"
            );

        } else {

            document.body.classList.add(
                "standard-mode"
            );

            console.log(
                "👤 Standard Edition aktiviert"
            );
        }

        return true;

    } catch (error) {

        console.error(
            "❌ Fehler beim Laden des Benutzers:",
            error
        );

        window.location.href = "/login.html";

        return false;
    }
}


// =====================================================
// SCHUL-ID SETZEN
// =====================================================

function initializeSchool() {

    schoolId = getSchoolId();

    console.log(
        "🏫 Schul-ID:",
        schoolId
    );

    if (
        !Number.isInteger(schoolId) ||
        schoolId <= 0
    ) {

        console.error(
            "❌ Keine gültige Schul-ID gefunden."
        );

        return false;
    }

    return true;
}


// =====================================================
// NACHRICHTEN LADEN
// =====================================================

async function loadMessages() {

    if (!schoolId) {
        console.error(
            "❌ Keine Schul-ID zum Laden der Nachrichten."
        );
        return;
    }

    try {

        const response = await fetch(
            `/api/schools/${schoolId}/messages`,
            {
                credentials: "include"
            }
        );

        const data = await response.json();

        if (!response.ok) {

            console.error(
                "❌ Nachrichten konnten nicht geladen werden:",
                data
            );

            return;
        }

        messages.innerHTML = "";

        if (!Array.isArray(data) || data.length === 0) {

            const empty = document.createElement("div");

            empty.className = "empty-chat";
            empty.textContent = "Noch keine Nachrichten.";

            messages.appendChild(empty);

            return;
        }

        data.forEach(
            renderMessage
        );

        messages.scrollTop =
            messages.scrollHeight;

    } catch (error) {

        console.error(
            "❌ Fehler beim Laden der Schulnachrichten:",
            error
        );
    }
}


// =====================================================
// NACHRICHT DARSTELLEN
// =====================================================

function renderMessage(data) {

    if (!data) {
        return;
    }

    const message =
        document.createElement("div");

    message.className = "message";


    // Eigene Nachricht erkennen
    if (
        currentUser &&
        (
            Number(data.sender_id) ===
            Number(currentUser.id)
            ||
            Number(data.senderId) ===
            Number(currentUser.id)
            ||
            data.username ===
            currentUser.username
        )
    ) {

        message.classList.add("mine");
    }


    // Benutzername

    const username =
        document.createElement("div");

    username.className =
        "username";

    username.textContent =
        data.username ||
        "Unbekannt";


    // Nachrichtentext

    const text =
        document.createElement("div");

    text.className =
        "text";

    text.textContent =
        data.message ||
        data.text ||
        "";


    message.appendChild(
        username
    );

    message.appendChild(
        text
    );


    messages.appendChild(
        message
    );
}


// =====================================================
// NACHRICHT SENDEN
// =====================================================

async function sendMessage() {

    const text =
        messageInput.value.trim();

    if (!text) {
        return;
    }

    if (!schoolId) {

        console.error(
            "❌ Keine Schul-ID vorhanden."
        );

        return;
    }

    try {

        sendButton.disabled = true;


        const response =
            await fetch(
                `/api/schools/${schoolId}/messages`,
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    credentials:
                        "include",

                    body:
                        JSON.stringify({
                            message: text
                        })
                }
            );


        const data =
            await response.json();


        if (!response.ok) {

            console.error(
                "❌ Nachricht konnte nicht gesendet werden:",
                data
            );

            return;
        }


        // =============================================
        // EIGENE NACHRICHT SOFORT ANZEIGEN
        // =============================================

        renderMessage(data);


        messages.scrollTop =
            messages.scrollHeight;


        messageInput.value =
            "";

        messageInput.focus();


    } catch (error) {

        console.error(
            "❌ Fehler beim Senden:",
            error
        );

    } finally {

        sendButton.disabled =
            false;
    }
}


// =====================================================
// SOCKET.IO VERBINDUNG
// =====================================================

socket.on(
    "connect",
    () => {

        console.log(
            "🟢 Schulkanal Socket verbunden:",
            socket.id
        );

        if (status) {

            status.textContent =
                "🟢 Verbunden";
        }
    }
);


socket.on(
    "disconnect",
    () => {

        console.log(
            "🔴 Schulkanal Socket getrennt"
        );

        if (status) {

            status.textContent =
                "🔴 Verbindung getrennt";
        }
    }
);


// =====================================================
// NEUE SCHULNACHRICHT EMPFANGEN
// =====================================================

socket.on(
    "chatMessage",
    (data) => {

        console.log(
            "📨 Schulnachricht empfangen:",
            data
        );


        // Nur Nachrichten des aktuellen Schulkanals
        if (
            data.schoolId &&
            Number(data.schoolId) !==
            Number(schoolId)
        ) {

            return;
        }


        // Eigene Nachricht nicht doppelt anzeigen
        if (
            currentUser &&
            (
                data.senderId &&
                Number(data.senderId) ===
                Number(currentUser.id)
            )
        ) {

            return;
        }


        renderMessage({
            username:
                data.username,

            senderId:
                data.senderId,

            text:
                data.text,

            message:
                data.message
        });


        messages.scrollTop =
            messages.scrollHeight;
    }
);


// =====================================================
// SENDEN – BUTTON
// =====================================================

if (sendButton) {

    sendButton.addEventListener(
        "click",
        sendMessage
    );
}


// =====================================================
// SENDEN – ENTER
// =====================================================

if (messageInput) {

    messageInput.addEventListener(
        "keydown",
        (event) => {

            if (
                event.key === "Enter" &&
                !event.shiftKey
            ) {

                event.preventDefault();

                sendMessage();
            }
        }
    );
}


// =====================================================
// START
// =====================================================

async function start() {

    console.log(
        "🏫 PrivLines Schulkanal startet..."
    );


    const loggedIn =
        await loadUser();

    if (!loggedIn) {
        return;
    }


    const schoolReady =
        initializeSchool();

    if (!schoolReady) {

        console.error(
            "❌ Schulkanal konnte nicht gestartet werden."
        );

        return;
    }


    await loadMessages();


    console.log(
        "✅ Schulkanal vollständig geladen."
    );
}


start();