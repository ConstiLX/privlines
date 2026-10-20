"use strict";

const socket = io();

window.messengerSocket = socket;

/* ======================================================
   MEDIEN / SPRACHAUFNAHME
   ====================================================== */

let mediaRecorder = null;
let recordingStream = null;
let recordedChunks = [];


/* ======================================================
   LOADING SCREEN
   ====================================================== */

/*
 * Der Loading-Screen wird von chat.html gesteuert.
 * chat2.js startet deshalb keinen eigenen Loading-Timer.
 *
 * Dadurch entsteht kein ReferenceError wie
 * "loadingPercent is not defined".
 */


/* ======================================================
   ELEMENTE
   ====================================================== */

const myUsername =
    document.getElementById("myUsername");

const status =
    document.getElementById("status");

const usernameInput =
    document.getElementById("usernameInput");

const searchButton =
    document.getElementById("searchButton");

const searchResult =
    document.getElementById("searchResult");

const searchTabButton =
    document.getElementById("searchTabButton");

const allUsersTabButton =
    document.getElementById("allUsersTabButton");

const requestsList =
    document.getElementById("requestsList");

const requestBadge =
    document.getElementById("requestBadge");

const friendsList =
    document.getElementById("friendsList");

const messages =
    document.getElementById("messages");

const messageInput =
    document.getElementById("messageInput");

const sendButton =
    document.getElementById("sendButton");

const photoButton =
    document.getElementById("photoButton");

const photoInput =
    document.getElementById("photoInput");

const chatPartner =
    document.getElementById("chatPartner");

const chatAvatar =
    document.getElementById("chatAvatar");

const notification =
    document.getElementById("notification");

const notificationTitle =
    document.getElementById("notificationTitle");

const notificationText =
    document.getElementById("notificationText");

const logoutButton =
    document.getElementById("logoutButton");

const deleteAccountButton =
    document.getElementById("deleteAccountButton");

const myProfileButton =
    document.getElementById("myProfileButton");

const myProfileAvatar =
    document.getElementById("myProfileAvatar");

const profileMenu =
    document.getElementById("profileMenu");

const profileMenuAvatar =
    document.getElementById("profileMenuAvatar");

const profileMenuName =
    document.getElementById("profileMenuName");

const changeOwnProfileButton =
    document.getElementById("changeOwnProfileButton");

const profilePictureInput =
    document.getElementById("profilePictureInput");

const chat =
    document.getElementById("chat");

const sidebar =
    document.querySelector(".sidebar");

const mobileBackButton =
    document.getElementById("mobileBackButton");


/* ======================================================
   CHAT-MENÜ
   ====================================================== */

const voiceButton =
    document.getElementById("voiceButton");

const recordingLabel =
    document.getElementById("recordingLabel");

const chatMenuButton =
    document.getElementById("chatMenuButton");

const featureMenu =
    document.getElementById("featureMenu");

const unfriendButton =
    document.getElementById("unfriendButton");

const blockButton =
    document.getElementById("blockButton");


/* ======================================================
   VARIABLEN
   ====================================================== */

let currentUser = null;
let currentChatId = null;
let currentPartner = null;

window.currentPartner = null;

let friends = [];
let unreadMessages = {};
let notificationTimer = null;


/* ======================================================
   SICHERES JSON
   ====================================================== */

async function readJsonResponse(response) {

    const contentType =
        response.headers.get("content-type") || "";

    if (!contentType.includes("application/json")) {

        const text =
            await response.text();

        console.error(
            "Server hat kein JSON zurückgegeben:",
            text.substring(0, 500)
        );

        throw new Error(
            response.status === 404
                ? "Die angeforderte Server-Funktion wurde nicht gefunden."
                : "Der Server hat keine gültige JSON-Antwort zurückgegeben."
        );
    }

    return await response.json();
}


/* ======================================================
   AKTUELLEN BENUTZER LADEN
   ====================================================== */

async function loadCurrentUser() {

    try {

        const response =
            await fetch("/api/me", {
                credentials: "include"
            });

        if (!response.ok) {

            window.location.replace("/login.html");
            return false;
        }

        currentUser =
            await readJsonResponse(response);

        window.privLinesUser = currentUser;

        if (myUsername) {

            myUsername.textContent =
                (currentUser.displayName || currentUser.username);
        }

        setAvatarImage(
            myProfileAvatar,
            currentUser.profilePicture || null,
            currentUser.username
        );

        setAvatarImage(
            profileMenuAvatar,
            currentUser.profilePicture || null,
            currentUser.username
        );

        if (profileMenuName) {

            profileMenuName.textContent =
                currentUser.displayName || currentUser.username;
        }

        return true;

    } catch (error) {

        console.error(
            "Benutzer konnte nicht geladen werden:",
            error
        );

        window.location.replace("/login.html");
        return false;
    }
}


/* ======================================================
   LOGOUT
   ====================================================== */

async function logout() {

    if (!logoutButton) {
        return;
    }

    logoutButton.disabled = true;
    logoutButton.textContent = "Abmelden...";

    try {

        const response =
            await fetch("/api/logout", {
                method: "POST",
                credentials: "include"
            });

        if (!response.ok) {

            let data = {};

            try {
                data =
                    await readJsonResponse(response);
            } catch {}

            throw new Error(
                data.error ||
                "Logout fehlgeschlagen."
            );
        }

        stopChatLiveUpdates();
        currentUser = null;
        currentChatId = null;
        currentPartner = null;

        window.currentPartner = null;

        socket.disconnect();

        window.location.replace("/login.html");

    } catch (error) {

        console.error(
            "Logout-Fehler:",
            error
        );

        showNotification(
            "Abmelden",
            "Abmelden fehlgeschlagen. Bitte versuche es erneut."
        );

        logoutButton.disabled = false;
        logoutButton.textContent = "Abmelden";
    }
}



async function deleteAccount() {
    const confirmation = window.prompt('Account löschen? Gib zur Bestätigung LÖSCHEN ein.');
    if (confirmation !== "LÖSCHEN") return;
    if (!window.confirm("Wirklich löschen? Dein Account und deine PrivLines-Daten werden dauerhaft entfernt.")) return;
    try {
        deleteAccountButton && (deleteAccountButton.disabled = true);
        const response = await fetch("/api/account", {
            method:"DELETE", credentials:"include",
            headers:{"Content-Type":"application/json"},
            body:JSON.stringify({confirm:"LÖSCHEN"})
        });
        const data = await readJsonResponse(response);
        if (!response.ok) throw new Error(data.error || "Account konnte nicht gelöscht werden.");
        socket.disconnect();
        window.location.replace("/login.html");
    } catch (error) {
        console.error("Account-Löschung:", error);
        showNotification("Account löschen", error.message || "Account konnte nicht gelöscht werden.");
        if (deleteAccountButton) deleteAccountButton.disabled = false;
    }
}

/* ======================================================
   FREUNDE
   ====================================================== */

async function loadFriends() {

    try {

        const response =
            await fetch("/api/friends", {
                credentials: "include"
            });

        if (!response.ok) {
            return;
        }

        friends =
            await readJsonResponse(response);

        if (!Array.isArray(friends)) {
            friends = [];
        }

        renderFriends();

    } catch (error) {

        console.error(
            "Freunde konnten nicht geladen werden:",
            error
        );
    }
}


function renderFriends() {

    if (!friendsList) {
        return;
    }

    friendsList.innerHTML = "";

    if (!friends.length) {

        friendsList.innerHTML = `
            <div class="empty-list">
                Noch keine Freunde.
            </div>
        `;

        return;
    }

    friends.forEach(friend => {

        const element =
            document.createElement("div");

        element.className = "friend";

        if (
            currentPartner &&
            Number(currentPartner.userId) ===
            Number(friend.userId)
        ) {

            element.classList.add("active");
        }

        const avatar =
            document.createElement("div");

        avatar.className = "avatar";

        setAvatarImage(
            avatar,
            friend.profilePicture || null,
            (friend.displayName || friend.username)
        );

        const info =
            document.createElement("div");

        info.className = "friend-info";

        const name =
            document.createElement("div");

        name.className = "friend-name";
        name.textContent =
            friend.displayName || friend.username || "Unbekannt";

        const sub =
            document.createElement("div");

        sub.className = "friend-status";
        sub.textContent = friend.username ? `@${friend.username}` : "Freund";

        info.append(
            name,
            sub
        );

        element.append(
            avatar,
            info
        );

        const unread =
            unreadMessages[friend.userId] || 0;

        if (unread > 0) {

            const badge =
                document.createElement("div");

            badge.className = "unread-badge";

            badge.textContent =
                unread > 99
                    ? "99+"
                    : unread;

            element.appendChild(
                badge
            );
        }

        /*
         * WICHTIG:
         * openChat() ist jetzt tatsächlich definiert.
         */
        element.addEventListener(
            "click",
            () => openChat(friend)
        );

        friendsList.appendChild(
            element
        );
    });
}


/* ======================================================
   CHAT ÖFFNEN
   ====================================================== */

async function openChat(friend) {

    if (
        !friend ||
        !friend.userId
    ) {
        console.warn(
            "openChat: Ungültiger Freund:",
            friend
        );
        return;
    }

    /*
     * Alten Chat verlassen
     */
    if (
        currentChatId &&
        Number(currentChatId) !== 0
    ) {

        try {

            socket.emit(
                "leaveChat",
                Number(currentChatId)
            );

        } catch (error) {

            console.warn(
                "Alter Chat konnte nicht verlassen werden:",
                error
            );
        }
    }

    /*
     * Aktuellen Partner setzen
     */
    currentPartner = {
        ...friend
    };

    window.currentPartner =
        currentPartner;

    currentChatId = null;

    /*
     * Aktiven Freund markieren
     */
    renderFriends();

    /*
     * Chat-Kopf
     */
    if (chatPartner) {

        chatPartner.textContent =
            friend.displayName || friend.username ||
            "Unbekannt";
    }

    setAvatarImage(
        chatAvatar,
        friend.profilePicture || null,
        friend.username
    );

    /*
     * Nachrichten leeren
     */
    if (messages) {

        messages.innerHTML = `
            <div class="empty-chat">
                Chat wird geladen...
            </div>
        `;
    }

    /*
     * Eingabe zunächst deaktivieren
     */
    if (messageInput) {
        messageInput.disabled = true;
    }

    if (sendButton) {
        sendButton.disabled = true;
    }

    if (photoButton) {
        photoButton.disabled = true;
    }

    if (voiceButton) {
        voiceButton.disabled = true;
    }

    /*
     * Ungelesene Nachrichten zurücksetzen
     */
    unreadMessages[friend.userId] = 0;

    try {

        /*
         * --------------------------------------------------
         * CHATS LADEN
         * --------------------------------------------------
         */

        const response =
            await fetch(
                "/api/chats",
                {
                    credentials: "include",
                    cache: "no-store"
                }
            );

        const chats =
            await readJsonResponse(response);

        if (!response.ok) {

            throw new Error(
                chats.error ||
                "Chats konnten nicht geladen werden."
            );
        }

        const chatList =
            Array.isArray(chats)
                ? chats
                : Array.isArray(chats.chats)
                    ? chats.chats
                    : [];

        /*
         * --------------------------------------------------
         * EXISTIERENDEN CHAT SUCHEN
         *
         * Unterstützt mehrere mögliche Feldnamen,
         * damit die Funktion nicht unnötig von der
         * genauen Server-Antwort abhängig ist.
         * --------------------------------------------------
         */

        const friendId =
            Number(friend.userId);

        let existingChat = null;

        for (const chatItem of chatList) {

            if (!chatItem) {
                continue;
            }

            const possibleIds = [

                chatItem.userId,
                chatItem.partnerId,
                chatItem.otherUserId,
                chatItem.friendId,
                chatItem.user_id,
                chatItem.partner_id,
                chatItem.other_user_id,
                chatItem.friend_id,
                chatItem.receiver_id,
                chatItem.sender_id

            ];

            const found =
                possibleIds.some(
                    id =>
                        id != null &&
                        Number(id) === friendId
                );

            if (found) {

                existingChat =
                    chatItem;

                break;
            }
        }

        /*
         * --------------------------------------------------
         * CHAT-ID AUS BESTEHENDEM CHAT
         * --------------------------------------------------
         */

        if (existingChat) {

            const possibleChatIds = [

                existingChat.id,
                existingChat.chatId,
                existingChat.chat_id

            ];

            for (
                const possibleId
                of possibleChatIds
            ) {

                if (
                    possibleId != null &&
                    Number(possibleId) > 0
                ) {

                    currentChatId =
                        Number(possibleId);

                    break;
                }
            }
        }

        /*
         * --------------------------------------------------
         * FALLS NOCH KEIN CHAT EXISTIERT:
         * CHAT ERSTELLEN
         * --------------------------------------------------
         */

        if (!currentChatId) {

            const createResponse =
                await fetch(
                    "/api/chats",
                    {
                        method: "POST",
                        credentials: "include",
                        headers: {
                            "Content-Type":
                                "application/json"
                        },
                        body: JSON.stringify({
                            userId: friendId
                        })
                    }
                );

            const createdChat =
                await readJsonResponse(
                    createResponse
                );

            if (!createResponse.ok) {

                throw new Error(
                    createdChat.error ||
                    "Chat konnte nicht erstellt werden."
                );
            }

            const possibleChatIds = [

                createdChat.id,
                createdChat.chatId,
                createdChat.chat_id

            ];

            for (
                const possibleId
                of possibleChatIds
            ) {

                if (
                    possibleId != null &&
                    Number(possibleId) > 0
                ) {

                    currentChatId =
                        Number(possibleId);

                    break;
                }
            }
        }

        /*
         * --------------------------------------------------
         * GÜLTIGE CHAT-ID PRÜFEN
         * --------------------------------------------------
         */

        if (!currentChatId) {

            console.error(
                "Keine Chat-ID erhalten. Serverantwort:",
                {
                    chats: chatList,
                    existingChat,
                    friend,
                }
            );

            throw new Error(
                "Keine gültige Chat-ID erhalten."
            );
        }

        /*
         * --------------------------------------------------
         * CHAT BEITRETEN
         * --------------------------------------------------
         */

        socket.emit(
            "joinChat",
            Number(currentChatId)
        );

        /*
         * --------------------------------------------------
         * NACHRICHTEN LADEN
         * --------------------------------------------------
         */

        await loadMessages(
            currentChatId
        );

        /* Live-Update für genau diesen Chat starten. */
        startChatLiveUpdates();

        /*
         * --------------------------------------------------
         * BLOCKSTATUS
         * --------------------------------------------------
         */

        await loadBlockStatus();

        /*
         * --------------------------------------------------
         * EINGABEFELDER AKTIVIEREN
         * --------------------------------------------------
         */

        if (messageInput) {
            messageInput.disabled = false;
        }

        if (sendButton) {
            sendButton.disabled = false;
        }

        if (photoButton) {
            photoButton.disabled = false;
        }

        if (voiceButton) {
            voiceButton.disabled = false;
        }

        /*
         * --------------------------------------------------
         * MOBILE
         * --------------------------------------------------
         */

        if (
            window.innerWidth <= 650
        ) {

            sidebar?.classList.add(
                "mobile-hidden"
            );

            chat?.classList.add(
                "mobile-visible"
            );

            document.body.classList.add(
                "mobile-chat-open"
            );
        }


        /*
         * Aktiven Freund erneut anzeigen
         */
        renderFriends();

        console.log(
            "💬 Chat geöffnet:",
            {
                chatId: currentChatId,
                partner: friend.username,
                partnerId: friend.userId
            }
        );

    } catch (error) {

        console.error(
            "❌ Chat konnte nicht geöffnet werden:",
            error
        );

        stopChatLiveUpdates();
        currentChatId = null;

        if (messages) {

            messages.innerHTML = `
                <div class="empty-chat">
                    Chat konnte nicht geöffnet werden.
                </div>
            `;
        }

        if (messageInput) {
            messageInput.disabled = true;
        }

        if (sendButton) {
            sendButton.disabled = true;
        }

        if (photoButton) {
            photoButton.disabled = true;
        }

        if (voiceButton) {
            voiceButton.disabled = true;
        }

        updateBlockButton();

        showNotification(
            "Chat",
            error.message ||
            "Chat konnte nicht geöffnet werden."
        );
    }
}


