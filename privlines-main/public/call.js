/* ======================================================
   WEBRTC TELEFON- UND VIDEOANRUFE
   ====================================================== */

(() => {
    "use strict";

    const socket = window.messengerSocket;

    if (!socket) {
        console.error("❌ call.js: Messenger-Socket nicht gefunden.");
        return;
    }

    let peer = null;
    let localStream = null;
    let currentCall = null;
    let pendingOffer = null;
    let pendingIceCandidates = [];

    let isMuted = false;
    let cameraEnabled = false;

    /* ======================================================
       DOM
       ====================================================== */

    const $ = id => document.getElementById(id);

    const overlay = () => $("callOverlay");
    const videos = () => $("callVideos");
    const state = () => $("callState");
    const name = () => $("callName");

    /* ======================================================
       GERÄTE-FEHLERMELDUNG
       ====================================================== */

    let deviceErrorTimeout = null;

    function showDeviceError(title, message) {

        const errorBox = $("deviceError");
        const errorTitle = $("deviceErrorTitle");
        const errorText = $("deviceErrorText");

        if (!errorBox) {
            console.error(
                "❌ #deviceError wurde in chat.html nicht gefunden."
            );
            return;
        }

        if (errorTitle) {
            errorTitle.textContent =
                title || "Gerät nicht verfügbar";
        }

        if (errorText) {
            errorText.textContent =
                message ||
                "Das benötigte Gerät konnte nicht verwendet werden.";
        }

        /* Alte Animation zurücksetzen */

        errorBox.style.display = "flex";
        errorBox.style.opacity = "0";
        errorBox.style.transform = "translateY(20px)";
        errorBox.style.pointerEvents = "none";

        errorBox.setAttribute(
            "aria-hidden",
            "false"
        );

        /* Kurz warten, damit die CSS-Animation sicher startet */

        requestAnimationFrame(() => {

            requestAnimationFrame(() => {

                errorBox.style.opacity = "1";
                errorBox.style.transform =
                    "translateY(0)";
                errorBox.style.pointerEvents =
                    "auto";

            });

        });

        if (deviceErrorTimeout) {
            clearTimeout(deviceErrorTimeout);
        }

        deviceErrorTimeout = setTimeout(
            hideDeviceError,
            7000
        );
    }

    function hideDeviceError() {

        const errorBox =
            $("deviceError");

        if (!errorBox) {
            return;
        }

        errorBox.style.opacity = "0";
        errorBox.style.transform =
            "translateY(20px)";
        errorBox.style.pointerEvents =
            "none";

        errorBox.setAttribute(
            "aria-hidden",
            "true"
        );

        if (deviceErrorTimeout) {

            clearTimeout(
                deviceErrorTimeout
            );

            deviceErrorTimeout = null;
        }

        setTimeout(() => {

            if (
                errorBox.getAttribute(
                    "aria-hidden"
                ) === "true"
            ) {
                errorBox.style.display =
                    "none";
            }

        }, 300);
    }

    function setupDeviceErrorButton() {

        const button =
            $("deviceErrorClose");

        if (!button) {
            console.warn(
                "⚠️ #deviceErrorClose wurde nicht gefunden."
            );
            return;
        }

        button.addEventListener(
            "click",
            hideDeviceError
        );
    }

    /* ======================================================
       CALL UI
       ====================================================== */

    function showOverlay() {

        const element =
            overlay();

        if (!element) {
            return;
        }

        element.classList.add(
            "visible"
        );

        element.setAttribute(
            "aria-hidden",
            "false"
        );
    }

    function hideOverlay() {

        const element =
            overlay();

        if (!element) {
            return;
        }

        element.classList.remove(
            "visible"
        );

        element.setAttribute(
            "aria-hidden",
            "true"
        );

        const incoming =
            $("incomingCallActions");

        const outgoing =
            $("outgoingCallActions");

        if (incoming) {
            incoming.style.display =
                "none";
        }

        if (outgoing) {
            outgoing.style.display =
                "none";
        }
    }

    function setPeerButtons(enabled) {

        const audio =
            $("audioCallButton");

        const video =
            $("videoCallButton");

        if (audio) {
            audio.disabled =
                !enabled;
        }

        if (video) {
            video.disabled =
                !enabled;
        }
    }

    function setCallState(text) {

        const element =
            state();

        if (element) {
            element.textContent =
                text;
        }
    }

    function setCallName(text) {

        const element =
            name();

        if (element) {
            element.textContent =
                text || "Anruf";
        }

        const avatar =
            $("callAvatar");

        if (avatar) {

            avatar.textContent =
                text
                    ? text.charAt(0).toUpperCase()
                    : "?";
        }
    }

    /* ======================================================
       MEDIA ZURÜCKSETZEN
       ====================================================== */

    function resetMedia() {

        if (localStream) {

            localStream
                .getTracks()
                .forEach(track => {

                    try {
                        track.stop();
                    } catch (_) {}

                });
        }

        localStream = null;

        const local =
            $("localVideo");

        const remote =
            $("remoteVideo");

        if (local) {
            local.srcObject = null;
        }

        if (remote) {
            remote.srcObject = null;
        }

        const cameraButton =
            $("cameraCallButton");

        const muteButton =
            $("muteCallButton");

        if (cameraButton) {

            cameraButton.style.display =
                "none";

            cameraButton.classList.remove(
                "muted"
            );
        }

        if (muteButton) {

            muteButton.classList.remove(
                "muted"
            );
        }

        if (videos()) {

            videos().classList.remove(
                "visible"
            );

            videos().setAttribute(
                "aria-hidden",
                "true"
            );
        }

        isMuted = false;
        cameraEnabled = false;
    }

    /* ======================================================
       PEER CONNECTION
       ====================================================== */

    function closePeer() {

        if (!peer) {
            return;
        }

        try {

            peer.ontrack = null;
            peer.onicecandidate = null;
            peer.onconnectionstatechange = null;

            peer.close();

        } catch (error) {

            console.warn(
                "Peer konnte nicht sauber geschlossen werden:",
                error
            );
        }

        peer = null;
        pendingIceCandidates = [];
    }

    async function addPendingIceCandidates() {

        if (
            !peer ||
            !peer.remoteDescription
        ) {
            return;
        }

        for (
            const candidate
            of pendingIceCandidates
        ) {

            try {

                await peer.addIceCandidate(
                    new RTCIceCandidate(
                        candidate
                    )
                );

            } catch (error) {

                console.warn(
                    "ICE-Kandidat konnte nicht hinzugefügt werden:",
                    error
                );
            }
        }

        pendingIceCandidates = [];
    }

    async function createPeer(isVideo) {

        const pc =
            new RTCPeerConnection({
                iceServers: [
                    {
                        urls:
                            "stun:stun.l.google.com:19302"
                    },
                    {
                        urls:
                            "stun:stun1.l.google.com:19302"
                    }
                ]
            });

        pc.onicecandidate =
            event => {

                if (
                    !event.candidate ||
                    !currentCall
                ) {
                    return;
                }

                socket.emit(
                    "call:ice",
                    {
                        callId:
                            currentCall.callId,

                        toUserId:
                            currentCall.toUserId,

                        candidate:
                            event.candidate
                    }
                );
            };

        pc.ontrack =
            event => {

                const remote =
                    $("remoteVideo");

                if (!remote) {
                    return;
                }

                if (
                    event.streams &&
                    event.streams[0]
                ) {

                    remote.srcObject =
                        event.streams[0];
                }
            };

        pc.onconnectionstatechange =
            () => {

                console.log(
                    "📞 WebRTC Connection State:",
                    pc.connectionState
                );

                if (
                    pc.connectionState ===
                    "connected"
                ) {

                    setCallState(
                        "Verbunden"
                    );
                }

                if (
                    pc.connectionState ===
                        "failed" ||
                    pc.connectionState ===
                        "closed"
                ) {

                    finishCall(false);
                }
            };

        const constraints =
            isVideo
                ? {
                    audio: true,
                    video: true
                }
                : {
                    audio: true,
                    video: false
                };

        try {

            localStream =
                await navigator.mediaDevices.getUserMedia(
                    constraints
                );

        } catch (error) {

            console.error(
                "❌ Medienzugriff fehlgeschlagen:",
                error
            );

            if (
                error.name ===
                "NotAllowedError"
            ) {

                throw new Error(
                    isVideo
                        ? "Kamera und Mikrofon wurden nicht erlaubt."
                        : "Mikrofon wurde nicht erlaubt."
                );
            }

            if (
                error.name ===
                "NotFoundError"
            ) {

                throw new Error(
                    isVideo
                        ? "Keine Kamera oder kein Mikrofon gefunden."
                        : "Kein Mikrofon gefunden."
                );
            }

            if (
                error.name ===
                "NotReadableError"
            ) {

                throw new Error(
                    isVideo
                        ? "Kamera oder Mikrofon wird bereits von einer anderen App verwendet."
                        : "Das Mikrofon wird bereits von einer anderen App verwendet."
                );
            }

            if (
                error.name ===
                "SecurityError"
            ) {

                throw new Error(
                    "Der Zugriff auf Kamera oder Mikrofon wurde aus Sicherheitsgründen blockiert."
                );
            }

            throw new Error(
                isVideo
                    ? "Kamera und Mikrofon konnten nicht verwendet werden."
                    : "Mikrofon konnte nicht verwendet werden."
            );
        }

        localStream
            .getTracks()
            .forEach(track => {

                pc.addTrack(
                    track,
                    localStream
                );
            });

        const local =
            $("localVideo");

        if (local) {

            local.srcObject =
                localStream;

            local.muted = true;
            local.autoplay = true;
            local.playsInline = true;
        }

        cameraEnabled =
            isVideo;

        const cameraButton =
            $("cameraCallButton");

        if (cameraButton) {

            cameraButton.style.display =
                isVideo
                    ? "inline-block"
                    : "none";

            cameraButton.classList.toggle(
                "muted",
                !isVideo
            );
        }

        if (videos()) {

            videos().classList.add(
                "visible"
            );

            videos().setAttribute(
                "aria-hidden",
                "false"
            );
        }

        return pc;
    }

    /* ======================================================
       CALL BEENDEN
       ====================================================== */

    function finishCall(notify = true) {

        if (
            notify &&
            currentCall
        ) {

            socket.emit(
                "call:end",
                {
                    callId:
                        currentCall.callId,

                    toUserId:
                        currentCall.toUserId
                }
            );
        }

        closePeer();
        resetMedia();

        currentCall = null;
        pendingOffer = null;
        pendingIceCandidates = [];

        hideOverlay();

        setPeerButtons(
            !!window.currentPartner
        );

        console.log(
            "📞 Anruf beendet."
        );
    }

    /* ======================================================
       ANRUF STARTEN
       ====================================================== */

    async function startCall(video) {

        hideDeviceError();

        if (!window.currentPartner) {

            console.warn(
                "❌ Kein Chatpartner ausgewählt."
            );

            return;
        }

        if (currentCall) {

            console.warn(
                "❌ Es läuft bereits ein Anruf."
            );

            return;
        }

        const toUserId =
            Number(
                window.currentPartner.userId
            );

        if (
            !Number.isInteger(toUserId) ||
            toUserId <= 0
        ) {

            console.error(
                "❌ Ungültige Benutzer-ID:",
                window.currentPartner.userId
            );

            return;
        }

        const callId =
            crypto.randomUUID();

        currentCall = {
            callId,
            toUserId,
            video: !!video,
            outgoing: true
        };

        pendingIceCandidates = [];

        const username =
            window.currentPartner.username ||
            "Unbekannt";

        setCallName(
            username
        );

        setCallState(
            video
                ? "Videoanruf wird gestartet..."
                : "Anruf wird gestartet..."
        );

        if (
            $("outgoingCallActions")
        ) {

            $("outgoingCallActions")
                .style.display =
                "flex";
        }

        showOverlay();

        console.log(
            "📞 Starte Anruf:",
            username,
            "User-ID:",
            toUserId
        );

        try {

            peer =
                await createPeer(
                    video
                );

            const offer =
                await peer.createOffer();

            await peer.setLocalDescription(
                offer
            );

            socket.emit(
                "call:offer",
                {
                    callId,
                    toUserId,
                    video: !!video,
                    offer
                }
            );

            setCallState(
                "Klingelt..."
            );

            console.log(
                "📞 Offer gesendet."
            );

        } catch (error) {

            console.error(
                "❌ Fehler beim Starten des Anrufs:",
                error
            );

            let title =
                video
                    ? "Kamera oder Mikrofon nicht verfügbar"
                    : "Mikrofon nicht verfügbar";

            const message =
                error.message ||
                "Der Anruf konnte nicht gestartet werden.";

            const lower =
                message.toLowerCase();

            if (
                lower.includes("kamera") &&
                lower.includes("mikrofon")
            ) {

                title =
                    "Kamera und Mikrofon nicht verfügbar";

            } else if (
                lower.includes("kamera")
            ) {

                title =
                    "Keine Kamera gefunden";

            } else if (
                lower.includes("mikrofon")
            ) {

                title =
                    "Kein Mikrofon gefunden";
            }

            /*
             * Wichtig:
             * Erst den Anruf beenden,
             * danach die Meldung anzeigen.
             *
             * Dadurch kann finishCall()
             * die Anzeige nicht mehr beeinflussen.
             */

            finishCall(false);

            showDeviceError(
                title,
                message
            );
        }
    }

    /* ======================================================
       EINGEHENDEN ANRUF ANNEHMEN
       ====================================================== */

    async function acceptCall() {

        hideDeviceError();

        if (
            !currentCall ||
            !pendingOffer
        ) {

            console.warn(
                "❌ Kein eingehender Anruf vorhanden."
            );

            return;
        }

        setCallState(
            currentCall.video
                ? "Videoanruf wird verbunden..."
                : "Verbinde..."
        );

        if (
            $("incomingCallActions")
        ) {

            $("incomingCallActions")
                .style.display =
                "none";
        }

        try {

            peer =
                await createPeer(
                    currentCall.video
                );

            await peer.setRemoteDescription(
                new RTCSessionDescription(
                    pendingOffer
                )
            );

            await addPendingIceCandidates();

            const answer =
                await peer.createAnswer();

            await peer.setLocalDescription(
                answer
            );

            socket.emit(
                "call:answer",
                {
                    callId:
                        currentCall.callId,

                    toUserId:
                        currentCall.toUserId,

                    answer
                }
            );

            pendingOffer = null;

            setCallState(
                "Verbunden"
            );

            hideOverlay();

            console.log(
                "📞 Anruf angenommen."
            );

        } catch (error) {

            console.error(
                "❌ Fehler beim Annehmen:",
                error
            );

            if (currentCall) {

                socket.emit(
                    "call:reject",
                    {
                        callId:
                            currentCall.callId,

                        toUserId:
                            currentCall.toUserId,

                        reason:
                            "media_error"
                    }
                );
            }

            const message =
                error.message ||
                "Kamera oder Mikrofon konnte nicht verwendet werden.";

            finishCall(false);

            showDeviceError(
                "Anruf konnte nicht angenommen werden",
                message
            );
        }
    }

    /* ======================================================
       EINGEHENDER ANRUF
       ====================================================== */

    socket.on(
        "call:incoming",
        data => {

            console.log(
                "📞 Eingehender Anruf:",
                data
            );

            if (currentCall) {

                socket.emit(
                    "call:busy",
                    {
                        callId:
                            data.callId,

                        toUserId:
                            data.fromUserId
                    }
                );

                return;
            }

            currentCall = {
                callId:
                    data.callId,

                toUserId:
                    Number(
                        data.fromUserId
                    ),

                video:
                    !!data.video,

                outgoing:
                    false
            };

            pendingOffer =
                data.offer;

            pendingIceCandidates = [];

            setCallName(
                data.fromUsername
            );

            setCallState(
                data.video
                    ? "Eingehender Videoanruf..."
                    : "Eingehender Anruf..."
            );

            if (
                $("incomingCallActions")
            ) {

                $("incomingCallActions")
                    .style.display =
                    "flex";
            }

            showOverlay();
        }
    );

    socket.emit("call:fetch-pending");

    /* ======================================================
       ANSWER
       ====================================================== */

    socket.on(
        "call:answer",
        async data => {

            if (
                !currentCall ||
                currentCall.callId !==
                    data.callId ||
                !peer
            ) {

                return;
            }

            try {

                await peer.setRemoteDescription(
                    new RTCSessionDescription(
                        data.answer
                    )
                );

                await addPendingIceCandidates();

                setCallState(
                    "Verbunden"
                );

                hideOverlay();

                console.log(
                    "📞 Answer erhalten."
                );

            } catch (error) {

                console.error(
                    "❌ Answer-Fehler:",
                    error
                );

                finishCall(false);
            }
        }
    );

    /* ======================================================
       ICE
       ====================================================== */

    socket.on(
        "call:ice",
        async data => {

            if (
                !currentCall ||
                currentCall.callId !==
                    data.callId ||
                !data.candidate
            ) {

                return;
            }

            if (
                !peer ||
                !peer.remoteDescription
            ) {

                pendingIceCandidates.push(
                    data.candidate
                );

                console.log(
                    "📡 ICE-Kandidat zwischengespeichert."
                );

                return;
            }

            try {

                await peer.addIceCandidate(
                    new RTCIceCandidate(
                        data.candidate
                    )
                );

            } catch (error) {

                console.warn(
                    "⚠️ ICE-Kandidat konnte nicht verarbeitet werden:",
                    error
                );
            }
        }
    );

    /* ======================================================
       ABGELEHNT
       ====================================================== */

    socket.on(
        "call:rejected",
        data => {

            if (
                !currentCall ||
                currentCall.callId !==
                    data.callId
            ) {

                return;
            }

            if (
                data.reason ===
                "busy"
            ) {

                setCallState(
                    "Benutzer ist gerade beschäftigt."
                );

            } else {

                setCallState(
                    "Anruf abgelehnt."
                );
            }

            setTimeout(
                () => {
                    finishCall(false);
                },
                1000
            );
        }
    );

    /* ======================================================
       BEENDET
       ====================================================== */

    socket.on(
        "call:ended",
        data => {

            if (
                !currentCall ||
                currentCall.callId !==
                    data.callId
            ) {

                return;
            }

            console.log(
                "📞 Gegenstelle hat den Anruf beendet."
            );

            finishCall(false);
        }
    );

    /* ======================================================
       FEHLER
       ====================================================== */

    socket.on(
        "call:error",
        data => {

            if (
                currentCall &&
                data.callId &&
                currentCall.callId !==
                    data.callId
            ) {

                return;
            }

            console.error(
                "❌ Call-Serverfehler:",
                data.error
            );

            const message =
                data.error ||
                "Der Anruf konnte nicht aufgebaut werden.";

            finishCall(false);

            showDeviceError(
                "Anruf konnte nicht aufgebaut werden",
                message
            );
        }
    );

    /* ======================================================
       BUTTONS
       ====================================================== */

    $("audioCallButton")?.addEventListener(
        "click",
        () => startCall(false)
    );

    $("videoCallButton")?.addEventListener(
        "click",
        () => startCall(true)
    );

    $("acceptCallButton")?.addEventListener(
        "click",
        acceptCall
    );

    $("rejectCallButton")?.addEventListener(
        "click",
        () => {

            if (currentCall) {

                socket.emit(
                    "call:reject",
                    {
                        callId:
                            currentCall.callId,

                        toUserId:
                            currentCall.toUserId,

                        reason:
                            "rejected"
                    }
                );
            }

            finishCall(false);
        }
    );

    $("cancelCallButton")?.addEventListener(
        "click",
        () => finishCall(true)
    );

    $("endCallButton")?.addEventListener(
        "click",
        () => finishCall(true)
    );

    /* ======================================================
       MIKROFON
       ====================================================== */

    $("muteCallButton")?.addEventListener(
        "click",
        () => {

            if (!localStream) {
                return;
            }

            isMuted =
                !isMuted;

            localStream
                .getAudioTracks()
                .forEach(track => {

                    track.enabled =
                        !isMuted;
                });

            $("muteCallButton")
                .classList.toggle(
                    "muted",
                    isMuted
                );
        }
    );

    /* ======================================================
       KAMERA
       ====================================================== */

    $("cameraCallButton")?.addEventListener(
        "click",
        () => {

            if (!localStream) {
                return;
            }

            const tracks =
                localStream
                    .getVideoTracks();

            if (!tracks.length) {
                return;
            }

            cameraEnabled =
                !cameraEnabled;

            tracks.forEach(
                track => {

                    track.enabled =
                        cameraEnabled;
                }
            );

            $("cameraCallButton")
                .classList.toggle(
                    "muted",
                    !cameraEnabled
                );
        }
    );

    /* ======================================================
       CHATPARTNER SYNCHRONISIEREN
       ====================================================== */

    function syncPartner() {

        let partner = null;

        try {

            if (
                typeof currentPartner !==
                    "undefined" &&
                currentPartner
            ) {

                partner =
                    currentPartner;
            }

        } catch (_) {}

        if (
            !partner &&
            window.currentPartner
        ) {

            partner =
                window.currentPartner;
        }

        if (
            partner !==
            window.currentPartner
        ) {

            window.currentPartner =
                partner;
        }

        setPeerButtons(
            !!window.currentPartner &&
            !currentCall
        );
    }

    /* ======================================================
       START
       ====================================================== */

    setupDeviceErrorButton();

    /* Fehleranzeige initial verstecken */

    const initialError =
        $("deviceError");

    if (initialError) {

        initialError.style.display =
            "none";

        initialError.style.opacity =
            "0";

        initialError.style.transform =
            "translateY(20px)";
    }

    setPeerButtons(false);

    syncPartner();

    setInterval(
        syncPartner,
        250
    );

    console.log(
        "✅ WebRTC-Anrufsystem geladen."
    );


    /* ======================================================
       GRUPPEN-ANRUFE (WebRTC Mesh)
       ====================================================== */

    const groupCall = {
        active: false,
        callId: null,
        groupId: null,
        video: false,
        outgoing: false,
        callerId: null,
        localStream: null,
        peers: new Map(),
        names: new Map(),
        pendingIce: new Map()
    };

    function groupCallOverlay() {
        return $("groupCallOverlay");
    }

    function groupCallState(text) {
        const el = $("groupCallState");
        if (el) el.textContent = text || "Verbunden";
    }

    function clearGroupCallVideos() {
        const container = $("groupCallVideos");
        if (container) container.innerHTML = "";
    }

    function addGroupRemoteVideo(userId, username, stream) {
        const container = $("groupCallVideos");
        if (!container) return;

        const key = String(userId);
        let tile = container.querySelector(`[data-group-call-user="${CSS.escape(key)}"]`);

        if (!tile) {
            tile = document.createElement("div");
            tile.className = "group-call-tile";
            tile.dataset.groupCallUser = key;

            const video = document.createElement("video");
            video.autoplay = true;
            video.playsInline = true;
            video.controls = false;
            video.dataset.groupCallVideo = key;

            const label = document.createElement("div");
            label.className = "group-call-tile-name";
            label.textContent = username || "Teilnehmer";

            tile.append(video, label);
            container.appendChild(tile);
        }

        const video = tile.querySelector("video");
        if (video) {
            video.srcObject = stream;
            video.play().catch(() => {});
        }
    }

    function removeGroupRemoteVideo(userId) {
        const tile = $("groupCallVideos")?.querySelector(
            `[data-group-call-user="${CSS.escape(String(userId))}"]`
        );
        tile?.remove();
    }

    function showGroupCallOverlay() {
        const el = groupCallOverlay();
        if (!el) return;
        el.classList.add("visible");
        el.setAttribute("aria-hidden", "false");
    }

    function hideGroupCallOverlay() {
        const el = groupCallOverlay();
        if (!el) return;
        el.classList.remove("visible");
        el.setAttribute("aria-hidden", "true");
    }

    async function getGroupCallLocalStream(video) {
        if (groupCall.localStream) return groupCall.localStream;

        groupCall.localStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: !!video
        });

        return groupCall.localStream;
    }

    function closeGroupPeer(userId) {
        const key = Number(userId);
        const pc = groupCall.peers.get(key);

        if (pc) {
            try { pc.close(); } catch (_) {}
        }

        groupCall.peers.delete(key);
        groupCall.pendingIce.delete(key);
        removeGroupRemoteVideo(key);
    }

    async function addGroupPendingIce(userId) {
        const pc = groupCall.peers.get(Number(userId));
        const candidates = groupCall.pendingIce.get(Number(userId)) || [];

        if (!pc?.remoteDescription) return;

        for (const candidate of candidates) {
            try {
                await pc.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (error) {
                console.warn("Gruppenanruf ICE:", error);
            }
        }

        groupCall.pendingIce.delete(Number(userId));
    }

    async function createGroupPeer(userId, username) {
        const key = Number(userId);

        closeGroupPeer(key);

        const pc = new RTCPeerConnection({
            iceServers: [
                { urls: "stun:stun.l.google.com:19302" },
                { urls: "stun:stun1.l.google.com:19302" }
            ]
        });

        groupCall.peers.set(key, pc);
        groupCall.names.set(key, username || "Teilnehmer");

        if (groupCall.localStream) {
            groupCall.localStream.getTracks().forEach(track => {
                pc.addTrack(track, groupCall.localStream);
            });
        }

        pc.onicecandidate = event => {
            if (!event.candidate || !groupCall.active) return;

            socket.emit("groupCall:ice", {
                callId: groupCall.callId,
                groupId: groupCall.groupId,
                toUserId: key,
                candidate: event.candidate
            });
        };

        pc.ontrack = event => {
            const stream = event.streams?.[0];
            if (stream) addGroupRemoteVideo(key, groupCall.names.get(key), stream);
        };

        pc.onconnectionstatechange = () => {
            if (["failed", "closed", "disconnected"].includes(pc.connectionState)) {
                closeGroupPeer(key);
            }
        };

        return pc;
    }

    async function startGroupCall(groupId, video = false) {
        if (!groupId || groupCall.active) return;

        try {
            groupCall.active = true;
            groupCall.callId = crypto.randomUUID();
            groupCall.groupId = Number(groupId);
            groupCall.video = !!video;
            groupCall.outgoing = true;
            groupCall.callerId = Number(window.privLinesUser?.userId || window.currentUser?.userId);

            await getGroupCallLocalStream(groupCall.video);

            const title = $("groupCallTitle");
            if (title) title.textContent = "Gruppen-Videoanruf";
            if (!groupCall.video && title) title.textContent = "Gruppen-Sprachanruf";

            const cameraButton = $("groupCallCameraButton");
            if (cameraButton) cameraButton.style.display = groupCall.video ? "inline-block" : "none";

            groupCallState("Einladung wird gesendet...");
            clearGroupCallVideos();
            showGroupCallOverlay();

            socket.emit("groupCall:invite", {
                callId: groupCall.callId,
                groupId: groupCall.groupId,
                video: groupCall.video
            });

            groupCallState("Warte auf Teilnehmer...");
        } catch (error) {
            console.error("❌ Gruppenanruf konnte nicht gestartet werden:", error);
            endGroupCall(false);
            showDeviceError(
                groupCall.video ? "Kamera oder Mikrofon nicht verfügbar" : "Mikrofon nicht verfügbar",
                error.message || "Gruppenanruf konnte nicht gestartet werden."
            );
        }
    }

    async function endGroupCall(notify = true) {
        if (!groupCall.active && !groupCall.callId) return;

        const groupId = groupCall.groupId;
        const callId = groupCall.callId;

        if (notify && groupId) {
            socket.emit("groupCall:end", { callId, groupId });
        }

        for (const [userId] of groupCall.peers) closeGroupPeer(userId);

        groupCall.localStream?.getTracks().forEach(track => {
            try { track.stop(); } catch (_) {}
        });

        groupCall.active = false;
        groupCall.callId = null;
        groupCall.groupId = null;
        groupCall.video = false;
        groupCall.outgoing = false;
        groupCall.callerId = null;
        groupCall.localStream = null;
        groupCall.peers.clear();
        groupCall.names.clear();
        groupCall.pendingIce.clear();

        clearGroupCallVideos();
        hideGroupCallOverlay();
    }

    window.startPrivLinesGroupCall = startGroupCall;
    window.endPrivLinesGroupCall = endGroupCall;

    socket.on("groupCall:incoming", async data => {
        if (!data?.callId || !data?.groupId) return;

        if (groupCall.active) {
            socket.emit("groupCall:rejected", {
                callId: data.callId,
                groupId: Number(data.groupId),
                callerId: Number(data.fromUserId)
            });
            return;
        }

        const typeText = data.video ? "Videoanruf" : "Sprachanruf";
        const accepted = window.confirm(
            `${data.fromUsername || "Ein Gruppenmitglied"} startet einen ${typeText} in der Gruppe. Annehmen?`
        );

        if (!accepted) {
            socket.emit("groupCall:rejected", {
                callId: data.callId,
                groupId: Number(data.groupId),
                callerId: Number(data.fromUserId)
            });
            return;
        }

        try {
            groupCall.active = true;
            groupCall.callId = data.callId;
            groupCall.groupId = Number(data.groupId);
            groupCall.video = !!data.video;
            groupCall.outgoing = false;
            groupCall.callerId = Number(data.fromUserId);

            await getGroupCallLocalStream(groupCall.video);

            const title = $("groupCallTitle");
            if (title) title.textContent = data.video ? "Gruppen-Videoanruf" : "Gruppen-Sprachanruf";

            const cameraButton = $("groupCallCameraButton");
            if (cameraButton) cameraButton.style.display = groupCall.video ? "inline-block" : "none";

            clearGroupCallVideos();
            showGroupCallOverlay();
            groupCallState("Verbinde...");

            socket.emit("groupCall:accepted", {
                callId: groupCall.callId,
                groupId: groupCall.groupId,
                callerId: groupCall.callerId,
                video: groupCall.video
            });
        } catch (error) {
            console.error("❌ Gruppenanruf konnte nicht angenommen werden:", error);
            endGroupCall(false);
            showDeviceError("Gruppenanruf", error.message || "Mikrofon/Kamera konnte nicht verwendet werden.");
        }
    });

    socket.on("groupCall:accepted", async data => {
        if (!groupCall.active || !groupCall.outgoing) return;
        if (String(data.callId) !== String(groupCall.callId)) return;

        try {
            const pc = await createGroupPeer(data.userId, data.username);
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            socket.emit("groupCall:offer", {
                callId: groupCall.callId,
                groupId: groupCall.groupId,
                toUserId: Number(data.userId),
                video: groupCall.video,
                offer
            });

            groupCallState("Teilnehmer verbunden");
        } catch (error) {
            console.error("❌ Gruppen-Offer:", error);
            closeGroupPeer(data.userId);
        }
    });

    socket.on("groupCall:offer", async data => {
        if (!data?.callId || !groupCall.active) return;
        if (String(data.callId) !== String(groupCall.callId)) return;

        try {
            const pc = await createGroupPeer(data.fromUserId, data.fromUsername);

            await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
            await addGroupPendingIce(data.fromUserId);

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            socket.emit("groupCall:answer", {
                callId: groupCall.callId,
                groupId: groupCall.groupId,
                toUserId: Number(data.fromUserId),
                answer
            });

            groupCallState("Verbunden");
        } catch (error) {
            console.error("❌ Gruppen-Answer:", error);
            closeGroupPeer(data.fromUserId);
        }
    });

    socket.on("groupCall:answer", async data => {
        if (!groupCall.active || String(data.callId) !== String(groupCall.callId)) return;

        const pc = groupCall.peers.get(Number(data.fromUserId));
        if (!pc) return;

        try {
            await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
            await addGroupPendingIce(data.fromUserId);
            groupCallState("Verbunden");
        } catch (error) {
            console.error("❌ Gruppen-Answer empfangen:", error);
        }
    });

    socket.on("groupCall:ice", async data => {
        if (!groupCall.active || String(data.callId) !== String(groupCall.callId)) return;

        const userId = Number(data.fromUserId);
        if (!data.candidate) return;

        const pc = groupCall.peers.get(userId);

        if (!pc || !pc.remoteDescription) {
            const list = groupCall.pendingIce.get(userId) || [];
            list.push(data.candidate);
            groupCall.pendingIce.set(userId, list);
            return;
        }

        try {
            await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (error) {
            console.warn("⚠️ Gruppenanruf ICE:", error);
        }
    });

    socket.on("groupCall:ended", data => {
        if (!groupCall.active) return;
        if (data?.callId && String(data.callId) !== String(groupCall.callId)) return;
        endGroupCall(false);
    });

    socket.on("groupCall:rejected", data => {
        if (!groupCall.active || !groupCall.outgoing) return;
        if (String(data.callId) !== String(groupCall.callId)) return;
        groupCallState(`${data.username || "Ein Mitglied"} hat abgelehnt.`);
        setTimeout(() => {
            if (groupCall.active && groupCall.peers.size === 0) endGroupCall(false);
        }, 1200);
    });

    $("groupCallEndButton")?.addEventListener("click", () => endGroupCall(true));

    $("groupCallMuteButton")?.addEventListener("click", () => {
        const track = groupCall.localStream?.getAudioTracks?.()[0];
        if (!track) return;
        track.enabled = !track.enabled;
        $("groupCallMuteButton").textContent = track.enabled ? "🎤" : "🔇";
    });

    $("groupCallCameraButton")?.addEventListener("click", () => {
        const track = groupCall.localStream?.getVideoTracks?.()[0];
        if (!track) return;
        track.enabled = !track.enabled;
        $("groupCallCameraButton").textContent = track.enabled ? "📷" : "🚫";
    });

})();