/* ======================================================
   FREUNDSCHAFTSANFRAGEN
   ====================================================== */

async function loadFriendRequests() {

    try {

        const response =
            await fetch(
                "/api/friend-requests",
                {
                    credentials: "include"
                }
            );

        if (!response.ok) {
            return;
        }

        const requests =
            await readJsonResponse(response);

        renderRequests(
            Array.isArray(requests)
                ? requests
                : []
        );

    } catch (error) {

        console.error(
            "Anfragen konnten nicht geladen werden:",
            error
        );
    }
}


function renderRequests(requests) {

    if (!requestsList) {
        return;
    }

    requestsList.innerHTML = "";

    if (requestBadge) {

        requestBadge.style.display =
            requests.length > 0
                ? "inline-flex"
                : "none";

        requestBadge.textContent =
            requests.length;
    }

    if (!requests.length) {

        requestsList.innerHTML = `
            <div class="empty-list">
                Keine neuen Anfragen
            </div>
        `;

        return;
    }

    requests.forEach(request => {

        const element =
            document.createElement("div");

        element.className =
            "request";

        const name =
            document.createElement("div");

        name.className =
            "request-name";

        name.textContent =
            request.displayName ||
            request.username ||
            "Unbekannt";

        const buttons =
            document.createElement("div");

        buttons.className =
            "request-buttons";

        const accept =
            document.createElement("button");

        accept.className =
            "accept-button";

        accept.type =
            "button";

        accept.textContent =
            "Annehmen";

        const reject =
            document.createElement("button");

        reject.className =
            "reject-button";

        reject.type =
            "button";

        reject.textContent =
            "Ablehnen";

        accept.addEventListener(
            "click",
            () => acceptRequest(request.id)
        );

        reject.addEventListener(
            "click",
            () => rejectRequest(request.id)
        );

        buttons.append(
            accept,
            reject
        );

        element.append(
            name,
            buttons
        );

        requestsList.appendChild(
            element
        );
    });
}


async function acceptRequest(requestId) {

    try {

        const response =
            await fetch(
                `/api/friend-requests/${requestId}/accept`,
                {
                    method: "POST",
                    credentials: "include"
                }
            );

        const data =
            await readJsonResponse(response);

        if (!response.ok) {

            showNotification(
                "Freundschaft",
                data.error ||
                "Anfrage konnte nicht angenommen werden."
            );

            return;
        }

        await loadFriendRequests();
        await loadFriends();

        showNotification(
            "Freundschaft",
            "Die Anfrage wurde angenommen."
        );

    } catch (error) {

        console.error(
            error
        );

        showNotification(
            "Freundschaft",
            error.message ||
            "Fehler beim Annehmen der Anfrage."
        );
    }
}


async function rejectRequest(requestId) {

    try {

        const response =
            await fetch(
                `/api/friend-requests/${requestId}/reject`,
                {
                    method: "POST",
                    credentials: "include"
                }
            );

        const data =
            await readJsonResponse(response);

        if (!response.ok) {

            showNotification(
                "Freundschaft",
                data.error ||
                "Anfrage konnte nicht abgelehnt werden."
            );

            return;
        }

        await loadFriendRequests();

        showNotification(
            "Freundschaft",
            "Die Anfrage wurde abgelehnt."
        );

    } catch (error) {

        console.error(
            error
        );

        showNotification(
            "Freundschaft",
            error.message ||
            "Fehler beim Ablehnen der Anfrage."
        );
    }
}


/* ======================================================
   BENUTZER SUCHEN
   ====================================================== */

async function getFriendshipStatus(userId) {

    try {
        const response = await fetch(
            `/api/friends/${encodeURIComponent(userId)}/status`,
            {
                credentials: "include",
                cache: "no-store"
            }
        );

        const data = await readJsonResponse(response);

        if (!response.ok) {
            return { status: "none" };
        }

        return {
            status: data?.status || "none",
            requestId: data?.requestId || null
        };
    } catch (error) {
        console.error("Freundschaftsstatus konnte nicht geladen werden:", error);
        return { status: "none" };
    }
}


function setFriendSearchButton(button, status, userId, requestId = null) {

    if (!button) return;

    button.dataset.friendStatus = status || "none";
    button.dataset.userId = String(userId);
    button.dataset.requestId = requestId ? String(requestId) : "";
    button.classList.add("friend-action-button");

    if (status === "friends") {
        button.textContent = "✓";
        button.title = "Freund entfernen";
        button.setAttribute("aria-label", button.title);
        button.disabled = false;
        button.onclick = async () => {
            const ok = await showConfirmDialog(
                "Freundschaft beenden",
                "Möchtest du diese Freundschaft wirklich beenden?",
                "Abbrechen",
                "Entfernen"
            );
            if (!ok) return;

            try {
                const response = await fetch(
                    `/api/friends/${encodeURIComponent(userId)}/unfriend`,
                    {
                        method: "POST",
                        credentials: "include"
                    }
                );
                const data = await readJsonResponse(response);
                if (!response.ok) throw new Error(data.error || "Freundschaft konnte nicht entfernt werden.");

                showNotification("Freundschaft", "Freundschaft wurde beendet.");
                await loadFriends();
                await searchUser();
            } catch (error) {
                console.error("Entfreunden-Fehler:", error);
                showNotification("Freundschaft", error.message || "Freundschaft konnte nicht entfernt werden.");
            }
        };
        return;
    }

    if (status === "outgoing") {
        button.textContent = "×";
        button.title = "Freundschaftsanfrage zurücknehmen";
        button.setAttribute("aria-label", button.title);
        button.disabled = false;
        button.onclick = async () => {
            try {
                if (!requestId) {
                    const fresh = await getFriendshipStatus(userId);
                    requestId = fresh.requestId;
                }

                if (!requestId) {
                    throw new Error("Anfrage-ID konnte nicht ermittelt werden.");
                }

                const response = await fetch(
                    `/api/friend-requests/${encodeURIComponent(requestId)}/cancel`,
                    {
                        method: "DELETE",
                        credentials: "include"
                    }
                );
                const data = await readJsonResponse(response);
                if (!response.ok) throw new Error(data.error || "Anfrage konnte nicht zurückgenommen werden.");

                showNotification("Freundschaft", "Freundschaftsanfrage wurde zurückgenommen.");
                await searchUser();
            } catch (error) {
                console.error("Anfrage-zurücknehmen-Fehler:", error);
                showNotification("Freundschaft", error.message || "Anfrage konnte nicht zurückgenommen werden.");
            }
        };
        return;
    }

    if (status === "incoming") {
        button.textContent = "✓";
        button.title = "Freundschaftsanfrage annehmen";
        button.setAttribute("aria-label", button.title);
        button.disabled = false;
        button.onclick = async () => {
            try {
                if (!requestId) {
                    const fresh = await getFriendshipStatus(userId);
                    requestId = fresh.requestId;
                }
                if (!requestId) throw new Error("Anfrage-ID konnte nicht ermittelt werden.");

                const response = await fetch(
                    `/api/friend-requests/${encodeURIComponent(requestId)}/accept`,
                    {
                        method: "POST",
                        credentials: "include"
                    }
                );
                const data = await readJsonResponse(response);
                if (!response.ok) throw new Error(data.error || "Anfrage konnte nicht angenommen werden.");

                showNotification("Freundschaft", "Die Anfrage wurde angenommen.");
                await loadFriendRequests();
                await loadFriends();
                await searchUser();
            } catch (error) {
                console.error("Anfrage-annehmen-Fehler:", error);
                showNotification("Freundschaft", error.message || "Anfrage konnte nicht angenommen werden.");
            }
        };
        return;
    }

    button.textContent = "Adden";
    button.title = "Freundschaftsanfrage senden";
        button.setAttribute("aria-label", button.title);
    button.disabled = false;
    button.onclick = async () => {
        button.disabled = true;
        try {
            await sendFriendRequest(userId);
            await searchUser();
        } finally {
            button.disabled = false;
        }
    };
}


function setUserDirectoryTab(tab) {
    const allUsers = tab === "all";
    searchTabButton?.classList.toggle("active", !allUsers);
    allUsersTabButton?.classList.toggle("active", allUsers);
    searchTabButton?.setAttribute("aria-selected", String(!allUsers));
    allUsersTabButton?.setAttribute("aria-selected", String(allUsers));

    if (allUsers) {
        if (usernameInput) usernameInput.value = "";
        loadAllUsers();
    } else if (searchResult) {
        searchResult.innerHTML = "";
        usernameInput?.focus();
    }
}

function getUserDirectoryEndpoint() {
    return currentUser?.mode === "school"
        ? "/api/school-users"
        : "/api/users";
}

function createAllUserCard(user) {
    const card = document.createElement("div");
    card.className = "all-user-card";

    const avatar = document.createElement("div");
    avatar.className = "all-user-avatar";
    const displayName = user.displayName || user.username || "?";

    if (user.profilePicture) {
        const img = document.createElement("img");
        img.src = user.profilePicture;
        img.alt = "";
        img.loading = "lazy";
        avatar.appendChild(img);
    } else {
        avatar.textContent = displayName.charAt(0).toUpperCase();
    }

    const info = document.createElement("div");
    info.className = "all-user-info";

    const name = document.createElement("div");
    name.className = "all-user-name";
    name.textContent = displayName;

    const username = document.createElement("div");
    username.className = "all-user-username";
    username.textContent = user.username ? `@${user.username}` : "";

    info.append(name, username);

    const action = document.createElement("div");
    action.className = "all-user-action";

    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "…";
    button.title = "Freundschaftsstatus wird geladen";
    button.setAttribute("aria-label", button.title);
    button.disabled = true;

    action.appendChild(button);
    card.append(avatar, info, action);

    const userId = user.userId ?? user.id;
    if (userId) {
        getFriendshipStatus(userId)
            .then(friendship => {
                setFriendSearchButton(
                    button,
                    friendship.status,
                    userId,
                    friendship.requestId
                );
            })
            .catch(error => {
                console.error("Freundschaftsstatus-Fehler:", error);
                button.disabled = true;
                button.textContent = "Nicht verfügbar";
            });
    }

    return card;
}

async function loadAllUsers() {
    if (!searchResult) return;

    searchResult.innerHTML = `
        <div class="all-users-loading">👥 Nutzer werden geladen …</div>
    `;

    try {
        const response = await fetch(getUserDirectoryEndpoint(), {
            credentials: "include",
            cache: "no-store"
        });
        const data = await readJsonResponse(response);

        if (!response.ok) {
            searchResult.innerHTML = `
                <div class="search-error">
                    ${escapeHtml(data.error || "Nutzer konnten nicht geladen werden.")}
                </div>
            `;
            return;
        }

        const users = Array.isArray(data.users) ? data.users : [];

        if (users.length === 0) {
            searchResult.innerHTML = `
                <div class="all-users-empty">Keine Nutzer in deiner Altersgruppe gefunden.</div>
            `;
            return;
        }

        const list = document.createElement("div");
        list.className = "all-users-list";
        users.forEach(user => list.appendChild(createAllUserCard(user)));

        searchResult.replaceChildren(list);
    } catch (error) {
        console.error("Alle-Nutzer-Ladefehler:", error);
        searchResult.innerHTML = `
            <div class="search-error">
                ${escapeHtml(error.message || "Nutzer konnten nicht geladen werden.")}
            </div>
        `;
    }
}


async function searchUser() {

    if (!usernameInput || !searchResult) return;

    const username = usernameInput.value.trim();

    if (!username) {
        searchResult.innerHTML = `
            <div class="search-error">
                Bitte einen Benutzernamen eingeben.
            </div>
        `;
        return;
    }

    try {
        const isSchoolMode = currentUser && currentUser.mode === "school";
        const endpoint = isSchoolMode
            ? `/api/school-users/${encodeURIComponent(username)}`
            : `/api/users/${encodeURIComponent(username)}`;

        console.log(
            "🔎 Benutzersuche:",
            isSchoolMode ? "School Edition" : "Standard Edition",
            endpoint
        );

        const response = await fetch(endpoint, {
            credentials: "include",
            cache: "no-store"
        });

        const data = await readJsonResponse(response);

        if (!response.ok) {
            searchResult.innerHTML = `
                <div class="search-error">
                    ${escapeHtml(data.error || "Benutzer nicht gefunden.")}
                </div>
            `;
            return;
        }

        const targetUserId =
            data.userId ??
            data.id ??
            data.receiverId ??
            data.targetUserId ??
            data.targetId ??
            data.friendId;

        if (!targetUserId) {
            searchResult.innerHTML = `
                <div class="search-error">
                    Der Server hat keine gültige Benutzer-ID geliefert.
                </div>
            `;
            return;
        }

        searchResult.innerHTML = "";

        const result = document.createElement("div");
        result.className = "all-user-card search-result";

        const displayName = data.displayName || data.username || "?";
        const avatar = document.createElement("div");
        avatar.className = "all-user-avatar";
        if (data.profilePicture) {
            const image = document.createElement("img");
            image.src = data.profilePicture;
            image.alt = "";
            image.loading = "lazy";
            avatar.appendChild(image);
        } else {
            avatar.textContent = displayName.charAt(0).toUpperCase();
        }

        const info = document.createElement("div");
        info.className = "all-user-info";

        const name = document.createElement("div");
        name.className = "all-user-name";
        name.textContent = displayName;

        const usernameLabel = document.createElement("div");
        usernameLabel.className = "all-user-username";
        usernameLabel.textContent = data.username ? "@" + data.username : "";
        info.append(name, usernameLabel);

        const action = document.createElement("div");
        action.className = "all-user-action";

        const button = document.createElement("button");
        button.type = "button";
        button.className = "friend-action-button";
        button.textContent = "…";
        button.title = "Freundschaftsstatus wird geladen";
        button.setAttribute("aria-label", button.title);
        button.disabled = true;

        action.appendChild(button);
        result.append(avatar, info, action);
        searchResult.appendChild(result);

        const friendship = await getFriendshipStatus(targetUserId);
        setFriendSearchButton(
            button,
            friendship.status,
            targetUserId,
            friendship.requestId
        );

    } catch (error) {
        console.error("Benutzersuche-Fehler:", error);
        searchResult.innerHTML = `
            <div class="search-error">
                ${escapeHtml(error.message || "Fehler bei der Suche.")}
            </div>
        `;
        showNotification(
            "Suche",
            error.message || "Bei der Benutzersuche ist ein Fehler aufgetreten."
        );
    }
}


/* ======================================================
   FREUNDSCHAFTSANFRAGE SENDEN
   ====================================================== */

async function sendFriendRequest(userId) {

    if (!userId) return;

    try {
        const response = await fetch(
            "/api/friend-requests",
            {
                method: "POST",
                credentials: "include",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    userId,
                    targetMode: currentUser?.mode || "standard"
                })
            }
        );

        const data = await readJsonResponse(response);

        if (!response.ok) {
            throw new Error(
                data.error ||
                "Freundschaftsanfrage konnte nicht gesendet werden."
            );
        }

        showNotification(
            "Freundschaft",
            "Freundschaftsanfrage wurde gesendet."
        );

    } catch (error) {
        console.error("Freundschaftsanfrage-Fehler:", error);
        showNotification(
            "Freundschaft",
            error.message || "Freundschaftsanfrage konnte nicht gesendet werden."
        );
        throw error;
    }
}


/* ======================================================
   BLOCKSTATUS LADEN
   ====================================================== */

async function loadBlockStatus() {

    if (
        !currentPartner ||
        !currentPartner.userId
    ) {
        return;
    }

    try {

        const partnerId =
            Number(currentPartner.userId);

        const response =
            await fetch(
                `/api/users/${partnerId}/block-status`,
                {
                    credentials: "include"
                }
            );

        const data =
            await readJsonResponse(response);

        if (!response.ok) {
            return;
        }

        currentPartner.blockedByMe =
            Boolean(data.blockedByMe);

        currentPartner.blockedByOther =
            Boolean(data.blockedByOther);

        window.currentPartner =
            currentPartner;

        updateBlockButton();

    } catch (error) {

        console.error(
            "Blockstatus konnte nicht geladen werden:",
            error
        );
    }
}


/* ======================================================
   BLOCKBUTTON AKTUALISIEREN
   ====================================================== */

function updateBlockButton() {

    if (!blockButton) {
        return;
    }

    if (!currentPartner) {

        blockButton.textContent =
            "Benutzer blockieren";

        blockButton.disabled =
            true;

        blockButton.dataset.action =
            "block";

        return;
    }

    blockButton.disabled =
        false;

    if (currentPartner.blockedByMe) {

        blockButton.textContent =
            "Benutzer entblockieren";

        blockButton.dataset.action =
            "unblock";

        return;
    }

    blockButton.textContent =
        "Benutzer blockieren";

    blockButton.dataset.action =
        "block";
}


/* ======================================================
   NACHRICHTEN LADEN
   ====================================================== */

async function loadMessages(
    chatId
) {

    if (!messages) {
        return;
    }

    try {

        const response =
            await fetch(
                `/api/chats/${chatId}/messages`,
                {
                    credentials: "include",
                    cache: "no-store"
                }
            );

        if (!response.ok) {

            const data =
                await readJsonResponse(response)
                    .catch(() => ({}));

            throw new Error(
                data.error ||
                "Nachrichten konnten nicht geladen werden."
            );
        }

        const oldMessages =
            await readJsonResponse(response);

        const messageList =
            Array.isArray(oldMessages)
                ? oldMessages
                : Array.isArray(oldMessages.messages)
                    ? oldMessages.messages
                    : [];

        /* Aktuellen Stand merken, damit der nächste Poll
           nicht sofort nochmals denselben Chat rendert. */
        chatLiveUpdateSignature =
            createMessageSignature(messageList);

        messages.innerHTML = "";

        if (!messageList.length) {

            messages.innerHTML = `
                <div class="empty-chat">
                    Noch keine Nachrichten.
                </div>
            `;

            return;
        }

        messageList.forEach(
            message => {

                addMessage(
                    message.displayName || message.username,
                    message.message ??
                        message.text ??
                        "",
                    message.message_type ??
                        message.messageType ??
                        "text",
                    message.media_url ??
                        message.mediaUrl ??
                        null,
                    message.id ??
                        message.messageId ??
                        null,
                    Boolean(
                        message.edited_at ??
                        message.editedAt
                    ),
                    message.deliveryStatus ??
                        null,
                    Boolean(
                        message.deleted_at ??
                        message.deletedAt
                    ),
                    message.sender_id ?? message.senderId ?? null
                );

            }
        );

        messages.scrollTop =
            messages.scrollHeight;

    } catch (error) {

        console.error(
            error
        );

        messages.innerHTML = `
            <div class="empty-chat">
                Nachrichten konnten nicht geladen werden.
            </div>
        `;

        showNotification(
            "Nachrichten",
            error.message ||
            "Nachrichten konnten nicht geladen werden."
        );
    }
}



/* ======================================================
   LIVE-UPDATE: PRIVATE CHAT
   ======================================================
   Die Nachrichten werden einmal pro Sekunde vom Server
   abgefragt. Dadurch funktioniert der Chat auch dann,
   wenn Socket.IO keine neue Nachricht liefert.
====================================================== */

let chatLiveUpdateTimer = null;
let chatLiveUpdateBusy = false;
let chatLiveUpdateSignature = "";

function createMessageSignature(messageList) {

    return JSON.stringify(
        (Array.isArray(messageList) ? messageList : []).map(
            message => ({
                id:
                    message.id ??
                    message.messageId ??
                    null,
                text:
                    message.message ??
                    message.text ??
                    "",
                type:
                    message.message_type ??
                    message.messageType ??
                    "text",
                media:
                    message.media_url ??
                    message.mediaUrl ??
                    null,
                edited:
                    message.edited_at ??
                    message.editedAt ??
                    null,
                deleted:
                    message.deleted_at ??
                    message.deletedAt ??
                    false,
                delivery:
                    message.deliveryStatus ??
                    null
            })
        )
    );
}

async function fetchCurrentChatMessageList(chatId) {

    const response = await fetch(
        `/api/chats/${encodeURIComponent(Number(chatId))}/messages`,
        {
            credentials: "include",
            cache: "no-store",
            headers: {
                "Cache-Control": "no-cache"
            }
        }
    );

    if (!response.ok) {
        return null;
    }

    const data = await readJsonResponse(response);

    return Array.isArray(data)
        ? data
        : Array.isArray(data?.messages)
            ? data.messages
            : [];
}

async function refreshCurrentChatEverySecond() {

    if (
        chatLiveUpdateBusy ||
        !currentChatId ||
        !currentUser ||
        !messages
    ) {
        return;
    }

    const chatIdAtStart = Number(currentChatId);

    if (!Number.isFinite(chatIdAtStart) || chatIdAtStart <= 0) {
        return;
    }

    chatLiveUpdateBusy = true;

    try {

        const messageList =
            await fetchCurrentChatMessageList(chatIdAtStart);

        /* Während des Requests wurde eventuell ein anderer Chat geöffnet. */
        if (
            Number(currentChatId) !==
            chatIdAtStart
        ) {
            return;
        }

        if (!messageList) {
            return;
        }

        const signature =
            createMessageSignature(messageList);

        /* Nur neu rendern, wenn sich wirklich etwas geändert hat. */
        if (
            signature !==
            chatLiveUpdateSignature
        ) {

            chatLiveUpdateSignature = signature;

            await loadMessages(chatIdAtStart);
        }

    } catch (error) {

        console.warn(
            "⚠️ Automatisches Nachrichten-Update fehlgeschlagen:",
            error
        );

    } finally {

        chatLiveUpdateBusy = false;
    }
}

function startChatLiveUpdates() {

    if (chatLiveUpdateTimer) {
        clearInterval(chatLiveUpdateTimer);
    }

    /* Sofort einmal prüfen und danach jede Sekunde. */
    refreshCurrentChatEverySecond();

    chatLiveUpdateTimer =
        setInterval(
            refreshCurrentChatEverySecond,
            1000
        );

    console.log(
        "🔄 Privater Chat-Live-Update gestartet."
    );
}

function stopChatLiveUpdates() {

    if (chatLiveUpdateTimer) {
        clearInterval(chatLiveUpdateTimer);
        chatLiveUpdateTimer = null;
    }

    chatLiveUpdateBusy = false;
    chatLiveUpdateSignature = "";
}

/* ======================================================
   NACHRICHT ANZEIGEN
   ====================================================== */

function addMessage(
    username,
    text,
    messageType = "text",
    mediaUrl = null,
    messageId = null,
    edited = false,
    deliveryStatus = null,
    deleted = false,
    senderId = null
) {

    if (!messages) {
        return null;
    }

    messages
        .querySelector(".empty-chat")
        ?.remove();

    const message =
        document.createElement("div");

    message.className =
        "message";

    if (messageId != null) {

        message.dataset.messageId =
            messageId;
    }

    const mine =
        currentUser &&
        (senderId != null
            ? Number(senderId) === Number(currentUser.userId)
            : username === currentUser.displayName || username === currentUser.username);

    if (mine) {

        message.classList.add(
            "mine"
        );
    }

    const userElement =
        document.createElement("div");

    userElement.className =
        "message-user";

    userElement.textContent =
        username || "Unbekannt";

    message.appendChild(
        userElement
    );

    if (
        deleted ||
        messageType === "deleted"
    ) {

        const element =
            document.createElement("div");

        element.className =
            "message-text deleted-message";

        element.textContent =
            "Nachricht gelöscht";

        message.appendChild(
            element
        );

    } else if (
        messageType === "voice" &&
        mediaUrl
    ) {

        const wrapper =
            document.createElement("div");

        wrapper.className =
            "voice-message";

        const icon =
            document.createElement("span");

        icon.textContent =
            "🎙️";

        const audio =
            document.createElement("audio");

        audio.controls = true;
        audio.preload = "metadata";
        audio.src = mediaUrl;

        wrapper.append(
            icon,
            audio
        );

        message.appendChild(
            wrapper
        );

    } else if (
        messageType === "image" &&
        mediaUrl
    ) {

        const image =
            document.createElement("img");

        image.className =
            "message-image";

        image.src =
            mediaUrl;

        image.alt =
            "Gesendetes Foto";

        image.loading =
            "lazy";

        image.addEventListener(
            "click",
            () =>
                window.open(
                    mediaUrl,
                    "_blank"
                )
        );

        message.appendChild(
            image
        );

    } else if (
        messageType === "video" &&
        mediaUrl
    ) {

        const video =
            document.createElement("video");

        video.className =
            "message-video";

        video.src =
            mediaUrl;

        video.controls = true;
        video.preload = "metadata";
        video.playsInline = true;

        message.appendChild(
            video
        );

    } else {

        const textElement =
            document.createElement("div");

        textElement.className =
            "message-text";

        textElement.textContent =
            text || "";

        message.appendChild(
            textElement
        );

        if (
            deliveryStatus === "blocked"
        ) {

            const statusElement =
                document.createElement("span");

            statusElement.className =
                "message-delivery-status blocked";

            statusElement.title =
                "Nicht zugestellt – Benutzer blockiert";

            statusElement.textContent =
                "●";

            message.appendChild(
                statusElement
            );
        }

        if (edited) {

            const label =
                document.createElement("span");

            label.className =
                "edited-label";

            label.textContent =
                "bearbeitet";

            message.appendChild(
                label
            );
        }
    }


    /* ==================================================
       AKTIONEN
       ================================================== */

    if (
        mine &&
        messageId != null &&
        !deleted &&
        messageType === "text"
    ) {

        const actions =
            document.createElement("div");

        actions.className =
            "message-actions";

        const edit =
            document.createElement("button");

        edit.className =
            "message-action";

        edit.type =
            "button";

        edit.title =
            "Bearbeiten";

        edit.textContent =
            "✏️";

        edit.addEventListener(
            "click",
            () =>
                editMessage(
                    messageId,
                    text || ""
                )
        );

        const del =
            document.createElement("button");

        del.className =
            "message-action";

        del.type =
            "button";

        del.title =
            "Löschen";

        del.textContent =
            "🗑️";

        del.addEventListener(
            "click",
            () =>
                deleteMessage(
                    messageId
                )
        );

        actions.append(
            edit,
            del
        );

        message.appendChild(
            actions
        );

    } else if (
        mine &&
        messageId != null &&
        !deleted
    ) {

        const actions =
            document.createElement("div");

        actions.className =
            "message-actions";

        const del =
            document.createElement("button");

        del.className =
            "message-action";

        del.type =
            "button";

        del.title =
            "Löschen";

        del.textContent =
            "🗑️";

        del.addEventListener(
            "click",
            () =>
                deleteMessage(
                    messageId
                )
        );

        actions.appendChild(
            del
        );

        message.appendChild(
            actions
        );
    }

    messages.appendChild(
        message
    );

    messages.scrollTop =
        messages.scrollHeight;

    return message;
}


/* ======================================================
   NACHRICHT SENDEN
   ====================================================== */

function sendMessage() {


    if (!messageInput) {
        return;
    }

    const text =
        messageInput.value.trim();

    if (
        !text ||
        !currentChatId
    ) {
        return;
    }

    if (!socket.connected) {

        showNotification(
            "Verbindung",
            "Keine Verbindung zum Server."
        );

        return;
    }

    socket.emit(
        "chatMessage",
        {
            chatId:
                Number(currentChatId),
            text
        }
    );

    messageInput.value = "";
    messageInput.focus();
}


/* ======================================================
   FOTO / VIDEO
   ====================================================== */

async function sendPhoto(file) {


    if (
        !file ||
        !currentChatId
    ) {
        return;
    }

    const allowedTypes = [

        "image/jpeg",
        "image/png",
        "image/gif",
        "image/webp",

        "video/mp4",
        "video/webm",
        "video/ogg",
        "video/quicktime"

    ];

    if (
        !allowedTypes.includes(
            file.type
        )
    ) {

        showNotification(
            "Datei",
            "Dieser Dateityp wird nicht unterstützt."
        );

        if (photoInput) {
            photoInput.value = "";
        }

        return;
    }

    if (
        file.size >
        100 * 1024 * 1024
    ) {

        showNotification(
            "Datei",
            "Die Datei darf maximal 100 MB groß sein."
        );

        if (photoInput) {
            photoInput.value = "";
        }

        return;
    }

    const formData =
        new FormData();

    formData.append(
        "media",
        file
    );

    formData.append(
        "chatId",
        currentChatId
    );

    try {

        if (photoButton) {
            photoButton.disabled = true;
        }

        const response =
            await fetch(
                "/api/upload",
                {
                    method: "POST",
                    body: formData,
                    credentials: "include"
                }
            );

        const data =
            await readJsonResponse(response);

        if (!response.ok) {

            throw new Error(
                data.error ||
                "Datei konnte nicht hochgeladen werden."
            );
        }

        if (data.blocked) {

            showNotification(
                "Nachricht gespeichert",
                "Die Datei wurde gespeichert und wird nach dem Entblockieren zugestellt."
            );

        } else {

            showNotification(
                "Datei gesendet",
                "Die Datei wurde erfolgreich gesendet."
            );
        }

    } catch (error) {

        console.error(
            "Datei-Upload-Fehler:",
            error
        );

        showNotification(
            "Datei-Upload",
            error.message ||
            "Datei konnte nicht hochgeladen werden."
        );

    } finally {

        if (photoButton) {

            photoButton.disabled =
                !currentChatId;
        }

        if (photoInput) {
            photoInput.value = "";
        }
    }
}


photoButton?.addEventListener(
    "click",
    () => {

        if (currentChatId) {
            photoInput?.click();
        }

    }
);


photoInput?.addEventListener(
    "change",
    () => {

        const file =
            photoInput.files?.[0];

        if (file) {
            sendPhoto(file);
        }

    }
);


/* ======================================================
   SOCKET: NEUE NACHRICHT
   ====================================================== */

socket.on(
    "chatMessage",
    data => {

        if (
            Number(data.chatId) !==
            Number(currentChatId)
        ) {
            return;
        }

        addMessage(
            data.displayName || data.username,
            data.text,
            data.messageType ||
                "text",
            data.mediaUrl ||
                null,
            data.id ||
                null,
            Boolean(
                data.editedAt
            ),
            null,
            false,
            data.senderId ?? null
        );
    }
);


/* ======================================================
   BROWSER-BENACHRICHTIGUNGEN
   ====================================================== */

function sendBrowserNotification(title, text) {
    try {
        if (typeof window === "undefined" || !("Notification" in window)) {
            return;
        }

        if (Notification.permission !== "granted") {
            return;
        }

        const notification = new Notification(
            String(title || "PrivLines"),
            {
                body: String(text || ""),
                icon: "/logo6.png",
                tag: "privlines-notification"
            }
        );

        notification.onclick = () => {
            try {
                window.focus();
            } catch {}
            notification.close();
        };
    } catch (error) {
        console.warn("Browser-Benachrichtigung konnte nicht angezeigt werden:", error);
    }
}

async function requestNotificationPermission() {
    try {
        if (typeof window === "undefined" || !("Notification" in window)) {
            return "unsupported";
        }

        if (Notification.permission === "default") {
            return await Notification.requestPermission();
        }

        return Notification.permission;
    } catch (error) {
        console.warn("Benachrichtigungsberechtigung konnte nicht angefragt werden:", error);
        return "denied";
    }
}

async function registerBackgroundPush() {
    if (!window.isSecureContext || !("serviceWorker" in navigator) || !("PushManager" in window)) return;
    try {
        if (Notification.permission !== "granted") return;

        const registration = await navigator.serviceWorker.register("/service-worker.js");
        const keyResponse = await fetch("/api/push/public-key", { credentials: "include", cache: "no-store" });
        if (!keyResponse.ok) return;
        const { publicKey } = await keyResponse.json();
        if (!publicKey) return;

        const decodeKey = value => {
            const padded = value.replace(/-/g, "+").replace(/_/g, "/");
            const raw = atob(padded + "=".repeat((4 - padded.length % 4) % 4));
            return Uint8Array.from(raw, character => character.charCodeAt(0));
        };
        let subscription = await registration.pushManager.getSubscription();
        if (!subscription) {
            subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: decodeKey(publicKey)
            });
        }

        await fetch("/api/push/subscribe", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ subscription: subscription.toJSON() })
        });
    } catch (error) {
        console.warn("Hintergrund-Benachrichtigungen konnten nicht eingerichtet werden:", error);
    }
}

function requestPushPermissionFromUserGesture() {
    if (!("Notification" in window) || Notification.permission !== "default") return;
    const enable = async () => {
        window.removeEventListener("pointerdown", enable);
        window.removeEventListener("keydown", enable);
        if (await requestNotificationPermission() === "granted") {
            registerBackgroundPush();
        }
    };
    window.addEventListener("pointerdown", enable, { once: true });
    window.addEventListener("keydown", enable, { once: true });
}


/* ======================================================
   SOCKET: NEUE NACHRICHT BENACHRICHTIGUNG
   ====================================================== */

socket.on(
    "newMessageNotification",
    data => {

        if (
            Number(data.chatId) ===
            Number(currentChatId)
        ) {
            return;
        }

        const senderId =
            Number(data.senderId);

        unreadMessages[senderId] =
            (unreadMessages[senderId] || 0) + 1;

        renderFriends();

        showNotification(
            `Neue Nachricht von ${data.senderUsername}`,
            data.text
        );

        sendBrowserNotification(
            data.senderDisplayName || data.senderUsername,
            data.text
        );
    }
);


/* ======================================================
   SOCKET: FREUNDSCHAFT
   ====================================================== */

socket.on(
    "friendRequest",
    data => {

        showNotification(
            "Neue Freundschaftsanfrage",
            `${data.senderDisplayName || data.senderUsername} möchte dich adden.`
        );

        sendBrowserNotification(
            "Neue Freundschaftsanfrage",
            `${data.senderDisplayName || data.senderUsername} möchte dich adden.`
        );

        loadFriendRequests();
    }
);


socket.on(
    "friendRequestAccepted",
    data => {

        showNotification(
            "Freundschaft angenommen",
            `${data.displayName || data.username} hat deine Anfrage angenommen.`
        );

        sendBrowserNotification(
            "Freundschaft angenommen",
            `${data.displayName || data.username} hat deine Anfrage angenommen.`
        );

        loadFriends();
    }
);


/* ======================================================
   SOCKET: VERBINDUNG
   ====================================================== */

socket.on(
    "connect",
    () => {

        console.log(
            "Socket verbunden:",
            socket.id
        );

        if (status) {

            status.textContent =
                "● Online";

            status.style.color =
                "#ffffff";
        }
    }
);


socket.on(
    "disconnect",
    () => {

        if (status) {

            status.textContent =
                "● Offline";

            status.style.color =
                "#ffffff";
        }
    }
);


socket.on(
    "connect_error",
    error => {

        console.error(
            "Socket-Fehler:",
            error
        );

        if (status) {

            status.textContent =
                "Verbindungsfehler";

            status.style.color =
                "#ffffff";
        }

        showNotification(
            "Verbindung",
            "Die Verbindung zum Server konnte nicht hergestellt werden."
        );
    }
);


socket.on(
    "chatJoined",
    data => {

        console.log(
            "Chat betreten:",
            data.chatId
        );
    }
);


socket.on(
    "chatError",
    data => {

        console.error(
            "Chat-Fehler:",
            data
        );

        showNotification(
            "Chat-Fehler",
            data.error ||
            "Chat-Fehler"
        );
    }
);


/* ======================================================
   BENACHRICHTIGUNGEN
   ====================================================== */

function showNotification(
    title,
    text,
    duration = 4500
) {

    if (
        !notification ||
        !notificationTitle ||
        !notificationText
    ) {

        console.warn(
            title,
            text
        );

        return;
    }

    notificationTitle.textContent =
        title;

    notificationText.textContent =
        text || "";

    notification.classList.add(
        "show"
    );

    clearTimeout(
        notificationTimer
    );

    notificationTimer =
        setTimeout(
            () => {

                notification.classList.remove(
                    "show"
                );

            },
            duration
        );
}


/* ======================================================
   PRIVLINES BESTÄTIGUNGSFENSTER
   ====================================================== */

function showConfirm(
    title,
    text,
    confirmText = "OK",
    cancelText = "Abbrechen"
) {

    return new Promise(resolve => {

        const old =
            document.getElementById(
                "privLinesConfirm"
            );

        old?.remove();

        const overlay =
            document.createElement("div");

        overlay.id =
            "privLinesConfirm";

        overlay.style.cssText = `
            position:fixed;
            inset:0;
            z-index:100000;
            display:flex;
            align-items:center;
            justify-content:center;
            padding:20px;
            background:rgba(0,0,0,.72);
            backdrop-filter:blur(12px);
            -webkit-backdrop-filter:blur(12px);
        `;

        const box =
            document.createElement("div");

        box.style.cssText = `
            width:min(390px,100%);
            padding:22px;
            border:1px solid rgba(255,255,255,.18);
            border-radius:20px;
            background:rgba(10,10,10,.97);
            box-shadow:
                0 25px 80px rgba(0,0,0,.9),
                inset 0 0 25px rgba(255,255,255,.025);
            color:#fff;
        `;

        const heading =
            document.createElement("div");

        heading.textContent =
            title;

        heading.style.cssText = `
            margin-bottom:8px;
            color:#fff;
            font-size:16px;
            font-weight:800;
        `;

        const description =
            document.createElement("div");

        description.textContent =
            text || "";

        description.style.cssText = `
            margin-bottom:20px;
            color:#aaa;
            font-size:13px;
            line-height:1.5;
        `;

        const buttons =
            document.createElement("div");

        buttons.style.cssText = `
            display:flex;
            gap:10px;
            justify-content:flex-end;
        `;

        const cancel =
            document.createElement("button");

        cancel.type =
            "button";

        cancel.textContent =
            cancelText;

        cancel.style.cssText = `
            min-height:40px;
            padding:0 15px;
            border:1px solid rgba(255,255,255,.15);
            border-radius:12px;
            background:rgba(255,255,255,.06);
            color:#ccc;
            cursor:pointer;
            font-weight:600;
        `;

        const confirm =
            document.createElement("button");

        confirm.type =
            "button";

        confirm.textContent =
            confirmText;

        confirm.style.cssText = `
            min-height:40px;
            padding:0 16px;
            border:1px solid rgba(255,255,255,.25);
            border-radius:12px;
            background:#fff;
            color:#000;
            cursor:pointer;
            font-weight:800;
        `;

        let finished =
            false;

        function close(result) {

            if (finished) {
                return;
            }

            finished = true;

            document.removeEventListener(
                "keydown",
                escapeHandler
            );

            overlay.remove();

            resolve(result);
        }

        function escapeHandler(event) {

            if (
                event.key === "Escape" &&
                !finished
            ) {

                close(false);
            }
        }

        cancel.addEventListener(
            "click",
            () => close(false)
        );

        confirm.addEventListener(
            "click",
            () => close(true)
        );

        overlay.addEventListener(
            "click",
            event => {

                if (
                    event.target ===
                    overlay
                ) {

                    close(false);
                }
            }
        );

        document.addEventListener(
            "keydown",
            escapeHandler
        );

        buttons.append(
            cancel,
            confirm
        );

        box.append(
            heading,
            description,
            buttons
        );

        overlay.appendChild(
            box
        );

        document.body.appendChild(
            overlay
        );

        requestAnimationFrame(() => {
            confirm.focus();
        });
    });
}


/* Kompatibilität für ältere Freundschafts-UI-Aufrufe.
   Die vorhandene PrivLines-Dialogbox bleibt erhalten. */
function showConfirmDialog(title, text, cancelText = "Abbrechen", confirmText = "OK") {
    return showConfirm(title, text, confirmText, cancelText);
}


/* ======================================================
   PRIVLINES EINGABEFENSTER
   ====================================================== */

function showInputDialog(
    title,
    text,
    defaultValue = "",
    confirmText = "Speichern",
    cancelText = "Abbrechen"
) {

    return new Promise(resolve => {

        const old =
            document.getElementById(
                "privLinesInputDialog"
            );

        old?.remove();

        const overlay =
            document.createElement("div");

        overlay.id =
            "privLinesInputDialog";

        overlay.style.cssText = `
            position:fixed;
            inset:0;
            z-index:100000;
            display:flex;
            align-items:center;
            justify-content:center;
            padding:20px;
            background:rgba(0,0,0,.72);
            backdrop-filter:blur(12px);
            -webkit-backdrop-filter:blur(12px);
        `;

        const box =
            document.createElement("div");

        box.style.cssText = `
            width:min(420px,100%);
            padding:22px;
            border:1px solid rgba(255,255,255,.18);
            border-radius:20px;
            background:rgba(10,10,10,.97);
            box-shadow:
                0 25px 80px rgba(0,0,0,.9),
                inset 0 0 25px rgba(255,255,255,.025);
            color:#fff;
        `;

        const heading =
            document.createElement("div");

        heading.textContent =
            title;

        heading.style.cssText = `
            margin-bottom:7px;
            color:#fff;
            font-size:16px;
            font-weight:800;
        `;

        const description =
            document.createElement("div");

        description.textContent =
            text || "";

        description.style.cssText = `
            margin-bottom:14px;
            color:#aaa;
            font-size:13px;
            line-height:1.45;
        `;

        const input =
            document.createElement("textarea");

        input.value =
            defaultValue;

        input.rows = 4;

        input.style.cssText = `
            width:100%;
            min-height:90px;
            resize:vertical;
            padding:12px;
            border:1px solid rgba(255,255,255,.15);
            border-radius:12px;
            outline:none;
            background:rgba(255,255,255,.05);
            color:#fff;
            font:inherit;
            font-size:13px;
            box-sizing:border-box;
        `;

        const buttons =
            document.createElement("div");

        buttons.style.cssText = `
            display:flex;
            gap:10px;
            justify-content:flex-end;
            margin-top:15px;
        `;

        const cancel =
            document.createElement("button");

        cancel.type =
            "button";

        cancel.textContent =
            cancelText;

        cancel.style.cssText = `
            min-height:40px;
            padding:0 15px;
            border:1px solid rgba(255,255,255,.15);
            border-radius:12px;
            background:rgba(255,255,255,.06);
            color:#ccc;
            cursor:pointer;
            font-weight:600;
        `;

        const save =
            document.createElement("button");

        save.type =
            "button";

        save.textContent =
            confirmText;

        save.style.cssText = `
            min-height:40px;
            padding:0 16px;
            border:1px solid rgba(255,255,255,.25);
            border-radius:12px;
            background:#fff;
            color:#000;
            cursor:pointer;
            font-weight:800;
        `;

        let finished =
            false;

        function close(value) {

            if (finished) {
                return;
            }

            finished = true;

            document.removeEventListener(
                "keydown",
                escapeHandler
            );

            overlay.remove();

            resolve(value);
        }

        function escapeHandler(event) {

            if (
                event.key === "Escape" &&
                !finished
            ) {

                event.preventDefault();

                close(null);
            }
        }

        cancel.addEventListener(
            "click",
            () => close(null)
        );

        save.addEventListener(
            "click",
            () => close(input.value)
        );

        overlay.addEventListener(
            "click",
            event => {

                if (
                    event.target ===
                    overlay
                ) {

                    close(null);
                }
            }
        );

        input.addEventListener(
            "keydown",
            event => {

                if (
                    event.key === "Escape"
                ) {

                    event.preventDefault();

                    close(null);
                }
            }
        );

        document.addEventListener(
            "keydown",
            escapeHandler
        );

        buttons.append(
            cancel,
            save
        );

        box.append(
            heading,
            description,
            input,
            buttons
        );

        overlay.appendChild(
            box
        );

        document.body.appendChild(
            overlay
        );

        requestAnimationFrame(() => {

            input.focus();

            input.setSelectionRange(
                input.value.length,
                input.value.length
            );

        });
    });
}


/* ======================================================
   HTML ESCAPEN
   ====================================================== */

function escapeHtml(text) {

    const div =
        document.createElement("div");

    div.textContent =
        text || "";

    return div.innerHTML;
}


/* ======================================================
   PROFILBILD
   ====================================================== */

function setAvatarImage(
    element,
    url,
    username
) {

    if (!element) {
        return;
    }

    element.innerHTML = "";

    if (url) {

        const img =
            document.createElement("img");

        img.className =
            "profile-avatar";

        img.src =
            url;

        img.alt =
            `Profilbild von ${username || "Benutzer"}`;

        img.onerror = () => {

            element.innerHTML = "";

            element.textContent =
                (
                    username ||
                    "?"
                )
                .charAt(0)
                .toUpperCase();
        };

        element.appendChild(
            img
        );

    } else {

        element.textContent =
            (
                username ||
                "?"
            )
            .charAt(0)
            .toUpperCase();
    }
}


/* ======================================================
   EIGENES PROFILBILD
   ====================================================== */

async function changeProfilePicture() {

    const file =
        profilePictureInput?.files?.[0];

    if (!file) {
        return;
    }

    const allowedTypes = [

        "image/jpeg",
        "image/png",
        "image/gif",
        "image/webp"

    ];

    if (
        !allowedTypes.includes(
            file.type
        )
    ) {

        showNotification(
            "Profilbild",
            "Nur JPG, PNG, GIF und WebP sind erlaubt."
        );

        profilePictureInput.value = "";

        return;
    }

    if (
        file.size >
        10 * 1024 * 1024
    ) {

        showNotification(
            "Profilbild",
            "Das Profilbild darf maximal 10 MB groß sein."
        );

        profilePictureInput.value = "";

        return;
    }

    const form =
        new FormData();

    form.append(
        "profilePicture",
        file
    );

    try {

        const response =
            await fetch(
                "/api/profile-picture",
                {
                    method: "POST",
                    body: form,
                    credentials: "include"
                }
            );

        const data =
            await readJsonResponse(response);

        if (!response.ok) {

            throw new Error(
                data.error ||
                "Profilbild konnte nicht gespeichert werden."
            );
        }

        currentUser.profilePicture =
            data.profilePicture;

        setAvatarImage(
            myProfileAvatar,
            data.profilePicture,
            currentUser.username
        );

        setAvatarImage(
            profileMenuAvatar,
            data.profilePicture,
            currentUser.username
        );

        renderFriends();

        showNotification(
            "Profilbild",
            "Dein Profilbild wurde aktualisiert."
        );

    } catch (error) {

        console.error(
            "Profilbild-Fehler:",
            error
        );

        showNotification(
            "Profilbild",
            error.message ||
            "Profilbild konnte nicht gespeichert werden."
        );

    } finally {

        profilePictureInput.value = "";
    }
}


/* ======================================================
   ZWEI NAMEN – PROFILBEARBEITUNG
   ====================================================== */

function setupTwoNamesEditor() {
    if (!profileMenu || document.getElementById("privLinesNamesEditor")) return;

    const box = document.createElement("div");
    box.id = "privLinesNamesEditor";
    box.style.cssText = "margin-top:12px;padding:12px;border:1px solid rgba(255,255,255,.12);border-radius:14px;background:rgba(255,255,255,.04);";

    box.innerHTML = `
        <div style="font-weight:800;margin-bottom:9px;">Namen</div>
        <label style="display:block;font-size:11px;color:#aaa;margin-bottom:4px;">Anzeigename – darf mehrfach vorkommen</label>
        <input id="privLinesDisplayNameInput" type="text" maxlength="50" autocomplete="off" style="width:100%;box-sizing:border-box;margin-bottom:8px;padding:9px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:#fff;">
        <label style="display:block;font-size:11px;color:#aaa;margin-bottom:4px;">Benutzername – muss eindeutig sein</label>
        <input id="privLinesUsernameInput" type="text" maxlength="50" autocomplete="off" style="width:100%;box-sizing:border-box;margin-bottom:8px;padding:9px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:#fff;">
        <button id="privLinesSaveNames" type="button" style="width:100%;padding:10px;border:0;border-radius:10px;background:#fff;color:#000;font-weight:800;cursor:pointer;">Namen speichern</button>
    `;

    profileMenu.appendChild(box);

    const displayInput = box.querySelector("#privLinesDisplayNameInput");
    const usernameField = box.querySelector("#privLinesUsernameInput");
    const saveButton = box.querySelector("#privLinesSaveNames");

    saveButton?.addEventListener("click", async () => {
        if (!currentUser) return;
        const displayName = displayInput.value.trim();
        const username = usernameField.value.trim();
        if (!displayName || !username) {
            showNotification("Namen", "Bitte beide Namen ausfüllen.");
            return;
        }

        saveButton.disabled = true;
        try {
            const displayResponse = await fetch("/api/change-display-name", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ displayName })
            });
            const displayData = await readJsonResponse(displayResponse);
            if (!displayResponse.ok) throw new Error(displayData.error || "Anzeigename konnte nicht geändert werden.");

            const usernameChanged = username !== currentUser.username;
            let usernameData = { username: currentUser.username };
            if (usernameChanged) {
                const usernameResponse = await fetch("/api/change-username", {
                    method: "POST",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ username })
                });
                usernameData = await readJsonResponse(usernameResponse);
                if (!usernameResponse.ok) throw new Error(usernameData.error || "Benutzername konnte nicht geändert werden.");
            }

            currentUser.displayName = displayData.displayName || displayName;
            currentUser.username = usernameData.username || username;
            if (myUsername) myUsername.textContent = currentUser.displayName;
            if (profileMenuName) profileMenuName.textContent = currentUser.displayName;
            renderFriends();
            showNotification("Namen", "Deine Namen wurden gespeichert.");
        } catch (error) {
            console.error("Namensänderung-Fehler:", error);
            showNotification("Namen", error.message || "Namen konnten nicht gespeichert werden.");
        } finally {
            saveButton.disabled = false;
        }
    });

    box.addEventListener("click", event => event.stopPropagation());
}

function refreshTwoNamesEditor() {
    setupTwoNamesEditor();
    const displayInput = document.getElementById("privLinesDisplayNameInput");
    const usernameField = document.getElementById("privLinesUsernameInput");
    if (displayInput && currentUser) displayInput.value = currentUser.displayName || currentUser.username || "";
    if (usernameField && currentUser) usernameField.value = currentUser.username || "";
}


/* ======================================================
   PROFIL-MENÜ
   ====================================================== */

myProfileButton?.addEventListener(
    "click",
    event => {

        event.stopPropagation();

        profileMenu?.classList.toggle(
            "open"
        );

        refreshTwoNamesEditor();

        if (currentUser) {

            setAvatarImage(
                profileMenuAvatar,
                currentUser.profilePicture || null,
                currentUser.username
            );

            if (profileMenuName) {

                profileMenuName.textContent =
                    currentUser.displayName || currentUser.username;
            }
        }
    }
);


changeOwnProfileButton?.addEventListener(
    "click",
    event => {

        event.stopPropagation();

        profileMenu?.classList.remove(
            "open"
        );

        profilePictureInput?.click();
    }
);


profilePictureInput?.addEventListener(
    "change",
    changeProfilePicture
);


document.addEventListener(
    "click",
    event => {

        if (
            profileMenu &&
            !profileMenu.contains(
                event.target
            ) &&
            event.target !==
                myProfileButton
        ) {

            profileMenu.classList.remove(
                "open"
            );
        }
    }
);


/* ======================================================
   NACHRICHT BEARBEITEN
   ====================================================== */

async function editMessage(
    messageId,
    oldText
) {

    const newText =
        await showInputDialog(
            "Nachricht bearbeiten",
            "Bearbeite deine Nachricht:",
            oldText,
            "Speichern",
            "Abbrechen"
        );

    if (newText === null) {
        return;
    }

    const text =
        newText.trim();

    if (!text) {
        return;
    }

    if (text === oldText) {
        return;
    }

    try {

        const response =
            await fetch(
                `/api/messages/${encodeURIComponent(messageId)}`,
                {
                    method: "PATCH",
                    credentials: "include",
                    headers: {
                        "Content-Type":
                            "application/json"
                    },
                    body: JSON.stringify({
                        text
                    })
                }
            );

        const data =
            await readJsonResponse(response);

        if (!response.ok) {

            throw new Error(
                data.error ||
                "Nachricht konnte nicht bearbeitet werden."
            );
        }

        applyEditedMessage(
            data.id ||
            messageId,
            data.text ??
                text
        );

        showNotification(
            "Nachricht",
            "Nachricht wurde bearbeitet."
        );

    } catch (error) {

        console.error(
            "Bearbeiten-Fehler:",
            error
        );

        showNotification(
            "Nachricht",
            error.message ||
            "Nachricht konnte nicht bearbeitet werden."
        );
    }
}


/* ======================================================
   NACHRICHT LÖSCHEN
   ====================================================== */

async function deleteMessage(
    messageId
) {

    const confirmed =
        await showConfirm(
            "Nachricht löschen",
            "Möchtest du diese Nachricht wirklich löschen?",
            "Löschen",
            "Abbrechen"
        );

    if (!confirmed) {
        return;
    }

    try {

        const response =
            await fetch(
                `/api/messages/${encodeURIComponent(messageId)}`,
                {
                    method: "DELETE",
                    credentials: "include"
                }
            );

        const data =
            await readJsonResponse(response);

        if (!response.ok) {

            throw new Error(
                data.error ||
                "Nachricht konnte nicht gelöscht werden."
            );
        }

        applyDeletedMessage(
            data.messageId ||
            data.id ||
            messageId
        );

        showNotification(
            "Nachricht",
            "Nachricht wurde gelöscht."
        );

    } catch (error) {

        console.error(
            "Löschen-Fehler:",
            error
        );

        showNotification(
            "Nachricht",
            error.message ||
            "Nachricht konnte nicht gelöscht werden."
        );
    }
}


/* ======================================================
   BEARBEITETE NACHRICHT
   ====================================================== */

function applyEditedMessage(
    messageId,
    text
) {

    const message =
        document.querySelector(
            `.message[data-message-id="${CSS.escape(String(messageId))}"]`
        );

    if (!message) {
        return;
    }

    const old =
        message.querySelector(
            ".message-text"
        );

    if (old) {
        old.textContent =
            text;
    }

    if (
        !message.querySelector(
            ".edited-label"
        )
    ) {

        const label =
            document.createElement("span");

        label.className =
            "edited-label";

        label.textContent =
            "bearbeitet";

        message.appendChild(
            label
        );
    }
}


/* ======================================================
   GELÖSCHTE NACHRICHT
   ====================================================== */

function applyDeletedMessage(
    messageId
) {

    const message =
        document.querySelector(
            `.message[data-message-id="${CSS.escape(String(messageId))}"]`
        );

    if (!message) {
        return;
    }

    message
        .querySelector(
            ".message-actions"
        )
        ?.remove();

    message
        .querySelectorAll(
            ".message-text,.message-image,.message-video,.voice-message,.edited-label"
        )
        .forEach(
            element =>
                element.remove()
        );

    const element =
        document.createElement("div");

    element.className =
        "message-text deleted-message";

    element.textContent =
        "Nachricht gelöscht";

    message.appendChild(
        element
    );
}


/* ======================================================
   SOCKET: BEARBEITET
   ====================================================== */

socket.on(
    "messageEdited",
    data => {

        if (
            Number(data.chatId) !==
            Number(currentChatId)
        ) {
            return;
        }

        applyEditedMessage(
            data.id,
            data.text
        );
    }
);


/* ======================================================
   SOCKET: GELÖSCHT
   ====================================================== */

socket.on(
    "messageDeleted",
    data => {

        if (
            Number(data.chatId) !==
            Number(currentChatId)
        ) {
            return;
        }

        applyDeletedMessage(
            data.id ||
            data.messageId
        );
    }
);


/* ======================================================
   VOICE RECORDING
   ====================================================== */

async function toggleVoiceRecording() {

    if (
        mediaRecorder &&
        mediaRecorder.state === "recording"
    ) {

        mediaRecorder.stop();

        return;
    }

    if (!currentChatId) {
        return;
    }

    if (
        !navigator.mediaDevices ||
        !navigator.mediaDevices.getUserMedia ||
        typeof MediaRecorder === "undefined"
    ) {

        showNotification(
            "Sprachnachricht",
            "Sprachnachrichten werden von diesem Browser nicht unterstützt."
        );

        return;
    }

    try {

        recordingStream =
            await navigator.mediaDevices.getUserMedia({
                audio: true
            });

        let mimeType = "";

        const formats = [
            "audio/webm;codecs=opus",
            "audio/webm",
            "audio/ogg;codecs=opus",
            "audio/mp4"
        ];

        for (
            const candidate
            of formats
        ) {

            if (
                MediaRecorder.isTypeSupported(
                    candidate
                )
            ) {

                mimeType =
                    candidate;

                break;
            }
        }

        mediaRecorder =
            mimeType
                ? new MediaRecorder(
                    recordingStream,
                    {
                        mimeType
                    }
                )
                : new MediaRecorder(
                    recordingStream
                );

        recordedChunks = [];

        mediaRecorder.ondataavailable =
            event => {

                if (
                    event.data &&
                    event.data.size
                ) {

                    recordedChunks.push(
                        event.data
                    );
                }
            };

        mediaRecorder.onstop =
            async () => {

                const recorder =
                    mediaRecorder;

                recordingStream
                    ?.getTracks()
                    .forEach(
                        track =>
                            track.stop()
                    );

                recordingStream =
                    null;

                voiceButton?.classList.remove(
                    "recording"
                );

                recordingLabel?.classList.remove(
                    "visible"
                );

                const blob =
                    new Blob(
                        recordedChunks,
                        {
                            type:
                                recorder?.mimeType ||
                                "audio/webm"
                        }
                    );

                recordedChunks = [];
                mediaRecorder = null;

                if (blob.size > 0) {

                    await uploadVoice(
                        blob
                    );
                }
            };

        mediaRecorder.start();

        voiceButton?.classList.add(
            "recording"
        );

        recordingLabel?.classList.add(
            "visible"
        );

    } catch (error) {

        console.error(
            "Mikrofon-Fehler:",
            error
        );

        recordingStream
            ?.getTracks()
            .forEach(
                track =>
                    track.stop()
            );

        recordingStream = null;
        mediaRecorder = null;

        voiceButton?.classList.remove(
            "recording"
        );

        recordingLabel?.classList.remove(
            "visible"
        );

        showNotification(
            "Mikrofon",
            "Mikrofon konnte nicht verwendet werden. Bitte erlaube den Mikrofonzugriff."
        );
    }
}


async function uploadVoice(
    blob
) {

    if (!currentChatId) {
        return;
    }

    const chatId = Number(currentChatId);
    const extension = blob.type.includes("ogg") ? "ogg" : blob.type.includes("mp4") ? "m4a" : "webm";

    const form =
        new FormData();

    form.append(
        "audio",
        blob,
        `voice-${Date.now()}.${extension}`
    );

    form.append(
        "chatId",
        chatId
    );

    try {

        const response =
            await fetch(
                "/api/upload/audio",
                {
                    method: "POST",
                    body: form,
                    credentials: "include"
                }
            );

        const data =
            await readJsonResponse(response);

        if (!response.ok) {

            throw new Error(
                data.error ||
                "Sprachnachricht konnte nicht gesendet werden."
            );
        }

        showNotification(
            "Sprachnachricht",
            "Sprachnachricht wurde gesendet."
        );

    } catch (error) {

        console.error(
            "Voice-Upload-Fehler:",
            error
        );

        showNotification(
            "Sprachnachricht",
            error.message ||
            "Sprachnachricht konnte nicht gesendet werden."
        );
    }
}


voiceButton?.addEventListener(
    "click",
    toggleVoiceRecording
);


/* ======================================================
   ENTFREUNDEN
   ====================================================== */

unfriendButton?.addEventListener(
    "click",
    async () => {

        if (!currentPartner) {
            return;
        }

        closeFeatureMenu();

        const confirmed =
            await showConfirm(
                "Freund entfernen",
                `${currentPartner.username} wirklich als Freund entfernen?`,
                "Entfernen",
                "Abbrechen"
            );

        if (!confirmed) {
            return;
        }

        try {

            const response =
                await fetch(
                    `/api/friends/${currentPartner.userId}`,
                    {
                        method: "DELETE",
                        credentials: "include"
                    }
                );

            const data =
                await readJsonResponse(response);

            if (!response.ok) {

                throw new Error(
                    data.error ||
                    "Freund konnte nicht entfernt werden."
                );
            }

            if (currentChatId) {

                socket.emit(
                    "leaveChat",
                    Number(currentChatId)
                );
            }

            stopChatLiveUpdates();
            stopChatLiveUpdates();
            currentChatId = null;
            currentPartner = null;

            window.currentPartner =
                null;

            if (messages) {

                messages.innerHTML = `
                    <div class="empty-chat">
                        Wähle einen Freund aus, um zu chatten.
                    </div>
                `;
            }

            if (chatPartner) {

                chatPartner.textContent =
                    "Kein Chat ausgewählt";
            }

            setAvatarImage(
                chatAvatar,
                null,
                "?"
            );

            if (messageInput) {
                messageInput.disabled = true;
            }

            if (sendButton) {
                sendButton.disabled = true;
            }

            if (photoButton) {
                photoButton.disabled = true;
            }

            if (voiceButton) {
                voiceButton.disabled = true;
            }

            updateBlockButton();

            await loadFriends();

            showNotification(
                "Freundschaft",
                "Der Benutzer wurde aus deiner Freundesliste entfernt."
            );

        } catch (error) {

            console.error(
                "Entfreunden-Fehler:",
                error
            );

            showNotification(
                "Freundschaft",
                error.message ||
                "Freund konnte nicht entfernt werden."
            );
        }
    }
);


/* ======================================================
   BLOCKIEREN / ENTBLOCKIEREN
   ====================================================== */

blockButton?.addEventListener(
    "click",
    async () => {

        if (!currentPartner) {
            return;
        }

        closeFeatureMenu();

        const isBlockedByMe =
            Boolean(
                currentPartner.blockedByMe
            );

        const username =
            currentPartner.username;

        const question =
            isBlockedByMe
                ? `${username} wirklich entblockieren?`
                : `${username} wirklich blockieren?`;

        const confirmed =
            await showConfirm(
                isBlockedByMe
                    ? "Benutzer entblockieren"
                    : "Benutzer blockieren",
                question,
                isBlockedByMe
                    ? "Entblockieren"
                    : "Blockieren",
                "Abbrechen"
            );

        if (!confirmed) {
            return;
        }

        try {

            const url =
                `/api/users/${currentPartner.userId}/block`;

            const method =
                isBlockedByMe
                    ? "DELETE"
                    : "POST";

            const response =
                await fetch(
                    url,
                    {
                        method,
                        credentials: "include"
                    }
                );

            const data =
                await readJsonResponse(response);

            if (!response.ok) {

                throw new Error(
                    data.error ||
                    (
                        isBlockedByMe
                            ? "Benutzer konnte nicht entblockiert werden."
                            : "Benutzer konnte nicht blockiert werden."
                    )
                );
            }

            currentPartner.blockedByMe =
                !isBlockedByMe;

            currentPartner.blockedByOther =
                false;

            window.currentPartner =
                currentPartner;

            updateBlockButton();

            if (isBlockedByMe) {

                showNotification(
                    "Entblockiert",
                    `${username} wurde entblockiert.`
                );

            } else {

                showNotification(
                    "Blockiert",
                    `${username} wurde blockiert. Deine Nachrichten werden nicht zugestellt.`
                );
            }

            await loadBlockStatus();
            await loadFriends();
            await loadBlockedUsers();

        } catch (error) {

            console.error(
                "Blockierungsfehler:",
                error
            );

            showNotification(
                "Blockierung",
                error.message ||
                "Aktion konnte nicht ausgeführt werden."
            );
        }
    }
);


/* ======================================================
   SOCKET: BLOCKIERT
   ====================================================== */

socket.on(
    "userBlocked",
    async data => {

        if (
            currentPartner &&
            Number(currentPartner.userId) ===
            Number(data.userId)
        ) {

            const partnerName =
                currentPartner.username;

            await loadBlockStatus();

            if (
                currentPartner.blockedByOther
            ) {

                showNotification(
                    "Hinweis",
                    `${partnerName} hat dich blockiert.`
                );
            }
        }

        await loadFriends();
        await loadBlockedUsers();
    }
);


/* ======================================================
   SOCKET: ENTBLOCKIERT
   ====================================================== */

socket.on(
    "userUnblocked",
    async data => {

        if (
            currentPartner &&
            Number(currentPartner.userId) ===
            Number(data.userId)
        ) {

            await loadBlockStatus();
        }

        await loadFriends();
        await loadBlockedUsers();
    }
);


/* ======================================================
   SOCKET: NACHRICHT BLOCKIERT
   ====================================================== */

socket.on(
    "messageBlocked",
    data => {

        if (
            Number(data.chatId) !==
            Number(currentChatId)
        ) {
            return;
        }

        addMessage(
            currentUser?.username ||
                "Du",
            data.text ||
                "",
            data.messageType ||
                "text",
            data.mediaUrl ||
                null,
            data.messageId ||
                null,
            false,
            "blocked"
        );

        showNotification(
            "Nachricht gespeichert",
            "Die Nachricht wurde gespeichert und wird nach dem Entblockieren zugestellt."
        );
    }
);


/* ======================================================
   SOCKET: NACHRICHT ZUGESTELLT
   ====================================================== */

socket.on(
    "messageDelivered",
    data => {

        if (
            !data ||
            Number(data.chatId) !==
            Number(currentChatId)
        ) {
            return;
        }

        const message =
            document.querySelector(
                `.message[data-message-id="${CSS.escape(String(data.messageId))}"]`
            );

        if (!message) {
            return;
        }

        const blockedStatus =
            message.querySelector(
                ".message-delivery-status.blocked"
            );

        if (blockedStatus) {
            blockedStatus.remove();
        }
    }
);


/* ======================================================
   SOCKET: PROFILBILD
   ====================================================== */

socket.on("profileUpdated", data => {
    const id = Number(data?.userId);
    const friend = friends.find(f => Number(f.userId) === id);
    if (friend) {
        if (data.username) friend.username = data.username;
        if (data.displayName) friend.displayName = data.displayName;
        renderFriends();
    }
});


socket.on(
    "profilePictureChanged",
    data => {

        const id =
            Number(data.userId);

        if (
            currentUser &&
            Number(currentUser.userId) ===
            id
        ) {

            currentUser.profilePicture =
                data.profilePicture;

            setAvatarImage(
                myProfileAvatar,
                data.profilePicture,
                currentUser.username
            );

            setAvatarImage(
                profileMenuAvatar,
                data.profilePicture,
                currentUser.username
            );

            return;
        }

        const friend =
            friends.find(
                f =>
                    Number(f.userId) ===
                    id
            );

        if (friend) {

            friend.profilePicture =
                data.profilePicture;

            renderFriends();
        }

        if (
            currentPartner &&
            Number(currentPartner.userId) ===
            id
        ) {

            currentPartner.profilePicture =
                data.profilePicture;

            setAvatarImage(
                chatAvatar,
                data.profilePicture,
                currentPartner.username
            );
        }
    }
);


/* ======================================================
   FREUND ENTFERNT
   ====================================================== */

socket.on(
    "friendRemoved",
    async data => {

        if (
            currentPartner &&
            Number(currentPartner.userId) ===
            Number(data.userId)
        ) {

            if (currentChatId) {

                socket.emit(
                    "leaveChat",
                    Number(currentChatId)
                );
            }

            stopChatLiveUpdates();
            currentChatId = null;
            currentPartner = null;

            window.currentPartner =
                null;

            if (messages) {

                messages.innerHTML = `
                    <div class="empty-chat">
                        Die Freundschaft wurde beendet.
                    </div>
                `;
            }

            if (messageInput) {
                messageInput.disabled = true;
            }

            if (sendButton) {
                sendButton.disabled = true;
            }

            if (photoButton) {
                photoButton.disabled = true;
            }

            if (voiceButton) {
                voiceButton.disabled = true;
            }

            updateBlockButton();

            showNotification(
                "Freundschaft",
                "Die Freundschaft wurde beendet."
            );
        }

        await loadFriends();
    }
);


/* ======================================================
   MOBILE ZURÜCK
   ====================================================== */

mobileBackButton?.addEventListener(
    "click",
    event => {

        event.preventDefault();


        chat?.classList.remove(
            "mobile-visible"
        );

        sidebar?.classList.remove(
            "mobile-hidden"
        );

        document.body.classList.remove(
            "mobile-chat-open"
        );
    }
);


/* ======================================================
   PRIVLINES AI – BILDGENERIERUNG
   ====================================================== */

async function generatePrivLinesAIImage(
    prompt
) {

    if (
        !prompt ||
        !prompt.trim()
    ) {

        throw new Error(
            "Bitte gib einen Bild-Prompt ein."
        );
    }

    try {

        const response =
            await fetch(
                "/api/ai/image",
                {
                    method: "POST",
                    credentials: "include",
                    headers: {
                        "Content-Type":
                            "application/json"
                    },
                    body: JSON.stringify({
                        prompt:
                            prompt.trim()
                    })
                }
            );

        const data =
            await readJsonResponse(response);

        if (!response.ok) {

            throw new Error(
                data.error ||
                "Bild konnte nicht generiert werden."
            );
        }

        if (!data.image) {

            throw new Error(
                "Der Server hat kein Bild zurückgegeben."
            );
        }

        return data.image;

    } catch (error) {

        console.error(
            "PrivLines AI Bildfehler:",
            error
        );

        throw error;
    }
}


window.generatePrivLinesAIImage =
    generatePrivLinesAIImage;


/* ======================================================
   GRUPPEN
   ====================================================== */

const standardGroupsSection = document.getElementById("standardGroupsSection");
const groupsList = document.getElementById("groupsList");
const groupCountBadge = document.getElementById("groupCountBadge");
const createGroupButton = document.getElementById("createGroupButton");
const groupModal = document.getElementById("groupModal");
const groupCreateName = document.getElementById("groupCreateName");
const groupCreateDescription = document.getElementById("groupCreateDescription");
const groupFriendsList = document.getElementById("groupFriendsList");
const groupCreateError = document.getElementById("groupCreateError");
const groupModalCancel = document.getElementById("groupModalCancel");
const groupModalSubmit = document.getElementById("groupModalSubmit");
const groupMembersModal = document.getElementById("groupMembersModal");
const groupMembersList = document.getElementById("groupMembersList");
const groupMembersError = document.getElementById("groupMembersError");
const groupMembersCancel = document.getElementById("groupMembersCancel");
const groupMembersSubmit = document.getElementById("groupMembersSubmit");
const groupView = document.getElementById("groupView");
const groupViewBack = document.getElementById("groupViewBack");
const groupViewName = document.getElementById("groupViewName");
const groupViewMeta = document.getElementById("groupViewMeta");
const groupAddMembersButton = document.getElementById("groupAddMembersButton");
const groupMessages = document.getElementById("groupMessages");
const groupMessageInput = document.getElementById("groupMessageInput");
const groupSendButton = document.getElementById("groupSendButton");

let groups = [];
let currentGroupId = null;
let currentGroup = null;

function openGroupModal() {
    if (!groupModal) return;
    groupCreateError.textContent = "";
    groupCreateName.value = "";
    groupCreateDescription.value = "";
    groupFriendsList.innerHTML = "";
    if (!friends.length) {
        groupFriendsList.innerHTML = `<div class="empty-list">Du hast noch keine Freunde zum Hinzufügen.</div>`;
    } else {
        friends.forEach(friend => {
            const label = document.createElement("label");
            label.className = "group-friend-option";
            label.innerHTML = `
                <input type="checkbox" value="${Number(friend.userId)}">
                <span class="group-friend-option-name">${escapeHtml(friend.displayName || friend.username)} <small>@${escapeHtml(friend.username || "")}</small></span>
            `;
            groupFriendsList.appendChild(label);
        });
    }
    groupModal.classList.add("visible");
    groupModal.setAttribute("aria-hidden", "false");
    groupCreateName.focus();
}

function closeGroupModal() {
    groupModal?.classList.remove("visible");
    groupModal?.setAttribute("aria-hidden", "true");
}

async function loadGroups() {
    if (!groupsList || currentUser?.mode === "school") return;
    try {
        const response = await fetch("/api/groups", { credentials:"include", cache:"no-store" });
        if (!response.ok) return;
        groups = await readJsonResponse(response);
        if (!Array.isArray(groups)) groups = [];
        renderGroups();
    } catch (error) {
        console.error("Gruppen konnten nicht geladen werden:", error);
    }
}

function renderGroups() {
    if (!groupsList) return;
    groupsList.innerHTML = "";
    if (groupCountBadge) {
        groupCountBadge.textContent = String(groups.length);
        groupCountBadge.style.display = groups.length ? "inline-flex" : "none";
    }
    if (!groups.length) {
        groupsList.innerHTML = `<div class="empty-list">Noch keine Gruppen.</div>`;
        return;
    }
    groups.forEach(group => {
        const card = document.createElement("div");
        card.className = "standard-group-card";
        card.innerHTML = `
            <div class="standard-group-avatar">👥</div>
            <div class="standard-group-info">
                <div class="standard-group-name">${escapeHtml(group.name)}</div>
                <div class="standard-group-meta">${Number(group.memberCount || 0)} Mitglieder</div>
            </div>
        `;
        card.addEventListener("click", () => openGroup(group.id));
        groupsList.appendChild(card);
    });
}

async function createGroup() {
    const name = groupCreateName?.value.trim() || "";
    const description = groupCreateDescription?.value.trim() || "";
    const memberIds = [...(groupFriendsList?.querySelectorAll("input[type=checkbox]:checked") || [])].map(input => Number(input.value));
    if (!name) {
        groupCreateError.textContent = "Bitte gib einen Gruppennamen ein.";
        return;
    }
    groupModalSubmit.disabled = true;
    groupCreateError.textContent = "";
    try {
        const response = await fetch("/api/groups", {
            method:"POST", credentials:"include",
            headers:{"Content-Type":"application/json"},
            body:JSON.stringify({name, description, memberIds})
        });
        const data = await readJsonResponse(response);
        if (!response.ok) throw new Error(data.error || "Gruppe konnte nicht erstellt werden.");
        closeGroupModal();
        await loadGroups();
        if (data.group?.id) await openGroup(data.group.id);
        showNotification("Gruppe", "Die Gruppe wurde erstellt.");
    } catch (error) {
        groupCreateError.textContent = error.message || "Gruppe konnte nicht erstellt werden.";
    } finally {
        groupModalSubmit.disabled = false;
    }
}

async function openGroup(groupId) {
    try {
        const response = await fetch(`/api/groups/${Number(groupId)}`, { credentials:"include", cache:"no-store" });
        const data = await readJsonResponse(response);
        if (!response.ok) throw new Error(data.error || "Gruppe konnte nicht geöffnet werden.");
        if (currentGroupId) socket.emit("leaveGroup", Number(currentGroupId));
        currentGroupId = Number(data.id);
        currentGroup = data;
        socket.emit("joinGroup", currentGroupId);
        if (groupViewName) groupViewName.textContent = data.name || "Gruppe";
        if (groupViewMeta) groupViewMeta.textContent = `${Number(data.memberCount || data.members?.length || 0)} Mitglieder`;
        if (groupView) {
            groupView.classList.add("visible");
            groupView.setAttribute("aria-hidden", "false");
        }
        chat?.classList.remove("mobile-visible");
        sidebar?.classList.add("mobile-hidden");
        await loadGroupMessages();
        renderGroupMembersModal();
    } catch (error) {
        showNotification("Gruppe", error.message || "Gruppe konnte nicht geöffnet werden.");
    }
}

async function loadGroupMessages() {
    if (!currentGroupId || !groupMessages) return;
    try {
        const response = await fetch(`/api/groups/${currentGroupId}/messages`, { credentials:"include", cache:"no-store" });
        const data = await readJsonResponse(response);
        if (!response.ok) throw new Error(data.error || "Gruppennachrichten konnten nicht geladen werden.");
        renderGroupMessages(Array.isArray(data) ? data : []);
    } catch (error) {
        groupMessages.innerHTML = `<div class="empty-chat">${escapeHtml(error.message || "Nachrichten konnten nicht geladen werden.")}</div>`;
    }
}

function renderGroupMessages(list) {
    if (!groupMessages) return;
    groupMessages.innerHTML = "";
    if (!list.length) {
        groupMessages.innerHTML = `<div class="empty-chat">Noch keine Gruppennachrichten.</div>`;
        return;
    }
    list.forEach(message => appendGroupMessage(message));
    groupMessages.scrollTop = groupMessages.scrollHeight;
}

function appendGroupMessage(message) {
    if (!groupMessages || Number(message.groupId) !== Number(currentGroupId)) return;
    if (groupMessages.querySelector(`[data-group-message-id="${CSS.escape(String(message.id))}"]`)) return;
    const item = document.createElement("div");
    item.className = `group-message${Number(message.senderId) === Number(currentUser?.userId) ? " mine" : ""}`;
    item.dataset.groupMessageId = String(message.id);
    item.innerHTML = `
        <div class="group-message-sender">${escapeHtml(message.displayName || message.username || "Unbekannt")}</div>
        <div class="group-message-text">${escapeHtml(message.text || "")}</div>
    `;
    groupMessages.appendChild(item);
    groupMessages.scrollTop = groupMessages.scrollHeight;
}

async function closeGroupView() {
    if (currentGroupId) socket.emit("leaveGroup", Number(currentGroupId));
    currentGroupId = null;
    currentGroup = null;
    groupView?.classList.remove("visible");
    groupView?.setAttribute("aria-hidden", "true");
    sidebar?.classList.remove("mobile-hidden");

    // Nach dem Verlassen die Gruppenliste direkt neu laden.
    // So bleibt die Gruppe auch nach Zurück/Verlassen sichtbar.
    await loadGroups();
}

function renderGroupMembersModal() {
    if (!groupMembersList || !currentGroup) return;
    groupMembersList.innerHTML = "";
    const me = Number(currentUser?.userId);
    const isOwner = Number(currentGroup.ownerId) === me;
    const members = Array.isArray(currentGroup.members) ? currentGroup.members : [];

    const currentTitle = document.createElement("div");
    currentTitle.style.cssText = "font-size:11px;color:#aaa;font-weight:800;margin-bottom:8px;text-transform:uppercase;letter-spacing:.08em";
    currentTitle.textContent = "Mitglieder";
    groupMembersList.appendChild(currentTitle);

    members.forEach(member => {
        const row = document.createElement("div");
        row.style.cssText = "display:flex;align-items:center;gap:8px;padding:9px;border:1px solid rgba(255,255,255,.10);border-radius:11px;background:rgba(255,255,255,.04);margin-bottom:6px";
        const name = document.createElement("div");
        name.style.cssText = "min-width:0;flex:1;font-size:12px;font-weight:700";
        name.textContent = `${member.displayName || member.username || "Unbekannt"}${member.role === "owner" ? " · Admin" : ""}`;
        row.appendChild(name);
        if (isOwner && Number(member.userId) !== me) {
            const kick = document.createElement("button");
            kick.type = "button";
            kick.textContent = "Kicken";
            kick.style.cssText = "padding:7px 9px;border-radius:9px;background:rgba(255,0,0,.12);color:#ff9999;border:1px solid rgba(255,100,100,.25);font-size:11px";
            kick.addEventListener("click", () => kickGroupMember(member));
            row.appendChild(kick);
        }
        groupMembersList.appendChild(row);
    });

    const divider = document.createElement("div");
    divider.style.cssText = "height:1px;background:rgba(255,255,255,.10);margin:12px 0";
    groupMembersList.appendChild(divider);

    const addTitle = document.createElement("div");
    addTitle.style.cssText = "font-size:11px;color:#aaa;font-weight:800;margin-bottom:8px;text-transform:uppercase;letter-spacing:.08em";
    addTitle.textContent = "Freunde hinzufügen";
    groupMembersList.appendChild(addTitle);

    const existing = new Set(members.map(m => Number(m.userId)));
    const available = friends.filter(friend => !existing.has(Number(friend.userId)));
    if (!available.length) {
        groupMembersList.insertAdjacentHTML("beforeend", `<div class="empty-list">Keine weiteren Freunde verfügbar.</div>`);
    } else {
        available.forEach(friend => {
            const label = document.createElement("label");
            label.className = "group-friend-option";
            label.innerHTML = `<input type="checkbox" value="${Number(friend.userId)}"><span class="group-friend-option-name">${escapeHtml(friend.displayName || friend.username)} <small>@${escapeHtml(friend.username || "")}</small></span>`;
            groupMembersList.appendChild(label);
        });
    }

    if (!document.getElementById("groupLeaveButton")) {
        const leave = document.createElement("button");
        leave.id = "groupLeaveButton";
        leave.type = "button";
        leave.textContent = "Gruppe verlassen";
        leave.style.cssText = "width:100%;margin-top:12px;padding:10px;border-radius:10px;background:rgba(255,255,255,.07);color:#fff;border:1px solid rgba(255,255,255,.12);font-weight:800";
        leave.addEventListener("click", leaveCurrentGroup);
        groupMembersList.appendChild(leave);
    }

    if (isOwner) {
        const rename = document.createElement("button");
        rename.id = "groupRenameButton";
        rename.type = "button";
        rename.textContent = "Gruppennamen ändern";
        rename.style.cssText = "width:100%;margin-top:7px;padding:10px;border-radius:10px;background:#fff;color:#000;border:0;font-weight:800";
        rename.addEventListener("click", renameCurrentGroup);
        groupMembersList.appendChild(rename);
    }
}

async function kickGroupMember(member) {
    if (!currentGroupId || !member?.userId) return;
    if (!window.confirm(`${member.displayName || member.username} aus der Gruppe entfernen?`)) return;
    try {
        const response = await fetch(`/api/groups/${Number(currentGroupId)}/members/${Number(member.userId)}`, {method:"DELETE",credentials:"include"});
        const data = await readJsonResponse(response);
        if (!response.ok) throw new Error(data.error || "Mitglied konnte nicht entfernt werden.");
        await openGroup(currentGroupId);
        showNotification("Gruppe", "Mitglied wurde entfernt.");
    } catch(error) { showNotification("Gruppe", error.message || "Mitglied konnte nicht entfernt werden."); }
}

async function renameCurrentGroup() {
    if (!currentGroupId || Number(currentGroup?.ownerId) !== Number(currentUser?.userId)) return;
    const name = window.prompt("Neuer Gruppenname:", currentGroup?.name || "");
    if (!name || !name.trim()) return;
    try {
        const response = await fetch(`/api/groups/${Number(currentGroupId)}`, {method:"PUT",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:name.trim()})});
        const data = await readJsonResponse(response);
        if (!response.ok) throw new Error(data.error || "Name konnte nicht geändert werden.");
        currentGroup.name = data.name;
        if (groupViewName) groupViewName.textContent = data.name;
        await loadGroups();
        showNotification("Gruppe", "Gruppenname geändert.");
    } catch(error) { showNotification("Gruppe", error.message || "Name konnte nicht geändert werden."); }
}

async function leaveCurrentGroup() {
    if (!currentGroupId) return;
    if (!window.confirm("Gruppe wirklich verlassen?")) return;
    try {
        const id = Number(currentGroupId);
        const response = await fetch(`/api/groups/${id}/leave`, {method:"DELETE",credentials:"include"});
        const data = await readJsonResponse(response);
        if (!response.ok) throw new Error(data.error || "Gruppe konnte nicht verlassen werden.");
        closeGroupMembersModal();
        await closeGroupView();
        showNotification("Gruppe", "Du hast die Gruppe verlassen.");
    } catch(error) { showNotification("Gruppe", error.message || "Gruppe konnte nicht verlassen werden."); }
}

function openGroupMembersModal() {
    if (!currentGroup) return;
    groupMembersError.textContent = "";
    renderGroupMembersModal();
    groupMembersModal?.classList.add("visible");
    groupMembersModal?.setAttribute("aria-hidden", "false");
}

function closeGroupMembersModal() {
    groupMembersModal?.classList.remove("visible");
    groupMembersModal?.setAttribute("aria-hidden", "true");
}

async function addGroupMembers() {
    const userIds = [...(groupMembersList?.querySelectorAll("input[type=checkbox]:checked") || [])].map(input => Number(input.value));
    if (!userIds.length) {
        groupMembersError.textContent = "Bitte wähle mindestens einen Freund aus.";
        return;
    }
    groupMembersSubmit.disabled = true;
    groupMembersError.textContent = "";
    try {
        const response = await fetch(`/api/groups/${Number(currentGroupId)}/members`, {
            method:"POST", credentials:"include", headers:{"Content-Type":"application/json"}, body:JSON.stringify({userIds})
        });
        const data = await readJsonResponse(response);
        if (!response.ok) throw new Error(data.error || "Mitglieder konnten nicht hinzugefügt werden.");
        closeGroupMembersModal();
        await openGroup(currentGroupId);
        await loadGroups();
        showNotification("Gruppe", data.added?.length ? `${data.added.length} Mitglied(er) hinzugefügt.` : "Keine neuen Mitglieder hinzugefügt.");
    } catch (error) {
        groupMembersError.textContent = error.message || "Mitglieder konnten nicht hinzugefügt werden.";
    } finally { groupMembersSubmit.disabled = false; }
}

async function sendGroupMessage() {
    const text = groupMessageInput?.value.trim() || "";
    if (!currentGroupId || !text) return;
    groupMessageInput.value = "";
    groupSendButton.disabled = true;
    try {
        const response = await fetch(`/api/groups/${Number(currentGroupId)}/messages`, {
            method:"POST", credentials:"include",
            headers:{"Content-Type":"application/json"},
            body:JSON.stringify({message:text})
        });
        const data = await readJsonResponse(response);
        if (!response.ok) throw new Error(data.error || "Nachricht konnte nicht gesendet werden.");
        appendGroupMessage(data);
    } catch (error) {
        showNotification("Gruppe", error.message || "Nachricht konnte nicht gesendet werden.");
    } finally {
        groupSendButton.disabled = false;
        groupMessageInput?.focus();
    }
}

/* ======================================================
   GEBLOCKTE NUTZER
   ====================================================== */

const blockedUsersList = document.getElementById("blockedUsersList");
const blockedCountBadge = document.getElementById("blockedCountBadge");
const blockedSectionToggle = document.getElementById("blockedSectionToggle");
const standardGroupsToggle = document.getElementById("standardGroupsToggle");
const standardGroupsContent = document.getElementById("standardGroupsContent");

async function loadBlockedUsers() {
    if (!blockedUsersList || currentUser?.mode === "school") return;
    try {
        const response = await fetch("/api/blocked-users", { credentials:"include", cache:"no-store" });
        const data = await readJsonResponse(response);
        if (!response.ok) throw new Error(data.error || "Geblockte Nutzer konnten nicht geladen werden.");
        renderBlockedUsers(Array.isArray(data) ? data : []);
    } catch (error) {
        console.error("Geblockte Nutzer:", error);
    }
}

function renderBlockedUsers(list) {
    if (!blockedUsersList) return;
    blockedUsersList.innerHTML = "";
    if (blockedCountBadge) {
        blockedCountBadge.textContent = String(list.length);
        blockedCountBadge.style.display = list.length ? "inline-flex" : "none";
    }
    if (!list.length) {
        blockedUsersList.innerHTML = `<div class="empty-list">Keine geblockten Nutzer.</div>`;
        return;
    }
    list.forEach(user => {
        const card = document.createElement("div");
        card.className = "blocked-user-card";
        card.innerHTML = `
            <div class="blocked-user-info">
                <div class="blocked-user-name">${escapeHtml(user.displayName || user.username)}</div>
                <div class="blocked-user-handle">@${escapeHtml(user.username || "")}</div>
            </div>
            <button type="button">Entblocken</button>
        `;
        card.querySelector("button").addEventListener("click", () => unblockFromList(user));
        blockedUsersList.appendChild(card);
    });
}

async function unblockFromList(user) {
    try {
        const response = await fetch(`/api/users/${Number(user.userId)}/block`, { method:"DELETE", credentials:"include" });
        const data = await readJsonResponse(response);
        if (!response.ok) throw new Error(data.error || "Benutzer konnte nicht entblockt werden.");
        await loadBlockedUsers();
        await loadFriends();
        if (currentPartner && Number(currentPartner.userId) === Number(user.userId)) await loadBlockStatus();
        showNotification("Entblockiert", `${user.username || "Der Benutzer"} wurde entblockiert.`);
    } catch (error) {
        showNotification("Entblockieren", error.message || "Aktion konnte nicht ausgeführt werden.");
    }
}

blockedSectionToggle?.addEventListener("click", () => {
    if (!blockedUsersList) return;
    blockedUsersList.style.display = blockedUsersList.style.display === "none" ? "block" : "none";
});

// Gruppen bleiben beim Start eingeklappt und stehen am unteren Ende der Sidebar.
standardGroupsToggle?.addEventListener("click", () => {
    if (!standardGroupsContent) return;
    standardGroupsContent.style.display =
        standardGroupsContent.style.display === "none" ? "block" : "none";
});

createGroupButton?.addEventListener("click", openGroupModal);
groupModalCancel?.addEventListener("click", closeGroupModal);
groupModalSubmit?.addEventListener("click", createGroup);
groupMembersCancel?.addEventListener("click", closeGroupMembersModal);
groupMembersSubmit?.addEventListener("click", addGroupMembers);
groupAddMembersButton?.addEventListener("click", openGroupMembersModal);
groupViewBack?.addEventListener("click", closeGroupView);
groupSendButton?.addEventListener("click", sendGroupMessage);
groupMessageInput?.addEventListener("keydown", event => {
    if (event.key === "Enter") { event.preventDefault(); sendGroupMessage(); }
});

socket.on("groupMemberRemoved", async data => {
    if (currentGroupId && Number(data?.groupId) === Number(currentGroupId)) {
        showNotification("Gruppe", "Du wurdest aus der Gruppe entfernt.");
        await closeGroupView();
    }
});

socket.on("groupLeft", async data => {
    if (currentGroupId && Number(data?.groupId) === Number(currentGroupId)) await closeGroupView();
});

socket.on("groupMessage", message => appendGroupMessage(message));
socket.on("groupUpdated", async data => {
    await loadGroups();
    if (currentGroupId && Number(data?.groupId) === Number(currentGroupId)) {
        const response = await fetch(`/api/groups/${Number(currentGroupId)}`, { credentials:"include", cache:"no-store" });
        if (response.ok) {
            currentGroup = await readJsonResponse(response);
            if (groupViewMeta) groupViewMeta.textContent = `${Number(currentGroup.memberCount || currentGroup.members?.length || 0)} Mitglieder`;
            renderGroupMembersModal();
        }
        await loadGroupMessages();
    }
});


/* ======================================================
   NATIVE MOBILE-TASTATUR
   ====================================================== */
// Die native Geräte-Tastatur wird wieder verwendet.

/* ======================================================
   SCHULKANAL-VERWALTUNG
   ====================================================== */
(function initSchoolManagement(){
    const socket = window.messengerSocket;
    let manageButton=null;
    function ensureButton(){
        const header=document.querySelector(".school-channel-header"); if(!header||manageButton) return;
        manageButton=document.createElement("button"); manageButton.type="button"; manageButton.title="Schulkanal verwalten"; manageButton.textContent="⚙️"; manageButton.style.cssText="margin-left:auto;width:40px;height:40px;border-radius:12px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.07);color:#fff;cursor:pointer"; header.appendChild(manageButton); manageButton.addEventListener("click",openManager);
    }
    async function openManager(){
        const school=window.privLinesActiveSchoolChannel; if(!school?.id) return;
        try{
            const [mr,ar]=await Promise.all([fetch(`/api/schools/${Number(school.id)}/members`,{credentials:"include",cache:"no-store"}),fetch(`/api/schools/${Number(school.id)}/available-members`,{credentials:"include",cache:"no-store"})]);
            const members=await mr.json(), available=await ar.json();
            if(!mr.ok) throw new Error(members.error||"Mitglieder konnten nicht geladen werden.");
            const overlay=document.createElement("div"); overlay.style.cssText="position:fixed;inset:0;z-index:10040;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.75);backdrop-filter:blur(12px)";
            const card=document.createElement("div"); card.style.cssText="width:min(520px,100%);max-height:88vh;overflow:auto;background:#0b0b0b;color:#fff;border:1px solid rgba(255,255,255,.16);border-radius:20px;padding:18px";
            const isOwner=members.role==="owner"; let html=`<h3 style="margin-bottom:12px">Schulkanal verwalten</h3><div style="color:#aaa;font-size:11px;margin-bottom:8px">Mitglieder</div>`;
            (members.members||[]).forEach(m=>{html+=`<div style="display:flex;align-items:center;gap:8px;padding:8px;border:1px solid rgba(255,255,255,.08);border-radius:10px;margin-bottom:5px"><span style="flex:1">${escapeHtml(m.displayName||m.username)}${m.role==="owner"?" · Admin":""}</span>${isOwner&&m.role!=="owner"?`<button data-kick="${m.userId}" style="padding:6px 8px;border-radius:8px;background:rgba(255,0,0,.12);color:#ff9999;border:1px solid rgba(255,100,100,.25)">Kicken</button>`:""}</div>`});
            html+=`<div style="height:1px;background:rgba(255,255,255,.1);margin:12px 0"></div><div style="color:#aaa;font-size:11px;margin-bottom:8px">Nutzer hinzufügen</div>`;
            (Array.isArray(available)?available:[]).forEach(u=>{html+=`<label style="display:flex;align-items:center;gap:8px;padding:8px"><input type="checkbox" data-add="${u.userId}"><span>${escapeHtml(u.displayName||u.username)} <small style="color:#777">@${escapeHtml(u.username)}</small></span></label>`});
            html+=`<div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:12px">${isOwner?`<button data-rename style="flex:1;padding:10px;border-radius:10px;background:#fff;color:#000;font-weight:800">Namen ändern</button>`:""}<button data-add-submit style="flex:1;padding:10px;border-radius:10px;background:#fff;color:#000;font-weight:800">Hinzufügen</button><button data-leave style="flex:1;padding:10px;border-radius:10px;background:rgba(255,255,255,.08);color:#fff;font-weight:800">Verlassen</button><button data-close style="flex:1;padding:10px;border-radius:10px;background:rgba(255,255,255,.08);color:#fff">Schließen</button></div>`;
            card.innerHTML=html; overlay.appendChild(card); document.body.appendChild(overlay);
            card.querySelector('[data-close]').onclick=()=>overlay.remove();
            card.querySelector('[data-rename]')?.addEventListener('click',async()=>{const name=prompt('Neuer Schulkanalname:',school.name||'');if(!name?.trim())return;const r=await fetch(`/api/schools/${Number(school.id)}`,{method:'PUT',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name.trim()})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Name konnte nicht geändert werden.');school.name=d.name;document.getElementById('schoolChannelTitle').textContent=d.name;overlay.remove();window.privLinesReloadSchools?.();});
            card.querySelector('[data-add-submit]').onclick=async()=>{const ids=[...card.querySelectorAll('[data-add]:checked')].map(x=>Number(x.dataset.add));if(!ids.length)return;const r=await fetch(`/api/schools/${Number(school.id)}/members`,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({userIds:ids})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Nutzer konnten nicht hinzugefügt werden.');overlay.remove();openManager();};
            card.querySelector('[data-leave]').onclick=async()=>{if(!confirm('Schulkanal wirklich verlassen?'))return;const r=await fetch(`/api/schools/${Number(school.id)}/leave`,{method:'DELETE',credentials:'include'});const d=await r.json();if(!r.ok)throw new Error(d.error||'Schulkanal konnte nicht verlassen werden.');overlay.remove();document.getElementById('schoolChannelBack')?.click();};
            card.querySelectorAll('[data-kick]').forEach(btn=>btn.addEventListener('click',async()=>{if(!confirm('Mitglied wirklich entfernen?'))return;const r=await fetch(`/api/schools/${Number(school.id)}/members/${Number(btn.dataset.kick)}`,{method:'DELETE',credentials:'include'});const d=await r.json();if(!r.ok)throw new Error(d.error||'Mitglied konnte nicht entfernt werden.');overlay.remove();openManager();}));
        }catch(error){showNotification("Schulkanal",error.message||"Verwaltung konnte nicht geöffnet werden.");}
    }
    const timer=setInterval(()=>{if(document.querySelector('.school-channel-header')) ensureButton();},500); setTimeout(()=>clearInterval(timer),15000);
    document.addEventListener('click',e=>{if(e.target.id==='schoolChannelBack'){} ensureButton();});
    socket?.on('schoolChannelRemoved',data=>{const active=window.privLinesActiveSchoolChannel;if(active&&Number(active.id)===Number(data?.schoolId))document.getElementById('schoolChannelBack')?.click();});
    socket?.on('schoolChannelUpdated',async data=>{const active=window.privLinesActiveSchoolChannel;if(active&&Number(active.id)===Number(data?.schoolId)){if(data.name){active.name=data.name;document.getElementById('schoolChannelTitle').textContent=data.name;}document.getElementById('schoolChannelSubtitle').textContent=`${active.member_count||0} Mitglieder · Schulchat`;}});
})();

/* ======================================================
   EVENTS
   ====================================================== */

logoutButton?.addEventListener(
    "click",
    logout
);

deleteAccountButton?.addEventListener("click", deleteAccount);


searchButton?.addEventListener(
    "click",
    () => {
        setUserDirectoryTab("search");
        searchUser();
    }
);


searchTabButton?.addEventListener(
    "click",
    () => setUserDirectoryTab("search")
);


allUsersTabButton?.addEventListener(
    "click",
    () => setUserDirectoryTab("all")
);


usernameInput?.addEventListener(
    "keydown",
    event => {

        if (
            event.key === "Enter"
        ) {

            event.preventDefault();

            setUserDirectoryTab("search");
            searchUser();
        }
    }
);


sendButton?.addEventListener(
    "click",
    sendMessage
);


messageInput?.addEventListener(
    "keydown",
    event => {

        if (
            event.key === "Enter"
        ) {

            event.preventDefault();

            sendMessage();
        }
    }
);


chatMenuButton?.addEventListener(
    "click",
    event => {

        event.stopPropagation();

        featureMenu?.classList.toggle(
            "open"
        );
    }
);


function closeFeatureMenu() {

    featureMenu?.classList.remove(
        "open"
    );

    featureMenu?.classList.remove(
        "active"
    );
}


document.addEventListener(
    "click",
    event => {

        if (
            featureMenu &&
            !featureMenu.contains(
                event.target
            ) &&
            event.target !==
                chatMenuButton
        ) {

            closeFeatureMenu();
        }
    }
);


document.addEventListener("visibilitychange", () => {
    if (!document.hidden && currentUser?.mode !== "school") {
        loadGroups();
    }
});

window.addEventListener("pageshow", () => {
    if (currentUser?.mode !== "school") {
        loadGroups();
    }
});

/* ======================================================
   START
   ====================================================== */

async function start() {

    const loggedIn =
        await loadCurrentUser();

    if (!loggedIn) {
        return;
    }

    await loadFriends();

    await loadGroups();

    await loadBlockedUsers();

    await loadFriendRequests();

    registerBackgroundPush();

    requestPushPermissionFromUserGesture();

    updateBlockButton();

    /* Sicherheitsnetz: Timer läuft dauerhaft. Wenn ein Chat geöffnet
       ist, wird er automatisch spätestens nach 1 Sekunde geprüft. */
    startChatLiveUpdates();

    console.log(
        "✅ chat2.js vollständig geladen."
    );
}



start();