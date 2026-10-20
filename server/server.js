// =====================================================
// PRIVLINES SERVER
// =====================================================

const multer = require("multer");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const webPush = require("./webPush");

require("dotenv").config();

const db = require("./database");


// =====================================================
// EXPRESS / HTTP / SOCKET.IO
// =====================================================

const app = express();

const server =
    http.createServer(app);

const io =
    new Server(server, {
        cors: {
            origin: true,
            credentials: true
        }
    });

const PORT =
    process.env.PORT || 3000;


// =====================================================
// PFADE
// =====================================================

const publicPath =
    path.join(
        __dirname,
        "../public"
    );

const imageUploadPath =
    path.join(
        publicPath,
        "uploads",
        "images"
    );

const audioUploadPath = path.join(publicPath, "uploads", "audio");

const profileUploadPath =
    path.join(
        publicPath,
        "uploads",
        "profiles"
    );


// =====================================================
// UPLOAD-ORDNER
// =====================================================

if (
    !fs.existsSync(
        imageUploadPath
    )
) {

    fs.mkdirSync(
        imageUploadPath,
        {
            recursive: true
        }
    );
}

if (
    !fs.existsSync(
        profileUploadPath
    )
) {

    fs.mkdirSync(
        profileUploadPath,
        {
            recursive: true
        }
    );
}


if (!fs.existsSync(audioUploadPath)) fs.mkdirSync(audioUploadPath, { recursive: true });


// =====================================================
// JWT SECRET
// =====================================================

if (
    !process.env.JWT_SECRET
) {

    console.error(
        "❌ JWT_SECRET fehlt in der .env-Datei!"
    );

    process.exit(1);
}


// =====================================================
// MIDDLEWARE
// =====================================================

app.use(
    express.json({
        limit: "1mb"
    })
);

app.use(
    cookieParser()
);

app.use(
    express.static(
        publicPath
    )
);


// =====================================================
// STARTSEITE
// =====================================================

app.get(
    "/",
    (req, res) => {

        res.sendFile(
            path.join(
                publicPath,
                "index.html"
            )
        );
    }
);


// =====================================================
// AUTHENTIFIZIERUNG
// =====================================================

function authenticateToken(
    req,
    res,
    next
) {

    const token =
        req.cookies.session;

    if (!token) {

        return res.status(401).json({
            error:
                "Nicht eingeloggt"
        });
    }

    try {

        const user =
            jwt.verify(
                token,
                process.env.JWT_SECRET
            );

        req.user =
            user;

        next();

    } catch (error) {

        return res.status(401).json({
            error:
                "Ungültige Sitzung"
        });
    }
}


// =====================================================
// EDITION / USER-TABELLE
// =====================================================

function isSchoolUser(
    req
) {

    return (
        req.user?.mode ===
        "school"
    );
}


function getUserTable(
    req
) {

    return isSchoolUser(req)
        ? "school_users"
        : "users";
}


// =====================================================
// HINTERGRUND-PUSH
// =====================================================

app.get("/api/push/public-key", (req, res) => {
    const keys = webPush.getKeys();
    if (!keys) return res.status(503).json({ error: "Push ist auf dem Server noch nicht eingerichtet." });
    return res.json({ publicKey: keys.publicKey.toString("base64url") });
});

app.post("/api/push/subscribe", authenticateToken, async (req, res) => {
    try {
        const subscription = req.body?.subscription;
        const endpoint = typeof subscription?.endpoint === "string" ? subscription.endpoint : "";
        const p256dh = subscription?.keys?.p256dh;
        const auth = subscription?.keys?.auth;
        if (!endpoint.startsWith("https://") || endpoint.length > 2048 || typeof p256dh !== "string" || typeof auth !== "string") {
            return res.status(400).json({ error: "Ungültiges Push-Abonnement." });
        }
        const endpointHash = crypto.createHash("sha256").update(endpoint).digest("hex");
        await db.execute(`
            INSERT INTO push_subscriptions (user_id, mode, endpoint, endpoint_hash, p256dh, auth)
            VALUES (?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE user_id=VALUES(user_id), mode=VALUES(mode), p256dh=VALUES(p256dh), auth=VALUES(auth)
        `, [Number(req.user.userId), req.user.mode === "school" ? "school" : "standard", endpoint, endpointHash, p256dh, auth]);
        return res.json({ success: true });
    } catch (error) {
        console.error("Push-Abonnement konnte nicht gespeichert werden:", error.message);
        return res.status(500).json({ error: "Push-Abonnement konnte nicht gespeichert werden." });
    }
});

app.delete("/api/push/subscribe", authenticateToken, async (req, res) => {
    try {
        const endpoint = req.body?.endpoint;
        if (typeof endpoint !== "string" || endpoint.length > 2048) return res.status(400).json({ error: "Ungültiger Endpunkt." });
        await db.execute("DELETE FROM push_subscriptions WHERE endpoint=? AND user_id=? AND mode=?", [endpoint, Number(req.user.userId), req.user.mode === "school" ? "school" : "standard"]);
        return res.json({ success: true });
    } catch (error) {
        console.error("Push-Abonnement konnte nicht entfernt werden:", error.message);
        return res.status(500).json({ error: "Push-Abonnement konnte nicht entfernt werden." });
    }
});

async function pushToUser(userId, mode, payload) {
    if (!webPush.getKeys()) return;
    try {
        const [subscriptions] = await db.execute(
            "SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id=? AND mode=?",
            [Number(userId), mode === "school" ? "school" : "standard"]
        );
        await Promise.all(subscriptions.map(async subscription => {
            try {
                const result = await webPush.sendPush({ ...subscription, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, payload);
                if ([404, 410].includes(result.status)) {
                    await db.execute("DELETE FROM push_subscriptions WHERE endpoint=?", [subscription.endpoint]);
                }
            } catch (error) {
                console.warn("Push-Benachrichtigung fehlgeschlagen:", error.message);
            }
        }));
    } catch (error) {
        console.warn("Push-Abonnements konnten nicht geladen werden:", error.message);
    }
}


// =====================================================
// BLOCKIERUNG
// =====================================================

async function areUsersBlocked(
    userA,
    userB
) {

    const [rows] =
        await db.execute(
            `
            SELECT id
            FROM blocked_users
            WHERE
                (
                    blocker_id = ?
                    AND blocked_id = ?
                )
                OR
                (
                    blocker_id = ?
                    AND blocked_id = ?
                )
            LIMIT 1
            `,
            [
                userA,
                userB,
                userB,
                userA
            ]
        );

    return rows.length > 0;
}


// =====================================================
// CHAT ERSTELLEN / FINDEN
// =====================================================

async function getOrCreateChat(userA, userB, mode = "standard") {

    const user1 = Math.min(Number(userA), Number(userB));
    const user2 = Math.max(Number(userA), Number(userB));
    const chatMode = mode === "school" ? "school" : "standard";

    const [existing] = await db.execute(`
        SELECT id FROM chats
        WHERE user1_id = ? AND user2_id = ? AND mode = ?
        LIMIT 1
    `, [user1, user2, chatMode]);

    if (existing.length > 0) return Number(existing[0].id);

    try {
        const [result] = await db.execute(`
            INSERT INTO chats (user1_id, user2_id, mode)
            VALUES (?, ?, ?)
        `, [user1, user2, chatMode]);
        return Number(result.insertId);
    } catch (error) {
        if (error?.code === "ER_DUP_ENTRY") {
            const [retry] = await db.execute(`
                SELECT id FROM chats
                WHERE user1_id = ? AND user2_id = ? AND mode = ?
                LIMIT 1
            `, [user1, user2, chatMode]);
            if (retry.length > 0) return Number(retry[0].id);
        }
        throw error;
    }
}


// =====================================================
// MULTER STORAGE
// =====================================================

const profileStorage =
    multer.diskStorage({

        destination:
            (req, file, cb) => {

                cb(
                    null,
                    profileUploadPath
                );
            },

        filename:
            (req, file, cb) => {

                const extension =
                    path.extname(
                        file.originalname
                    ).toLowerCase();

                const filename =
                    `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${extension}`;

                cb(
                    null,
                    filename
                );
            }
    });


const imageStorage =
    multer.diskStorage({

        destination:
            (req, file, cb) => {

                cb(
                    null,
                    imageUploadPath
                );
            },

        filename:
            (req, file, cb) => {

                const extension =
                    path.extname(
                        file.originalname
                    ).toLowerCase();

                const filename =
                    `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${extension}`;

                cb(
                    null,
                    filename
                );
            }
    });


// =====================================================
// DATEITYPEN
// =====================================================

function imageFileFilter(
    req,
    file,
    cb
) {

    const allowedTypes = [
        "image/jpeg",
        "image/png",
        "image/gif",
        "image/webp"
    ];

    if (
        allowedTypes.includes(
            file.mimetype
        )
    ) {

        cb(
            null,
            true
        );

    } else {

        cb(
            new Error(
                "Nur JPG, PNG, GIF und WebP sind erlaubt."
            )
        );
    }
}


// =====================================================
// UPLOADS
// =====================================================

const uploadProfile =
    multer({
        storage:
            profileStorage,

        limits: {
            fileSize:
                10 * 1024 * 1024
        },

        fileFilter:
            imageFileFilter
    });


const uploadImage =
    multer({
        storage:
            imageStorage,

        limits: {
            fileSize:
                10 * 1024 * 1024
        },

        fileFilter:
            imageFileFilter
    });
function chatMediaFileFilter(req, file, cb) {
    const allowedTypes = [
        "image/jpeg", "image/png", "image/gif", "image/webp",
        "video/mp4", "video/webm", "video/ogg", "video/quicktime"
    ];

    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error("Nur JPG, PNG, GIF, WebP und unterstützte Videoformate sind erlaubt."));
    }
}

const uploadChatMedia = multer({
    storage: imageStorage,
    limits: { fileSize: 100 * 1024 * 1024 },
    fileFilter: chatMediaFileFilter
});

// Medien für Gruppen: Bilder, Videos und Audiodateien.
const voiceStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, audioUploadPath),
    filename: (req, file, cb) => {
        const extensions = { 'audio/webm': '.webm', 'audio/ogg': '.ogg', 'audio/mp4': '.m4a', 'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/x-wav': '.wav', 'audio/aac': '.aac' };
        const extension = extensions[file.mimetype] || path.extname(file.originalname || '').toLowerCase() || '.webm';
        cb(null, `${Date.now()}-${crypto.randomBytes(10).toString('hex')}${extension}`);
    }
});
const uploadVoiceMessage = multer({
    storage: voiceStorage,
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/aac'];
        cb(allowed.includes(file.mimetype) ? null : new Error('Dieses Audioformat wird nicht unterstützt.'), allowed.includes(file.mimetype));
    }
});

const groupMediaStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, imageUploadPath),
    filename: (req, file, cb) => {
        const extension = path.extname(file.originalname || "").toLowerCase() || ".bin";
        cb(null, `${Date.now()}-${crypto.randomBytes(10).toString("hex")}${extension}`);
    }
});

function groupMediaFileFilter(req, file, cb) {
    const allowed = [
        "image/jpeg", "image/png", "image/gif", "image/webp",
        "video/mp4", "video/webm", "video/ogg", "video/quicktime",
        "audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav", "audio/x-wav"
    ];
    cb(allowed.includes(file.mimetype) ? null : new Error("Dateityp wird für Gruppenmedien nicht unterstützt."), allowed.includes(file.mimetype));
}

const groupMediaUpload = multer({
    storage: groupMediaStorage,
    limits: { fileSize: 100 * 1024 * 1024 },
    fileFilter: groupMediaFileFilter
});


// =====================================================
// PROFILBILD HOCHLADEN
// =====================================================

app.post(
    "/api/profile-picture",
    authenticateToken,
    uploadProfile.fields([
        { name: "profilePicture", maxCount: 1 },
        { name: "image", maxCount: 1 }
    ]),
    async (req, res) => {

        try {

            const uploadedFile =
                req.files?.profilePicture?.[0] ||
                req.files?.image?.[0] ||
                null;

            if (!uploadedFile) {
                return res.status(400).json({
                    error: "Kein Bild ausgewählt."
                });
            }

            req.file = uploadedFile;

            const userId =
                Number(
                    req.user.userId
                );

            const table =
                getUserTable(req);

            const profilePicture =
                `/uploads/profiles/${req.file.filename}`;

            const [users] =
                await db.execute(
                    `
                    SELECT
                        id,
                        profile_picture
                    FROM ${table}
                    WHERE id = ?
                    LIMIT 1
                    `,
                    [
                        userId
                    ]
                );

            if (
                users.length === 0
            ) {

                try {
                    fs.unlinkSync(
                        req.file.path
                    );
                } catch (_) {}

                return res.status(404).json({
                    error:
                        "Benutzer nicht gefunden."
                });
            }

            const oldPicture =
                users[0].profile_picture;

            await db.execute(
                `
                UPDATE ${table}
                SET profile_picture = ?
                WHERE id = ?
                `,
                [
                    profilePicture,
                    userId
                ]
            );

            if (
                oldPicture &&
                oldPicture.startsWith(
                    "/uploads/profiles/"
                )
            ) {

                const oldFile =
                    path.join(
                        publicPath,
                        oldPicture
                            .replace(
                                "/uploads/",
                                "uploads/"
                            )
                    );

                if (
                    fs.existsSync(
                        oldFile
                    )
                ) {

                    try {
                        fs.unlinkSync(
                            oldFile
                        );
                    } catch (_) {}
                }
            }

            const profilePayload = { userId:Number(userId), profilePicture:profilePicture };
            io.to(`user-${userId}`).emit("profilePictureChanged", profilePayload);
            try {
                const [friendRows] = await db.execute(`
                    SELECT CASE WHEN sender_id=? THEN receiver_id ELSE sender_id END AS friendId
                    FROM friend_requests
                    WHERE status='accepted' AND mode=? AND (sender_id=? OR receiver_id=?)
                `,[userId, req.user.mode === "school" ? "school" : "standard", userId, userId]);
                for (const friend of friendRows) {
                    if (friend.friendId) io.to(`user-${Number(friend.friendId)}`).emit("profilePictureChanged", profilePayload);
                }
            } catch (_) {}

            return res.json({
                success:
                    true,

                profilePicture:
                    profilePicture
            });

        } catch (error) {

            console.error(
                "❌ Profilbild-Fehler:",
                error
            );

            if (req.file) {

                try {
                    fs.unlinkSync(
                        req.file.path
                    );
                } catch (_) {}
            }

            return res.status(500).json({
                error:
                    "Profilbild konnte nicht gespeichert werden."
            });
        }
    }
);


// =====================================================
// BILD-NACHRICHT HOCHLADEN
// =====================================================

app.post(
    "/api/upload",
    authenticateToken,
    uploadChatMedia.single("media"),
    async (req, res) => {

        try {

            if (
                req.user.mode ===
                "school"
            ) {

                if (req.file) {

                    try {
                        fs.unlinkSync(
                            req.file.path
                        );
                    } catch (_) {}
                }

                return res.status(403).json({
                    error:
                        "Medien-Uploads sind in der School Edition nicht verfügbar."
                });
            }

            if (!req.file) {

                return res.status(400).json({
                    error:
                        "Keine Datei ausgewählt."
                });
            }

            const userId =
                Number(
                    req.user.userId
                );

            const chatId =
                Number(
                    req.body?.chatId
                );

            if (
                !Number.isInteger(chatId) ||
                chatId <= 0
            ) {

                try {
                    fs.unlinkSync(
                        req.file.path
                    );
                } catch (_) {}

                return res.status(400).json({
                    error:
                        "Ungültige Chat-ID."
                });
            }

            const [chats] =
                await db.execute(
                    `
                    SELECT
                        id,
                        user1_id,
                        user2_id,
                        mode
                    FROM chats
                    WHERE
                        id = ?
                        AND mode = ?
                        AND (
                            user1_id = ?
                            OR user2_id = ?
                        )
                    LIMIT 1
                    `,
                    [
                        chatId,
                        req.user.mode === "school" ? "school" : "standard",
                        userId,
                        userId
                    ]
                );

            if (
                chats.length === 0
            ) {

                try {
                    fs.unlinkSync(
                        req.file.path
                    );
                } catch (_) {}

                return res.status(403).json({
                    error:
                        "Kein Zugriff auf diesen Chat."
                });
            }

            const chat =
                chats[0];

            const receiverId =
                Number(
                    chat.user1_id
                ) === userId
                    ? Number(
                        chat.user2_id
                    )
                    : Number(
                        chat.user1_id
                    );

            const blocked =
                await areUsersBlocked(
                    userId,
                    receiverId
                );

            const mediaUrl =
                `/uploads/images/${req.file.filename}`;
            const messageType =
                req.file.mimetype.startsWith("video/")
                    ? "video"
                    : "image";

            const [result] =
                await db.execute(
                    `
                    INSERT INTO messages
                    (
                        chat_id,
                        sender_id,
                        message,
                        message_type,
                        media_url
                    )
                    VALUES (?, ?, ?, ?, ?)
                    `,
                    [
                        chatId,
                        userId,
                        "",
                        messageType,
                        mediaUrl
                    ]
                );

            const message = {

                id:
                    result.insertId,

                chatId:
                    chatId,

                senderId:
                    userId,

                username:
                    req.user.username,

                text:
                    "",

                messageType: messageType,

                mediaUrl:
                    mediaUrl,

                createdAt:
                    new Date()
            };

            if (blocked) {

                return res.json({
                    success:
                        true,

                    blocked:
                        true,

                    message:
                        message
                });
            }

            io.to(
                `chat-${chatId}`
            ).emit(
                "chatMessage",
                message
            );

            io.to(
                `user-${receiverId}`
            ).emit(
                "newMessageNotification",
                {
                    chatId:
                        chatId,

                    senderId:
                        userId,

                    senderUsername:
                        req.user.username,

                    text:
                        messageType === "video" ? "🎥 Video" : "📷 Bild"
                }
            );
            if (!io.sockets.adapter.rooms.get(`user-${receiverId}`)?.size) {
                void pushToUser(receiverId, req.user.mode, {
                    title: req.user.username || "PrivLines",
                    body: "Du hast eine neue Nachricht in PrivLines.",
                    url: "/chat.html"
                });
            }

            return res.json({
                success:
                    true,

                blocked:
                    false,

                message:
                    message
            });

        } catch (error) {

            console.error(
                "❌ Upload-Fehler:",
                error
            );

            if (req.file) {

                try {
                    fs.unlinkSync(
                        req.file.path
                    );
                } catch (_) {}
            }

            return res.status(500).json({
                error:
                    "Bild konnte nicht hochgeladen werden."
            });
        }
    }
);


app.post("/api/upload/audio", authenticateToken, uploadVoiceMessage.single("audio"), async (req, res) => {
    try {
        if (req.user.mode === "school") {
            if (req.file) fs.unlink(req.file.path, () => {});
            return res.status(403).json({ error: "Sprachnachrichten sind in der School Edition nicht verfügbar." });
        }
        if (!req.file) return res.status(400).json({ error: "Keine Audiodatei empfangen." });
        const userId = Number(req.user.userId);
        const chatId = Number(req.body?.chatId);
        if (!Number.isInteger(chatId) || chatId <= 0) {
            fs.unlink(req.file.path, () => {});
            return res.status(400).json({ error: "Ungültige Chat-ID." });
        }
        const [chats] = await db.execute(`
            SELECT id, user1_id, user2_id FROM chats
            WHERE id=? AND mode='standard' AND (user1_id=? OR user2_id=?) LIMIT 1
        `, [chatId, userId, userId]);
        if (!chats.length) {
            fs.unlink(req.file.path, () => {});
            return res.status(403).json({ error: "Kein Zugriff auf diesen Chat." });
        }
        const receiverId = Number(chats[0].user1_id) === userId ? Number(chats[0].user2_id) : Number(chats[0].user1_id);
        const mediaUrl = `/uploads/audio/${req.file.filename}`;
        const [result] = await db.execute(`
            INSERT INTO messages (chat_id, sender_id, message, message_type, media_url)
            VALUES (?, ?, '', 'voice', ?)
        `, [chatId, userId, mediaUrl]);
        const message = {
            id: result.insertId, chatId, senderId: userId,
            username: req.user.username,
            displayName: req.user.displayName || req.user.username,
            text: '', messageType: 'voice', mediaUrl, createdAt: new Date()
        };
        if (await areUsersBlocked(userId, receiverId)) return res.json({ success: true, blocked: true, message });
        io.to(`chat-${chatId}`).emit('chatMessage', message);
        io.to(`user-${receiverId}`).emit('newMessageNotification', {
            chatId, senderId: userId, senderUsername: req.user.username,
            senderDisplayName: req.user.displayName || req.user.username, text: '🎙️ Sprachnachricht'
        });
        if (!io.sockets.adapter.rooms.get(`user-${receiverId}`)?.size) {
            void pushToUser(receiverId, 'standard', {
                title: req.user.displayName || req.user.username || 'PrivLines',
                body: 'Du hast eine neue Sprachnachricht in PrivLines.', url: '/chat.html'
            });
        }
        return res.json({ success: true, blocked: false, message });
    } catch (error) {
        console.error('❌ Sprachnachricht-Upload-Fehler:', error);
        if (req.file) fs.unlink(req.file.path, () => {});
        return res.status(500).json({ error: 'Sprachnachricht konnte nicht gespeichert werden.' });
    }
});

async function usernameExistsAnywhere(username, excludeMode = null, excludeId = null) {
    const checks = [
        ["users", "standard"],
        ["school_users", "school"]
    ];
    for (const [table, mode] of checks) {
        let sql = `SELECT id FROM ${table} WHERE username = ?`;
        const params = [username];
        if (excludeMode === mode && excludeId) {
            sql += " AND id <> ?";
            params.push(excludeId);
        }
        sql += " LIMIT 1";
        const [rows] = await db.execute(sql, params);
        if (rows.length) return true;
    }
    return false;
}


// =====================================================
// STANDARD REGISTRIERUNG
// =====================================================

app.post(
    "/api/register",
    async (req, res) => {

        try {

            const username =
                typeof req.body?.username ===
                "string"
                    ? req.body.username.trim()
                    : "";

            const password =
                typeof req.body?.password ===
                "string"
                    ? req.body.password
                    : "";

            const displayName =
                typeof req.body?.displayName === "string" && req.body.displayName.trim()
                    ? req.body.displayName.trim()
                    : username;

            if (
                !username ||
                !password
            ) {

                return res.status(400).json({
                    error:
                        "Benutzername und Passwort erforderlich."
                });
            }

            if (
                username.length < 3
            ) {

                return res.status(400).json({
                    error:
                        "Der Benutzername muss mindestens 3 Zeichen lang sein."
                });
            }

            if (
                password.length < 6
            ) {

                return res.status(400).json({
                    error:
                        "Das Passwort muss mindestens 6 Zeichen lang sein."
                });
            }

            const usernameTaken = await usernameExistsAnywhere(username);

            if (usernameTaken) {

                return res.status(409).json({
                    error:
                        "Dieser Benutzername ist bereits vergeben."
                });
            }

            const passwordHash =
                await bcrypt.hash(
                    password,
                    12
                );

            const [result] =
                await db.execute(
                    `
                    INSERT INTO users
                    (
                        username,
                        display_name,
                        password_hash
                    )
                    VALUES (?, ?, ?)
                    `,
                    [
                        username,
                        displayName,
                        passwordHash
                    ]
                );

            return res.json({
                success:
                    true,

                userId:
                    result.insertId,

                username:
                    username
            });

        } catch (error) {

            console.error(
                "❌ Registrierungsfehler:",
                error
            );

            return res.status(500).json({
                error:
                    "Registrierung fehlgeschlagen."
            });
        }
    }
);


// =====================================================
// SCHOOL REGISTRIERUNG
// =====================================================

app.post(
    "/api/school-register",
    async (req, res) => {

        try {

            const username =
                typeof req.body?.username ===
                "string"
                    ? req.body.username.trim()
                    : "";

            const password =
                typeof req.body?.password ===
                "string"
                    ? req.body.password
                    : "";

            const displayName =
                typeof req.body?.displayName === "string" && req.body.displayName.trim()
                    ? req.body.displayName.trim()
                    : username;

            if (
                !username ||
                !password
            ) {

                return res.status(400).json({
                    error:
                        "Benutzername und Passwort erforderlich."
                });
            }

            const usernameTaken = await usernameExistsAnywhere(username);

            if (usernameTaken) {

                return res.status(409).json({
                    error:
                        "Dieser Schul-Benutzername ist bereits vergeben."
                });
            }

            const passwordHash =
                await bcrypt.hash(
                    password,
                    12
                );

            const [result] =
                await db.execute(
                    `
                    INSERT INTO school_users
                    (
                        username,
                        display_name,
                        password_hash
                    )
                    VALUES (?, ?, ?)
                    `,
                    [
                        username,
                        displayName,
                        passwordHash
                    ]
                );

            return res.json({
                success:
                    true,

                userId:
                    result.insertId,

                username:
                    username,

                mode:
                    "school"
            });

        } catch (error) {

            console.error(
                "❌ School-Registrierungsfehler:",
                error
            );

            return res.status(500).json({
                error:
                    "School-Registrierung fehlgeschlagen."
            });
        }
    }
);


// =====================================================
// STANDARD LOGIN
// =====================================================

app.post(
    "/api/login",
    async (req, res) => {

        try {

            const username =
                typeof req.body?.username ===
                "string"
                    ? req.body.username.trim()
                    : "";

            const password =
                typeof req.body?.password ===
                "string"
                    ? req.body.password
                    : "";

            if (
                !username ||
                !password
            ) {

                return res.status(400).json({
                    error:
                        "Benutzername und Passwort erforderlich."
                });
            }

            const [users] =
                await db.execute(
                    `
                    SELECT
                        id,
                        username,
                        display_name,
                        password_hash
                    FROM users
                    WHERE username = ?
                    LIMIT 1
                    `,
                    [
                        username
                    ]
                );

            if (
                users.length === 0
            ) {

                return res.status(401).json({
                    error:
                        "Benutzername oder Passwort ist falsch."
                });
            }

            const user =
                users[0];

            const passwordCorrect =
                await bcrypt.compare(
                    password,
                    user.password_hash
                );

            if (
                !passwordCorrect
            ) {

                return res.status(401).json({
                    error:
                        "Benutzername oder Passwort ist falsch."
                });
            }

            const token =
                jwt.sign(
                    {
                        userId:
                            user.id,

                        username:
                            user.username,

                        mode:
                            "standard"
                    },
                    process.env.JWT_SECRET,
                    {
                        expiresIn:
                            "7d"
                    }
                );

            res.cookie(
                "session",
                token,
                {
                    httpOnly:
                        true,

                    sameSite:
                        "lax",

                    secure:
                        false,

                    maxAge:
                        7 * 24 * 60 * 60 * 1000,

                    path:
                        "/"
                }
            );

            return res.json({
                success:
                    true,

                message:
                    "Login erfolgreich.",

                username:
                    user.username,

                displayName:
                    user.display_name || user.username,

                userId:
                    user.id,

                mode:
                    "standard"
            });

        } catch (error) {

            console.error(
                "❌ Login-Fehler:",
                error
            );

            return res.status(500).json({
                error:
                    "Interner Serverfehler."
            });
        }
    }
);


// =====================================================
// SCHOOL LOGIN
// =====================================================

app.post(
    "/api/school-login",
    async (req, res) => {

        try {

            const username =
                typeof req.body?.username ===
                "string"
                    ? req.body.username.trim()
                    : "";

            const password =
                typeof req.body?.password ===
                "string"
                    ? req.body.password
                    : "";

            if (
                !username ||
                !password
            ) {

                return res.status(400).json({
                    error:
                        "Benutzername und Passwort erforderlich."
                });
            }

            const [users] =
                await db.execute(
                    `
                    SELECT
                        id,
                        username,
                        display_name,
                        password_hash
                    FROM school_users
                    WHERE username = ?
                    LIMIT 1
                    `,
                    [
                        username
                    ]
                );

            if (
                users.length === 0
            ) {

                return res.status(401).json({
                    error:
                        "Benutzername oder Passwort ist falsch."
                });
            }

            const user =
                users[0];

            const passwordCorrect =
                await bcrypt.compare(
                    password,
                    user.password_hash
                );

            if (
                !passwordCorrect
            ) {

                return res.status(401).json({
                    error:
                        "Benutzername oder Passwort ist falsch."
                });
            }

            const token =
                jwt.sign(
                    {
                        userId:
                            user.id,

                        username:
                            user.username,

                        mode:
                            "school"
                    },
                    process.env.JWT_SECRET,
                    {
                        expiresIn:
                            "7d"
                    }
                );

            res.cookie(
                "session",
                token,
                {
                    httpOnly:
                        true,

                    sameSite:
                        "lax",

                    secure:
                        false,

                    maxAge:
                        7 * 24 * 60 * 60 * 1000,

                    path:
                        "/"
                }
            );

            return res.json({
                success:
                    true,

                message:
                    "Schul-Login erfolgreich.",

                username:
                    user.username,

                displayName:
                    user.display_name || user.username,

                userId:
                    user.id,

                mode:
                    "school"
            });

        } catch (error) {

            console.error(
                "❌ School Login Fehler:",
                error
            );

            return res.status(500).json({
                error:
                    "Interner Serverfehler."
            });
        }
    }
);


// =====================================================
// LOGOUT
// =====================================================


app.delete("/api/account", authenticateToken, async (req,res) => {
    if (req.body?.confirm !== "LÖSCHEN") return res.status(400).json({error:"Bestätigung fehlt."});
    const userId = Number(req.user.userId);
    const mode = req.user.mode === "school" ? "school" : "standard";
    const table = mode === "school" ? "school_users" : "users";
    const conn = await db.getConnection();
    let oldProfilePicture = null;
    try {
        const [profileRows] = await conn.query(`SELECT profile_picture AS profilePicture FROM ${table} WHERE id=? LIMIT 1`, [userId]);
        oldProfilePicture = profileRows[0]?.profilePicture || null;
        await conn.beginTransaction();
        if (mode === "standard") {
            const [ownedGroups] = await conn.query(`SELECT id FROM priv_groups WHERE owner_id=?`, [userId]);
            for (const g of ownedGroups) {
                await conn.query(`DELETE FROM group_messages WHERE group_id=?`, [g.id]);
                await conn.query(`DELETE FROM group_members WHERE group_id=?`, [g.id]);
                await conn.query(`DELETE FROM priv_groups WHERE id=?`, [g.id]);
            }
            await conn.query(`DELETE FROM group_members WHERE user_id=?`, [userId]);
            await conn.query(`DELETE FROM blocked_users WHERE blocker_id=? OR blocked_id=?`, [userId,userId]);
            await conn.query(`DELETE FROM friend_requests WHERE mode='standard' AND (sender_id=? OR receiver_id=?)`, [userId,userId]);
            const [chats] = await conn.query(`SELECT id FROM chats WHERE mode='standard' AND (user1_id=? OR user2_id=?)`, [userId,userId]);
            for (const c of chats) await conn.query(`DELETE FROM messages WHERE chat_id=?`, [c.id]);
            await conn.query(`DELETE FROM chats WHERE mode='standard' AND (user1_id=? OR user2_id=?)`, [userId,userId]);
        } else {
            const [ownedSchools] = await conn.query(`SELECT id FROM schools WHERE created_by=?`, [userId]);
            for (const school of ownedSchools) {
                const [members] = await conn.query(`SELECT user_id AS userId FROM school_members WHERE school_id=? AND user_id<>? ORDER BY id ASC LIMIT 1`, [school.id,userId]);
                if (members.length) {
                    await conn.query(`UPDATE school_members SET role='member' WHERE school_id=?`, [school.id]);
                    await conn.query(`UPDATE school_members SET role='owner' WHERE school_id=? AND user_id=?`, [school.id,members[0].userId]);
                    await conn.query(`UPDATE schools SET created_by=? WHERE id=?`, [members[0].userId,school.id]);
                } else {
                    await conn.query(`DELETE FROM school_messages WHERE school_id=?`, [school.id]);
                    await conn.query(`DELETE FROM school_members WHERE school_id=?`, [school.id]);
                    await conn.query(`DELETE FROM schools WHERE id=?`, [school.id]);
                }
            }
            await conn.query(`DELETE FROM school_members WHERE user_id=?`, [userId]);
            await conn.query(`DELETE FROM friend_requests WHERE mode='school' AND (sender_id=? OR receiver_id=?)`, [userId,userId]);
            const [chats] = await conn.query(`SELECT id FROM chats WHERE mode='school' AND (user1_id=? OR user2_id=?)`, [userId,userId]);
            for (const c of chats) await conn.query(`DELETE FROM messages WHERE chat_id=?`, [c.id]);
            await conn.query(`DELETE FROM chats WHERE mode='school' AND (user1_id=? OR user2_id=?)`, [userId,userId]);
        }
        await conn.query(`DELETE FROM ${table} WHERE id=?`, [userId]);
        await conn.commit();
        if (oldProfilePicture && oldProfilePicture.startsWith("/uploads/profiles/")) {
            const oldFile = path.join(publicPath, oldProfilePicture.replace("/uploads/", "uploads/"));
            try { if (fs.existsSync(oldFile)) fs.unlinkSync(oldFile); } catch (_) {}
        }
        res.clearCookie("session", {path:"/"});
        return res.json({success:true});
    } catch(error) {
        try { await conn.rollback(); } catch (_) {}
        console.error("❌ Account-Löschung:", error);
        return res.status(500).json({error:"Der Account konnte nicht vollständig gelöscht werden."});
    } finally { conn.release(); }
});

app.post(
    "/api/logout",
    (req, res) => {

        res.clearCookie(
            "session",
            {
                httpOnly:
                    true,

                sameSite:
                    "lax",

                secure:
                    false,

                path:
                    "/"
            }
        );

        return res.json({
            success:
                true
        });
    }
);


// =====================================================
// AKTUELLER BENUTZER
// =====================================================

app.get(
    "/api/me",
    authenticateToken,
    async (req, res) => {

        try {

            const isSchool =
                req.user.mode ===
                "school";

            const table =
                isSchool
                    ? "school_users"
                    : "users";

            const [users] =
                await db.execute(
                    `
                    SELECT
                        id,
                        username,
                        display_name,
                        profile_picture
                    FROM ${table}
                    WHERE id = ?
                    LIMIT 1
                    `,
                    [
                        req.user.userId
                    ]
                );

            if (
                users.length === 0
            ) {

                return res.status(404).json({
                    error:
                        "Benutzer nicht gefunden."
                });
            }

            const user =
                users[0];

            return res.json({

                userId:
                    user.id,

                username:
                    user.username,

                displayName:
                    user.display_name || user.username,

                profilePicture:
                    user.profile_picture ||
                    null,

                mode:
                    isSchool
                        ? "school"
                        : "standard"
            });

        } catch (error) {

            console.error(
                "❌ /api/me Fehler:",
                error
            );

            return res.status(500).json({
                error:
                    "Benutzerdaten konnten nicht geladen werden."
            });
        }
    }
);



// =====================================================
// PROFILÄNDERUNG LIVE AN FREUNDE VERTEILEN
// =====================================================

async function emitProfileUpdated(userId, mode, username, displayName) {
    try {
        const [friends] = await db.execute(`
            SELECT
                CASE
                    WHEN sender_id = ? THEN receiver_id
                    ELSE sender_id
                END AS friendId
            FROM friend_requests
            WHERE status = 'accepted'
              AND mode = ?
              AND (sender_id = ? OR receiver_id = ?)
        `, [userId, mode, userId, userId]);

        const payload = {
            userId: Number(userId),
            username: username || "Unbekannt",
            displayName: displayName || username || "Unbekannt",
            mode
        };

        io.to(`user-${Number(userId)}`).emit("profileUpdated", payload);
        for (const friend of friends) {
            if (friend.friendId) {
                io.to(`user-${Number(friend.friendId)}`).emit("profileUpdated", payload);
            }
        }
    } catch (error) {
        console.error("❌ Live-Profilupdate-Fehler:", error);
    }
}

// =====================================================
// BENUTZERNAME ÄNDERN
// =====================================================

app.post(
    "/api/change-username",
    authenticateToken,
    async (req, res) => {

        try {

            const username =
                typeof req.body?.username ===
                "string"
                    ? req.body.username.trim()
                    : "";

            if (
                username.length < 3
            ) {

                return res.status(400).json({
                    error:
                        "Der Benutzername muss mindestens 3 Zeichen lang sein."
                });
            }

            const table =
                getUserTable(req);

            const userId =
                Number(
                    req.user.userId
                );

            const usernameTaken = await usernameExistsAnywhere(username, req.user.mode === "school" ? "school" : "standard", userId);

            if (usernameTaken) {

                return res.status(409).json({
                    error:
                        "Dieser Benutzername ist bereits vergeben."
                });
            }

            await db.execute(
                `
                UPDATE ${table}
                SET username = ?
                WHERE id = ?
                `,
                [
                    username,
                    userId
                ]
            );

            const [updatedUserRows] = await db.execute(
                `SELECT username, display_name AS displayName FROM ${table} WHERE id = ? LIMIT 1`,
                [userId]
            );
            const updatedUser = updatedUserRows[0] || {};
            await emitProfileUpdated(
                userId,
                req.user.mode === "school" ? "school" : "standard",
                updatedUser.username || username,
                updatedUser.displayName || updatedUser.username || username
            );

            const token =
                jwt.sign(
                    {
                        userId:
                            userId,

                        username:
                            username,

                        mode:
                            req.user.mode ||
                            "standard"
                    },
                    process.env.JWT_SECRET,
                    {
                        expiresIn:
                            "7d"
                    }
                );

            res.cookie(
                "session",
                token,
                {
                    httpOnly:
                        true,

                    sameSite:
                        "lax",

                    secure:
                        false,

                    maxAge:
                        7 * 24 * 60 * 60 * 1000,

                    path:
                        "/"
                }
            );

            return res.json({
                success:
                    true,

                username:
                    username
            });

        } catch (error) {

            console.error(
                "❌ Username-Änderungsfehler:",
                error
            );

            return res.status(500).json({
                error:
                    "Benutzername konnte nicht geändert werden."
            });
        }
    }
);


// =====================================================
// PASSWORT ÄNDERN
// =====================================================

app.post(
    "/api/change-password",
    authenticateToken,
    async (req, res) => {

        try {

            const oldPassword =
                typeof req.body?.oldPassword ===
                "string"
                    ? req.body.oldPassword
                    : "";

            const newPassword =
                typeof req.body?.newPassword ===
                "string"
                    ? req.body.newPassword
                    : "";

            if (
                !oldPassword ||
                !newPassword
            ) {

                return res.status(400).json({
                    error:
                        "Altes und neues Passwort erforderlich."
                });
            }

            if (
                newPassword.length < 6
            ) {

                return res.status(400).json({
                    error:
                        "Das neue Passwort muss mindestens 6 Zeichen lang sein."
                });
            }

            const table =
                getUserTable(req);

            const [users] =
                await db.execute(
                    `
                    SELECT
                        id,
                        password_hash
                    FROM ${table}
                    WHERE id = ?
                    LIMIT 1
                    `,
                    [
                        req.user.userId
                    ]
                );

            if (
                users.length === 0
            ) {

                return res.status(404).json({
                    error:
                        "Benutzer nicht gefunden."
                });
            }

            const correct =
                await bcrypt.compare(
                    oldPassword,
                    users[0].password_hash
                );

            if (
                !correct
            ) {

                return res.status(401).json({
                    error:
                        "Das alte Passwort ist falsch."
                });
            }

            const newHash =
                await bcrypt.hash(
                    newPassword,
                    12
                );

            await db.execute(
                `
                UPDATE ${table}
                SET password_hash = ?
                WHERE id = ?
                `,
                [
                    newHash,
                    req.user.userId
                ]
            );

            return res.json({
                success:
                    true,

                message:
                    "Passwort erfolgreich geändert."
            });

        } catch (error) {

            console.error(
                "❌ Passwort-Änderungsfehler:",
                error
            );

            return res.status(500).json({
                error:
                    "Passwort konnte nicht geändert werden."
            });
        }
    }
);


// =====================================================
// SCHOOL-KANAL CODES
// =====================================================

const SCHOOL_CODE_ROTATION_HOURS = Math.max(
    1,
    Number(process.env.SCHOOL_CODE_ROTATION_HOURS || 1)
);

function createSchoolCode() {
    return crypto
        .randomBytes(6)
        .toString("hex")
        .toUpperCase()
        .match(/.{1,4}/g)
        .join("-");
}

async function ensureSchoolChannelSystem() {
    // Die bestehenden Tabellen werden nicht ersetzt.
    // Fehlende Spalten werden editionssicher ergänzt.
    await db.execute(`
        CREATE TABLE IF NOT EXISTS schools (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(150) NOT NULL,
            created_by INT NULL,
            join_code VARCHAR(30) NULL,
            code_updated_at DATETIME NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await db.execute(`
        CREATE TABLE IF NOT EXISTS school_members (
            id INT AUTO_INCREMENT PRIMARY KEY,
            school_id INT NOT NULL,
            user_id INT NOT NULL,
            role ENUM('owner','member') NOT NULL DEFAULT 'member',
            joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY unique_school_member (school_id, user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    const [schoolColumns] = await db.execute(`SHOW COLUMNS FROM schools`);
    const schoolColumnNames = new Set(schoolColumns.map(c => c.Field));

    if (!schoolColumnNames.has("created_by")) {
        await db.execute(`ALTER TABLE schools ADD COLUMN created_by INT NULL AFTER name`);
    }

    if (!schoolColumnNames.has("join_code")) {
        await db.execute(`ALTER TABLE schools ADD COLUMN join_code VARCHAR(30) NULL AFTER created_by`);
    }

    if (!schoolColumnNames.has("code_updated_at")) {
        await db.execute(`ALTER TABLE schools ADD COLUMN code_updated_at DATETIME NULL AFTER join_code`);
    }

    const [memberColumns] = await db.execute(`SHOW COLUMNS FROM school_members`);
    const memberColumnNames = new Set(memberColumns.map(c => c.Field));

    if (!memberColumnNames.has("role")) {
        await db.execute(`ALTER TABLE school_members ADD COLUMN role ENUM('owner','member') NOT NULL DEFAULT 'member'`);
    }

    // Bereits vorhandene Kanäle bekommen einmalig einen sicheren Code.
    const [withoutCode] = await db.execute(`
        SELECT id
        FROM schools
        WHERE join_code IS NULL OR join_code = ''
    `);

    for (const school of withoutCode) {
        let code = null;
        for (let attempt = 0; attempt < 20 && !code; attempt++) {
            const candidate = createSchoolCode();
            const [used] = await db.execute(
                `SELECT id FROM schools WHERE join_code = ? LIMIT 1`,
                [candidate]
            );
            if (used.length === 0) code = candidate;
        }
        if (code) {
            await db.execute(
                `UPDATE schools SET join_code = ?, code_updated_at = NOW() WHERE id = ?`,
                [code, school.id]
            );
        }
    }

    // Bestehende Kanäle ohne Creator werden dem ältesten Mitglied zugeordnet.
    const [withoutCreator] = await db.execute(`
        SELECT s.id
        FROM schools s
        WHERE s.created_by IS NULL
    `);

    for (const school of withoutCreator) {
        const [members] = await db.execute(`
            SELECT user_id
            FROM school_members
            WHERE school_id = ?
            ORDER BY id ASC
            LIMIT 1
        `, [school.id]);

        if (members.length > 0) {
            await db.execute(
                `UPDATE schools SET created_by = ? WHERE id = ?`,
                [members[0].user_id, school.id]
            );
            await db.execute(
                `UPDATE school_members SET role = 'owner' WHERE school_id = ? AND user_id = ?`,
                [school.id, members[0].user_id]
            );
        }
    }
}

async function rotateExpiredSchoolCode(schoolId) {
    const [rows] = await db.execute(`
        SELECT id, join_code, code_updated_at
        FROM schools
        WHERE id = ?
        LIMIT 1
    `, [schoolId]);

    if (rows.length === 0) return null;

    const school = rows[0];
    const updatedAt = school.code_updated_at
        ? new Date(school.code_updated_at).getTime()
        : 0;
    const rotationMs = SCHOOL_CODE_ROTATION_HOURS * 60 * 60 * 1000;
    const expired = !updatedAt || (Date.now() - updatedAt >= rotationMs);

    if (!expired && school.join_code) return school.join_code;

    for (let attempt = 0; attempt < 20; attempt++) {
        const candidate = createSchoolCode();
        const [used] = await db.execute(
            `SELECT id FROM schools WHERE join_code = ? AND id <> ? LIMIT 1`,
            [candidate, schoolId]
        );
        if (used.length === 0) {
            await db.execute(
                `UPDATE schools SET join_code = ?, code_updated_at = NOW() WHERE id = ?`,
                [candidate, schoolId]
            );
            return candidate;
        }
    }

    throw new Error("Kein neuer Schul-Code konnte erzeugt werden.");
}

async function rotateAllExpiredSchoolCodes() {
    try {
        const [schools] = await db.execute(`SELECT id FROM schools`);
        for (const school of schools) {
            await rotateExpiredSchoolCode(school.id);
        }
    } catch (error) {
        console.error("❌ Schul-Code-Rotation fehlgeschlagen:", error);
    }
}

// =====================================================
// SCHULEN DES BENUTZERS
// =====================================================

app.get(
    "/api/my-schools",
    authenticateToken,
    async (req, res) => {

        try {

            if (
                req.user.mode !==
                "school"
            ) {

                return res.status(403).json({
                    error:
                        "Nur School-Benutzer können Schulkanäle abrufen."
                });
            }

            const [schools] =
                await db.execute(
                    `
                    SELECT
                        s.id,
                        s.name
                    FROM schools s
                    INNER JOIN school_members sm
                        ON sm.school_id = s.id
                    WHERE
                        sm.user_id = ?
                    ORDER BY
                        s.name ASC
                    `,
                    [
                        req.user.userId
                    ]
                );

            return res.json(
                schools
            );

        } catch (error) {

            console.error(
                "❌ /api/my-schools Fehler:",
                error
            );

            return res.status(500).json({
                error:
                    "Schulen konnten nicht geladen werden."
            });
        }
    }
);


// =====================================================
// SCHULE ERSTELLEN
// =====================================================

app.post(
    "/api/schools",
    authenticateToken,
    async (req, res) => {
        try {
            if (req.user.mode !== "school") {
                return res.status(403).json({
                    error: "Nur School-Benutzer können Schulen erstellen."
                });
            }

            const name = typeof req.body?.name === "string"
                ? req.body.name.trim()
                : "";

            if (name.length < 2 || name.length > 150) {
                return res.status(400).json({
                    error: "Der Schulname muss zwischen 2 und 150 Zeichen lang sein."
                });
            }

            let joinCode = null;
            for (let attempt = 0; attempt < 20 && !joinCode; attempt++) {
                const candidate = createSchoolCode();
                const [used] = await db.execute(
                    `SELECT id FROM schools WHERE join_code = ? LIMIT 1`,
                    [candidate]
                );
                if (used.length === 0) joinCode = candidate;
            }

            if (!joinCode) {
                return res.status(500).json({
                    error: "Es konnte kein sicherer Schul-Code erstellt werden."
                });
            }

            const [result] = await db.execute(`
                INSERT INTO schools
                (name, created_by, join_code, code_updated_at)
                VALUES (?, ?, ?, NOW())
            `, [name, req.user.userId, joinCode]);

            await db.execute(`
                INSERT INTO school_members
                (school_id, user_id, role)
                VALUES (?, ?, 'owner')
            `, [result.insertId, req.user.userId]);

            console.log(
                `🏫 Schulkanal erstellt: ${name} (${joinCode}) von ${req.user.username}`
            );

            return res.status(201).json({
                success: true,
                schoolId: result.insertId,
                id: result.insertId,
                name,
                joinCode,
                role: "owner"
            });
        } catch (error) {
            console.error("❌ Schule-Erstellen-Fehler:", error);
            return res.status(500).json({
                error: "Schule konnte nicht erstellt werden."
            });
        }
    }
);


// =====================================================
// SCHULEN ABRUFEN
// =====================================================

app.get(
    "/api/schools",
    authenticateToken,
    async (req, res) => {
        try {
            if (req.user.mode !== "school") {
                return res.status(403).json({
                    error: "Nur School-Benutzer können Schulkanäle abrufen."
                });
            }

            const [memberships] = await db.execute(`
                SELECT
                    s.id,
                    s.name,
                    sm.role,
                    (SELECT COUNT(*) FROM school_members m2 WHERE m2.school_id = s.id) AS member_count,
                    CASE WHEN s.created_by = ? THEN s.join_code ELSE NULL END AS joinCode
                FROM schools s
                INNER JOIN school_members sm ON sm.school_id = s.id
                WHERE sm.user_id = ?
                ORDER BY s.name ASC
            `, [req.user.userId, req.user.userId]);

            for (const school of memberships) {
                await rotateExpiredSchoolCode(school.id);
                if (school.role === "owner") {
                    const [fresh] = await db.execute(
                        `SELECT join_code AS joinCode FROM schools WHERE id = ? LIMIT 1`,
                        [school.id]
                    );
                    if (school.role === "owner") school.joinCode = fresh[0]?.joinCode || null;
                }
            }

            return res.json(memberships);
        } catch (error) {
            console.error("❌ /api/schools Fehler:", error);
            return res.status(500).json({
                error: "Schulkanäle konnten nicht geladen werden."
            });
        }
    }
);


// =====================================================
// EIGENE SCHULKANÄLE + AKTUELLE CODES DES ERSTELLERS
// =====================================================

app.get(
    "/api/my-school-channels",
    authenticateToken,
    async (req, res) => {
        try {
            if (req.user.mode !== "school") {
                return res.status(403).json({
                    error: "Nur School-Benutzer können Schulkanäle verwalten."
                });
            }

            const [schools] = await db.execute(`
                SELECT
                    id,
                    name,
                    join_code AS joinCode,
                    code_updated_at AS codeUpdatedAt,
                    created_at AS createdAt
                FROM schools
                WHERE created_by = ?
                ORDER BY name ASC
            `, [req.user.userId]);

            for (const school of schools) {
                school.joinCode = await rotateExpiredSchoolCode(school.id);
                const [fresh] = await db.execute(
                    `SELECT code_updated_at AS codeUpdatedAt FROM schools WHERE id = ? LIMIT 1`,
                    [school.id]
                );
                school.codeUpdatedAt = fresh[0]?.codeUpdatedAt || school.codeUpdatedAt;
            }

            return res.json(schools);
        } catch (error) {
            console.error("❌ Eigene Schulkanäle Fehler:", error);
            return res.status(500).json({
                error: "Eigene Schulkanäle konnten nicht geladen werden."
            });
        }
    }
);


// =====================================================
// SCHUL-CODE MANUELL NEU GENERIEREN
// =====================================================

app.post(
    "/api/schools/:schoolId/regenerate-code",
    authenticateToken,
    async (req, res) => {
        try {
            if (req.user.mode !== "school") {
                return res.status(403).json({
                    error: "Nur School-Benutzer können Schul-Codes verwalten."
                });
            }

            const schoolId = Number(req.params.schoolId);
            if (!Number.isInteger(schoolId) || schoolId <= 0) {
                return res.status(400).json({ error: "Ungültige Schul-ID." });
            }

            const [owners] = await db.execute(`
                SELECT id FROM schools
                WHERE id = ? AND created_by = ?
                LIMIT 1
            `, [schoolId, req.user.userId]);

            if (owners.length === 0) {
                return res.status(403).json({
                    error: "Nur der Ersteller dieses Schulkanals kann den Code ändern."
                });
            }

            const oldCode = await rotateExpiredSchoolCode(schoolId);
            let newCode = oldCode;
            while (newCode === oldCode) {
                const candidate = createSchoolCode();
                const [used] = await db.execute(
                    `SELECT id FROM schools WHERE join_code = ? AND id <> ? LIMIT 1`,
                    [candidate, schoolId]
                );
                if (used.length === 0) newCode = candidate;
            }

            await db.execute(`
                UPDATE schools
                SET join_code = ?, code_updated_at = NOW()
                WHERE id = ?
            `, [newCode, schoolId]);

            return res.json({
                success: true,
                schoolId,
                joinCode: newCode
            });
        } catch (error) {
            console.error("❌ Schul-Code-Neugenerierung Fehler:", error);
            return res.status(500).json({
                error: "Schul-Code konnte nicht geändert werden."
            });
        }
    }
);


// =====================================================
// SCHULKANAL MIT CODE BEITRETEN
// =====================================================

app.post(
    "/api/schools/join",
    authenticateToken,
    async (req, res) => {
        try {
            if (req.user.mode !== "school") {
                return res.status(403).json({ error: "Nur School-Benutzer können Schulkanälen beitreten." });
            }

            const code = typeof req.body?.code === "string"
                ? req.body.code.trim().toUpperCase()
                : "";

            if (!/^[A-F0-9]{4}(?:-[A-F0-9]{4}){2}$/.test(code)) {
                return res.status(400).json({ error: "Ungültiger Schul-Code." });
            }

            const [schools] = await db.execute(`
                SELECT id, name, join_code, code_updated_at
                FROM schools
                WHERE join_code = ?
                LIMIT 1
            `, [code]);

            if (schools.length === 0) {
                return res.status(404).json({ error: "Dieser Schul-Code wurde nicht gefunden oder ist abgelaufen." });
            }

            const school = schools[0];
            const currentCode = await rotateExpiredSchoolCode(school.id);

            if (currentCode !== code) {
                return res.status(404).json({ error: "Dieser Schul-Code ist abgelaufen. Bitte den aktuellen Code verwenden." });
            }

            const [existing] = await db.execute(`
                SELECT id FROM school_members
                WHERE school_id = ? AND user_id = ?
                LIMIT 1
            `, [school.id, req.user.userId]);

            if (existing.length > 0) {
                return res.status(409).json({ error: "Du bist bereits Mitglied dieses Schulkanals." });
            }

            await db.execute(`
                INSERT INTO school_members (school_id, user_id, role)
                VALUES (?, ?, 'member')
            `, [school.id, req.user.userId]);

            return res.json({
                success: true,
                message: "Du bist dem Schulkanal beigetreten.",
                school: { id: school.id, name: school.name }
            });
        } catch (error) {
            console.error("❌ Schulkanal beitreten Fehler:", error);
            return res.status(500).json({ error: "Beitritt zum Schulkanal fehlgeschlagen." });
        }
    }
);


// =====================================================
// SCHULKANAL NACHRICHTEN LADEN
// =====================================================


app.get("/api/schools/:schoolId/members", authenticateToken, async (req,res) => {
    try {
        if (req.user.mode !== "school") return res.status(403).json({error:"Nur School-Benutzer können Schulkanäle verwalten."});
        const schoolId = Number(req.params.schoolId), userId = Number(req.user.userId);
        const [access] = await db.execute(`SELECT sm.role FROM school_members sm WHERE sm.school_id=? AND sm.user_id=? LIMIT 1`, [schoolId,userId]);
        if (!access.length) return res.status(403).json({error:"Kein Zugriff auf diesen Schulkanal."});
        const [members] = await db.execute(`SELECT su.id AS userId,su.username,su.display_name AS displayName,su.profile_picture AS profilePicture,sm.role FROM school_members sm INNER JOIN school_users su ON su.id=sm.user_id WHERE sm.school_id=? ORDER BY sm.role='owner' DESC,su.username ASC`, [schoolId]);
        return res.json({role:access[0].role,members});
    } catch(error){ console.error("❌ Schulmitglieder:",error); return res.status(500).json({error:"Schulmitglieder konnten nicht geladen werden."}); }
});

app.get("/api/schools/:schoolId/available-members", authenticateToken, async (req,res) => {
    try {
        if (req.user.mode !== "school") return res.status(403).json({error:"Nur School-Benutzer können Schulkanäle verwalten."});
        const schoolId = Number(req.params.schoolId), userId = Number(req.user.userId);
        const [access] = await db.execute(`SELECT id FROM school_members WHERE school_id=? AND user_id=? LIMIT 1`, [schoolId,userId]);
        if (!access.length) return res.status(403).json({error:"Kein Zugriff auf diesen Schulkanal."});
        const [users] = await db.execute(`SELECT su.id AS userId,su.username,su.display_name AS displayName,su.profile_picture AS profilePicture FROM school_users su WHERE su.id<>? AND NOT EXISTS (SELECT 1 FROM school_members sm WHERE sm.school_id=? AND sm.user_id=su.id) ORDER BY su.username ASC LIMIT 200`, [userId, schoolId]);
        return res.json(users);
    } catch(error){ console.error("❌ Schul verfügbare Mitglieder:",error); return res.status(500).json({error:"Nutzer konnten nicht geladen werden."}); }
});

app.put("/api/schools/:schoolId", authenticateToken, async (req,res) => {
    try {
        if (req.user.mode !== "school") return res.status(403).json({error:"Nur School-Benutzer können Schulkanäle verwalten."});
        const schoolId = Number(req.params.schoolId), userId = Number(req.user.userId);
        const [access] = await db.execute(`SELECT sm.role FROM school_members sm WHERE sm.school_id=? AND sm.user_id=? LIMIT 1`, [schoolId,userId]);
        if (!access.length) return res.status(403).json({error:"Kein Zugriff auf diesen Schulkanal."});
        if (access[0].role !== "owner") return res.status(403).json({error:"Nur der Admin kann den Schulkanal umbenennen."});
        const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
        if (name.length < 2 || name.length > 150) return res.status(400).json({error:"Der Name muss zwischen 2 und 150 Zeichen lang sein."});
        await db.execute(`UPDATE schools SET name=? WHERE id=?`, [name,schoolId]);
        io.to(`school-${schoolId}`).emit("schoolChannelUpdated", {schoolId,name});
        const [members] = await db.execute(`SELECT user_id AS userId FROM school_members WHERE school_id=?`, [schoolId]);
        for (const m of members) io.to(`user-${m.userId}`).emit("schoolChannelUpdated", {schoolId,name});
        return res.json({success:true,schoolId,name});
    } catch(error){ console.error("❌ Schulkanal umbenennen:",error); return res.status(500).json({error:"Schulkanal konnte nicht umbenannt werden."}); }
});

app.post("/api/schools/:schoolId/members", authenticateToken, async (req,res) => {
    try {
        if (req.user.mode !== "school") return res.status(403).json({error:"Nur School-Benutzer können Schulkanäle verwalten."});
        const schoolId = Number(req.params.schoolId), userId = Number(req.user.userId);
        const [access] = await db.execute(`SELECT id FROM school_members WHERE school_id=? AND user_id=? LIMIT 1`, [schoolId,userId]);
        if (!access.length) return res.status(403).json({error:"Kein Zugriff auf diesen Schulkanal."});
        let ids = Array.isArray(req.body?.userIds) ? req.body.userIds.map(Number).filter(Number.isInteger) : [];
        ids = [...new Set(ids)].filter(id=>id>0 && id!==userId);
        if (!ids.length) return res.status(400).json({error:"Keine Nutzer ausgewählt."});
        const added=[];
        for (const id of ids) {
            const [user] = await db.execute(`SELECT id FROM school_users WHERE id=? LIMIT 1`, [id]);
            if (!user.length) continue;
            const [exists] = await db.execute(`SELECT id FROM school_members WHERE school_id=? AND user_id=? LIMIT 1`, [schoolId,id]);
            if (exists.length) continue;
            await db.execute(`INSERT INTO school_members (school_id,user_id,role) VALUES (?,?, 'member')`, [schoolId,id]);
            added.push(id);
            io.to(`user-${id}`).emit("schoolChannelUpdated", {schoolId});
        }
        io.to(`school-${schoolId}`).emit("schoolChannelUpdated", {schoolId});
        return res.json({success:true,added});
    } catch(error){ console.error("❌ Schulmitglieder hinzufügen:",error); return res.status(500).json({error:"Nutzer konnten nicht hinzugefügt werden."}); }
});

app.delete("/api/schools/:schoolId/members/:memberId", authenticateToken, async (req,res) => {
    try {
        if (req.user.mode !== "school") return res.status(403).json({error:"Nur School-Benutzer können Schulkanäle verwalten."});
        const schoolId = Number(req.params.schoolId), userId = Number(req.user.userId), memberId = Number(req.params.memberId);
        const [access] = await db.execute(`SELECT role FROM school_members WHERE school_id=? AND user_id=? LIMIT 1`, [schoolId,userId]);
        if (!access.length) return res.status(403).json({error:"Kein Zugriff auf diesen Schulkanal."});
        if (access[0].role !== "owner") return res.status(403).json({error:"Nur der Admin kann Mitglieder entfernen."});
        if (memberId === userId) return res.status(400).json({error:"Der Admin kann sich nicht selbst kicken."});
        const [target] = await db.execute(`SELECT id,role FROM school_members WHERE school_id=? AND user_id=? LIMIT 1`, [schoolId,memberId]);
        if (!target.length) return res.status(404).json({error:"Mitglied ist nicht im Schulkanal."});
        await db.execute(`DELETE FROM school_members WHERE school_id=? AND user_id=?`, [schoolId,memberId]);
        io.to(`user-${memberId}`).emit("schoolChannelRemoved", {schoolId});
        io.to(`school-${schoolId}`).emit("schoolChannelUpdated", {schoolId,removedUserId:memberId});
        return res.json({success:true});
    } catch(error){ console.error("❌ Schulmitglied entfernen:",error); return res.status(500).json({error:"Mitglied konnte nicht entfernt werden."}); }
});

app.delete("/api/schools/:schoolId/leave", authenticateToken, async (req,res) => {
    try {
        if (req.user.mode !== "school") return res.status(403).json({error:"Nur School-Benutzer können Schulkanäle verwalten."});
        const schoolId = Number(req.params.schoolId), userId = Number(req.user.userId);
        const [access] = await db.execute(`SELECT role FROM school_members WHERE school_id=? AND user_id=? LIMIT 1`, [schoolId,userId]);
        if (!access.length) return res.status(403).json({error:"Du bist kein Mitglied dieses Schulkanals."});
        const [members] = await db.execute(`SELECT user_id AS userId,role FROM school_members WHERE school_id=? ORDER BY role='owner' DESC,id ASC`, [schoolId]);
        if (members.length <= 1) {
            await db.execute(`DELETE FROM school_messages WHERE school_id=?`, [schoolId]);
            await db.execute(`DELETE FROM school_members WHERE school_id=?`, [schoolId]);
            await db.execute(`DELETE FROM schools WHERE id=?`, [schoolId]);
        } else if (access[0].role === "owner") {
            const nextOwner = members.find(m=>Number(m.userId)!==userId);
            await db.execute(`UPDATE school_members SET role='member' WHERE school_id=?`, [schoolId]);
            await db.execute(`UPDATE school_members SET role='owner' WHERE school_id=? AND user_id=?`, [schoolId,nextOwner.userId]);
            await db.execute(`UPDATE schools SET created_by=? WHERE id=?`, [nextOwner.userId,schoolId]);
            await db.execute(`DELETE FROM school_members WHERE school_id=? AND user_id=?`, [schoolId,userId]);
        } else {
            await db.execute(`DELETE FROM school_members WHERE school_id=? AND user_id=?`, [schoolId,userId]);
        }
        io.to(`school-${schoolId}`).emit("schoolChannelUpdated", {schoolId,leftUserId:userId});
        io.to(`user-${userId}`).emit("schoolChannelRemoved", {schoolId});
        return res.json({success:true,schoolId});
    } catch(error){ console.error("❌ Schulkanal verlassen:",error); return res.status(500).json({error:"Schulkanal konnte nicht verlassen werden."}); }
});

app.get(
    "/api/schools/:schoolId/messages",
    authenticateToken,
    async (req, res) => {

        try {

            if (
                req.user.mode !==
                "school"
            ) {

                return res.status(403).json({
                    error:
                        "Nur School-Benutzer können Schulkanäle nutzen."
                });
            }

            const schoolId =
                Number(
                    req.params.schoolId
                );

            if (
                !Number.isInteger(
                    schoolId
                ) ||
                schoolId <= 0
            ) {

                return res.status(400).json({
                    error:
                        "Ungültige Schul-ID."
                });
            }

            const [membership] =
                await db.execute(
                    `
                    SELECT
                        s.id,
                        s.name
                    FROM schools s
                    INNER JOIN school_members sm
                        ON sm.school_id = s.id
                    WHERE
                        s.id = ?
                        AND sm.user_id = ?
                    LIMIT 1
                    `,
                    [
                        schoolId,
                        req.user.userId
                    ]
                );

            if (
                membership.length === 0
            ) {

                return res.status(403).json({
                    error:
                        "Kein Zugriff auf diesen Schulkanal."
                });
            }

            const [messages] =
                await db.execute(
                    `
                    SELECT
                        sm.id AS id,
                        sm.school_id AS schoolId,
                        sm.sender_id AS senderId,
                        su.username AS username,
                        su.display_name AS displayName,
                        su.profile_picture AS profilePicture,
                        sm.message AS text,
                        sm.created_at AS createdAt
                    FROM school_messages sm
                    INNER JOIN school_users su
                        ON su.id = sm.sender_id
                    WHERE
                        sm.school_id = ?
                    ORDER BY
                        sm.created_at ASC,
                        sm.id ASC
                    `,
                    [
                        schoolId
                    ]
                );

            return res.json(
                messages
            );

        } catch (error) {

            console.error(
                "❌ Schulnachrichten-Ladefehler:",
                error
            );

            return res.status(500).json({
                error:
                    "Schulnachrichten konnten nicht geladen werden."
            });
        }
    }
);


// =====================================================
// SCHULKANAL NACHRICHT SENDEN – HTTP
// =====================================================

app.post(
    "/api/schools/:schoolId/messages",
    authenticateToken,
    async (req, res) => {

        try {

            if (
                req.user.mode !==
                "school"
            ) {

                return res.status(403).json({
                    error:
                        "Nur School-Benutzer können Schulnachrichten senden."
                });
            }

            const schoolId =
                Number(
                    req.params.schoolId
                );

            const text =
                typeof req.body?.message ===
                "string"
                    ? req.body.message.trim()
                    : "";

            if (
                !Number.isInteger(
                    schoolId
                ) ||
                schoolId <= 0
            ) {

                return res.status(400).json({
                    error:
                        "Ungültige Schul-ID."
                });
            }

            if (!text) {

                return res.status(400).json({
                    error:
                        "Nachricht darf nicht leer sein."
                });
            }

            if (
                text.length > 5000
            ) {

                return res.status(400).json({
                    error:
                        "Nachricht darf maximal 5000 Zeichen lang sein."
                });
            }

            const [membership] =
                await db.execute(
                    `
                    SELECT
                        s.id,
                        s.name
                    FROM schools s
                    INNER JOIN school_members sm
                        ON sm.school_id = s.id
                    WHERE
                        s.id = ?
                        AND sm.user_id = ?
                    LIMIT 1
                    `,
                    [
                        schoolId,
                        req.user.userId
                    ]
                );

            if (
                membership.length === 0
            ) {

                return res.status(403).json({
                    error:
                        "Kein Zugriff auf diesen Schulkanal."
                });
            }

            const [result] =
                await db.execute(
                    `
                    INSERT INTO school_messages
                    (
                        school_id,
                        sender_id,
                        message
                    )
                    VALUES (?, ?, ?)
                    `,
                    [
                        schoolId,
                        req.user.userId,
                        text
                    ]
                );

            const [messages] =
                await db.execute(
                    `
                    SELECT
                        sm.id AS id,
                        sm.school_id AS schoolId,
                        sm.sender_id AS senderId,
                        su.username AS username,
                        su.display_name AS displayName,
                        su.profile_picture AS profilePicture,
                        sm.message AS text,
                        sm.created_at AS createdAt
                    FROM school_messages sm
                    INNER JOIN school_users su
                        ON su.id = sm.sender_id
                    WHERE
                        sm.id = ?
                    LIMIT 1
                    `,
                    [
                        result.insertId
                    ]
                );

            if (
                messages.length === 0
            ) {

                return res.status(500).json({
                    error:
                        "Nachricht konnte nicht geladen werden."
                });
            }

            const message =
                messages[0];

            io.to(
                `school-${schoolId}`
            ).emit(
                "schoolChatMessage",
                message
            );

            return res.json(
                message
            );

        } catch (error) {

            console.error(
                "❌ Schulnachrichten-Fehler:",
                error
            );

            return res.status(500).json({
                error:
                    "Schulnachricht konnte nicht gesendet werden."
            });
        }
    }
);


// =====================================================
// SCHULKANAL NACHRICHT BEARBEITEN
// =====================================================

app.patch(
    "/api/schools/:schoolId/messages/:messageId",
    authenticateToken,
    async (req, res) => {
        try {
            if (req.user.mode !== "school") {
                return res.status(403).json({
                    error: "Nur School-Benutzer können Schulnachrichten bearbeiten."
                });
            }

            const schoolId = Number(req.params.schoolId);
            const messageId = Number(req.params.messageId);
            const text = typeof req.body?.text === "string"
                ? req.body.text.trim()
                : "";
            const userId = Number(req.user.userId);

            if (!Number.isInteger(schoolId) || schoolId <= 0 ||
                !Number.isInteger(messageId) || messageId <= 0) {
                return res.status(400).json({ error: "Ungültige Nachrichten-ID." });
            }

            if (!text) {
                return res.status(400).json({ error: "Die Nachricht darf nicht leer sein." });
            }

            if (text.length > 5000) {
                return res.status(400).json({
                    error: "Die Nachricht darf maximal 5000 Zeichen enthalten."
                });
            }

            const [membership] = await db.execute(
                `SELECT id FROM school_members WHERE school_id = ? AND user_id = ? LIMIT 1`,
                [schoolId, userId]
            );

            if (!membership.length) {
                return res.status(403).json({ error: "Kein Zugriff auf diesen Schulkanal." });
            }

            const [rows] = await db.execute(
                `
                SELECT
                    sm.id,
                    sm.school_id AS schoolId,
                    sm.sender_id AS senderId
                FROM school_messages sm
                WHERE sm.id = ? AND sm.school_id = ?
                LIMIT 1
                `,
                [messageId, schoolId]
            );

            if (!rows.length) {
                return res.status(404).json({ error: "Nachricht nicht gefunden." });
            }

            if (Number(rows[0].senderId) !== userId) {
                return res.status(403).json({
                    error: "Du kannst nur deine eigenen Nachrichten bearbeiten."
                });
            }

            await db.execute(
                `UPDATE school_messages SET message = ? WHERE id = ? AND school_id = ?`,
                [text, messageId, schoolId]
            );

            const [updated] = await db.execute(
                `
                SELECT
                    sm.id AS id,
                    sm.school_id AS schoolId,
                    sm.sender_id AS senderId,
                    su.username AS username,
                    su.display_name AS displayName,
                    su.profile_picture AS profilePicture,
                    sm.message AS text,
                    sm.created_at AS createdAt
                FROM school_messages sm
                INNER JOIN school_users su ON su.id = sm.sender_id
                WHERE sm.id = ?
                LIMIT 1
                `,
                [messageId]
            );

            if (!updated.length) {
                return res.status(500).json({ error: "Bearbeitete Nachricht konnte nicht geladen werden." });
            }

            const message = updated[0];
            io.to(`school-${schoolId}`).emit("schoolMessageEdited", message);
            return res.json(message);
        } catch (error) {
            console.error("❌ Schulnachricht-Bearbeitungsfehler:", error);
            return res.status(500).json({
                error: "Schulnachricht konnte nicht bearbeitet werden."
            });
        }
    }
);

// =====================================================
// PRIVLINES AI IMAGE GENERATION
// =====================================================

app.post(
    "/api/ai/image",
    authenticateToken,
    async (req, res) => {

        try {

            const prompt =
                typeof req.body?.prompt === "string"
                    ? req.body.prompt.trim()
                    : "";

            if (!prompt) {
                return res.status(400).json({
                    success: false,
                    error: "Kein Bild-Prompt angegeben."
                });
            }

            if (prompt.length > 2048) {
                return res.status(400).json({
                    success: false,
                    error: "Der Bild-Prompt darf maximal 2048 Zeichen lang sein."
                });
            }

            if (
                !process.env.CLOUDFLARE_API_TOKEN ||
                !process.env.CLOUDFLARE_ACCOUNT_ID
            ) {
                return res.status(503).json({
                    success: false,
                    error: "PrivLines AI Bildgenerierung ist momentan nicht konfiguriert."
                });
            }

            const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
            const apiToken = process.env.CLOUDFLARE_API_TOKEN;
            const model = "@cf/black-forest-labs/flux-1-schnell";

            const endpoint =
                `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;

            const response = await fetch(endpoint, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${apiToken}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    prompt
                })
            });

            const contentType =
                response.headers.get("content-type") || "";

            if (!response.ok) {
                const errorText = await response.text();
                console.error(
                    "❌ Cloudflare Bildgenerierung Fehler:",
                    response.status,
                    errorText
                );

                return res.status(502).json({
                    success: false,
                    error: "Cloudflare konnte das Bild momentan nicht generieren."
                });
            }

            // Cloudflare Workers AI returns the generated image as base64
            // in the `image` property for FLUX.1 [schnell].
            if (contentType.includes("application/json")) {
                const data = await response.json();
                const image = data?.result?.image || data?.image;

                if (!image || typeof image !== "string") {
                    console.error(
                        "❌ Cloudflare lieferte kein Bild zurück:",
                        data
                    );

                    return res.status(502).json({
                        success: false,
                        error: "Cloudflare hat kein Bild zurückgegeben."
                    });
                }

                // ai.html supports image/* responses, so return the decoded
                // bytes directly instead of wrapping them in a large data URI.
                return res
                    .status(200)
                    .set("Content-Type", "image/jpeg")
                    .send(Buffer.from(image, "base64"));
            }

            // Fallback if the REST endpoint returns the image as binary data.
            const imageBuffer = Buffer.from(
                await response.arrayBuffer()
            );

            if (!imageBuffer.length) {
                return res.status(502).json({
                    success: false,
                    error: "Cloudflare hat ein leeres Bild zurückgegeben."
                });
            }

            const imageType =
                contentType.toLowerCase().startsWith("image/")
                    ? contentType
                    : "image/jpeg";

            return res
                .status(200)
                .set("Content-Type", imageType)
                .send(imageBuffer);

        } catch (error) {

            console.error(
                "❌ PrivLines AI Bildgenerierung Fehler:",
                error
            );

            return res.status(500).json({
                success: false,
                error: "Die Bildgenerierung ist momentan fehlgeschlagen."
            });
        }
    }
);

// =====================================================
// PRIVLINES AI
// =====================================================

app.post(
    "/api/ai",
    authenticateToken,
    async (req, res) => {

        try {

            const message =
                typeof req.body?.message ===
                "string"
                    ? req.body.message.trim()
                    : "";

            if (!message) {

                return res.status(400).json({
                    error:
                        "Keine Nachricht angegeben."
                });
            }

            if (
                message.length > 10000
            ) {

                return res.status(400).json({
                    error:
                        "Die Nachricht darf maximal 10000 Zeichen lang sein."
                });
            }

            if (
                !process.env.CLOUDFLARE_API_TOKEN ||
                !process.env.CLOUDFLARE_ACCOUNT_ID
            ) {

                return res.status(503).json({
                    error:
                        "PrivLines AI ist momentan nicht konfiguriert."
                });
            }

            const accountId =
                process.env.CLOUDFLARE_ACCOUNT_ID;

            const apiToken =
                process.env.CLOUDFLARE_API_TOKEN;

            const model =
                "@cf/meta/llama-3.1-8b-instruct-fast";

            const endpoint =
                `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;

            const response =
                await fetch(
                    endpoint,
                    {
                        method:
                            "POST",

                        headers: {
                            "Authorization":
                                `Bearer ${apiToken}`,

                            "Content-Type":
                                "application/json"
                        },

                        body:
                            JSON.stringify({
                                messages: [
                                    {
                                        role:
                                            "system",

                                        content:
                                            "Du bist PrivLines AI, der KI-Assistent des PrivLines Messengers. Du heißt immer PrivLines AI und stellst dich auch als PrivLines AI vor. Antworte grundsätzlich in der Sprache, in der der Nutzer schreibt. Wenn der Nutzer Deutsch schreibt, antworte auf Deutsch. Sei hilfreich, freundlich und verständlich."
                                    },

                                    {
                                        role:
                                            "user",

                                        content:
                                            message
                                    }
                                ],

                                max_tokens:
                                    1024,

                                temperature:
                                    0.6
                            })
                    }
                );

            const data =
                await response.json();

            if (
                !response.ok ||
                !data.success
            ) {

                console.error(
                    "❌ Cloudflare AI Fehler:",
                    data
                );

                return res.status(502).json({
                    success: false,
                    error:
                        "PrivLines AI konnte momentan nicht antworten."
                });
            }

            let answer = "";

            if (
                data.result &&
                typeof data.result.response ===
                    "string"
            ) {

                answer =
                    data.result.response;

            } else if (
                data.result &&
                Array.isArray(
                    data.result.choices
                ) &&
                data.result.choices.length > 0
            ) {

                answer =
                    data.result.choices[0]?.message?.content ||
                    "";
            }

            if (!answer) {

                return res.status(502).json({
                    error:
                        "PrivLines AI hat keine Antwort zurückgegeben."
                });
            }

            return res.json({
                success:
                    true,

                answer:
                    answer
            });

        } catch (error) {

            console.error(
                "❌ PrivLines AI Fehler:",
                error
            );

            return res.status(500).json({
                error:
                    "PrivLines AI konnte nicht erreicht werden."
            });
        }
    }
);


// =====================================================
// STANDARD-BENUTZER SUCHEN
// =====================================================

app.get(
    "/api/users",
    authenticateToken,
    async (req, res) => {
        try {
            if (req.user.mode === "school") {
                return res.status(403).json({
                    error: "School-Benutzer können keine Standard-Benutzer laden."
                });
            }

            const [users] = await db.execute(
                `
                SELECT
                    id,
                    username,
                    display_name AS displayName,
                    profile_picture AS profilePicture
                FROM users
                WHERE
                    id <> ?
                    AND NOT EXISTS (
                        SELECT 1 FROM blocked_users b
                        WHERE (b.blocker_id = ? AND b.blocked_id = users.id)
                           OR (b.blocker_id = users.id AND b.blocked_id = ?)
                    )
                ORDER BY LOWER(COALESCE(display_name, username)), LOWER(username)
                LIMIT 500
                `,
                [
                    Number(req.user.userId),
                    Number(req.user.userId),
                    Number(req.user.userId)
                ]
            );

            return res.json({
                users,
            });
        } catch (error) {
            console.error("❌ Alle-Standard-Benutzer-Ladefehler:", error);
            return res.status(500).json({
                error: "Nutzer konnten nicht geladen werden."
            });
        }
    }
);


app.get(
    "/api/users/:username",
    authenticateToken,
    async (req, res) => {

        try {

            if (
                req.user.mode ===
                "school"
            ) {

                return res.status(403).json({
                    error:
                        "School-Benutzer können keine Standard-Benutzer suchen."
                });
            }

            const username =
                typeof req.params.username ===
                "string"
                    ? req.params.username.trim()
                    : "";

            if (!username) {

                return res.status(400).json({
                    error:
                        "Benutzername erforderlich."
                });
            }

            const [users] =
                await db.execute(
                    `
                    SELECT
                        id,
                        username,
                        display_name AS displayName,
                        profile_picture AS profilePicture
                    FROM users
                    WHERE
                        username = ?
                            AND NOT EXISTS (
                            SELECT 1 FROM blocked_users b
                            WHERE (b.blocker_id = ? AND b.blocked_id = users.id)
                               OR (b.blocker_id = users.id AND b.blocked_id = ?)
                        )
                    LIMIT 1
                    `,
                    [
                        username,
                            Number(req.user.userId),
                        Number(req.user.userId)
                    ]
                );

            if (
                users.length === 0
            ) {

                return res.status(404).json({
                    error:
                        "Benutzer nicht gefunden."
                });
            }

            return res.json(
                users[0]
            );

        } catch (error) {

            console.error(
                "❌ Benutzersuche-Fehler:",
                error
            );

            return res.status(500).json({
                error:
                    "Benutzer konnte nicht gesucht werden."
            });
        }
    }
);


// =====================================================
// SCHOOL-BENUTZER SUCHEN
// =====================================================

app.get(
    "/api/school-users",
    authenticateToken,
    async (req, res) => {
        try {
            if (req.user.mode !== "school") {
                return res.status(403).json({
                    error: "Nur School-Benutzer können Schul-Benutzer laden."
                });
            }

            const [users] = await db.execute(
                `
                SELECT
                    id,
                    username,
                    display_name AS displayName,
                    profile_picture AS profilePicture
                FROM school_users
                WHERE
                    id <> ?
                    AND NOT EXISTS (
                        SELECT 1 FROM blocked_users b
                        WHERE (b.blocker_id = ? AND b.blocked_id = school_users.id)
                           OR (b.blocker_id = school_users.id AND b.blocked_id = ?)
                    )
                ORDER BY LOWER(COALESCE(display_name, username)), LOWER(username)
                LIMIT 500
                `,
                [
                    Number(req.user.userId),
                    Number(req.user.userId),
                    Number(req.user.userId)
                ]
            );

            return res.json({
                users,
            });
        } catch (error) {
            console.error("❌ Alle-Schul-Benutzer-Ladefehler:", error);
            return res.status(500).json({
                error: "Nutzer konnten nicht geladen werden."
            });
        }
    }
);


app.get(
    "/api/school-users/:username",
    authenticateToken,
    async (req, res) => {

        try {

            if (
                req.user.mode !==
                "school"
            ) {

                return res.status(403).json({
                    error:
                        "Nur School-Benutzer können Schul-Benutzer suchen."
                });
            }

            const username =
                typeof req.params.username ===
                "string"
                    ? req.params.username.trim()
                    : "";

            if (!username) {

                return res.status(400).json({
                    error:
                        "Benutzername erforderlich."
                });
            }

            const [users] =
                await db.execute(
                    `
                    SELECT
                        id,
                        username,
                        display_name AS displayName,
                        profile_picture AS profilePicture
                    FROM school_users
                    WHERE
                        username = ?
                            AND NOT EXISTS (
                            SELECT 1 FROM blocked_users b
                            WHERE (b.blocker_id = ? AND b.blocked_id = school_users.id)
                               OR (b.blocker_id = school_users.id AND b.blocked_id = ?)
                        )
                    LIMIT 1
                    `,
                    [
                        username,
                            Number(req.user.userId),
                        Number(req.user.userId)
                    ]
                );

            if (
                users.length === 0
            ) {

                return res.status(404).json({
                    error:
                        "Schul-Benutzer nicht gefunden."
                });
            }

            return res.json(
                users[0]
            );

        } catch (error) {

            console.error(
                "❌ School-Benutzersuche-Fehler:",
                error
            );

            return res.status(500).json({
                error:
                    "Schul-Benutzer konnte nicht gesucht werden."
            });
        }
    }
);


// =====================================================
// FREUNDSCHAFTSANFRAGE SENDEN
// =====================================================

async function sendFriendRequestHandler(req, res) {

    try {

        const senderId =
            Number(
                req.user.userId
            );

        // chat2.js verwendet userId. receiverId wird zusätzlich
        // unterstützt, damit ältere Frontend-Versionen ebenfalls
        // funktionieren.
        const rawReceiverId =
            req.body?.userId ??
            req.body?.receiverId ??
            req.body?.targetUserId ??
            req.body?.targetId ??
            req.body?.friendId ??
            req.body?.id ??
            req.params?.userId ??
            req.params?.id;

        let receiverId =
            Number(
                rawReceiverId
            );

        const requestedUsername =
            typeof req.body?.username === "string"
                ? req.body.username.trim()
                : typeof req.body?.targetUsername === "string"
                    ? req.body.targetUsername.trim()
                    : "";

        const mode =
            req.user.mode ===
            "school"
                ? "school"
                : "standard";

        // Wenn das Frontend die Edition des gefundenen Benutzers mitsendet,
        // darf sie niemals von der eigenen Edition abweichen.
        const requestedTargetMode =
            typeof req.body?.targetMode === "string"
                ? req.body.targetMode.trim().toLowerCase()
                : typeof req.body?.mode === "string"
                    ? req.body.mode.trim().toLowerCase()
                    : "";

        if (
            requestedTargetMode &&
            !["standard", "school"].includes(requestedTargetMode)
        ) {
            return res.status(400).json({
                error: "Ungültige Benutzer-Edition."
            });
        }

        if (
            requestedTargetMode &&
            requestedTargetMode !== mode
        ) {
            return res.status(403).json({
                error:
                    mode === "school"
                        ? "School-Benutzer können nur School-Benutzer hinzufügen."
                        : "Standard-Benutzer können nur Standard-Benutzer hinzufügen."
            });
        }

        if (
            !Number.isInteger(senderId) ||
            senderId <= 0
        ) {

            return res.status(401).json({
                error:
                    "Ungültige Sitzung."
            });
        }

        if (
            (!Number.isInteger(receiverId) || receiverId <= 0) &&
            !requestedUsername
        ) {
            return res.status(400).json({
                error:
                    "Benutzer-ID oder Benutzername erforderlich."
            });
        }

        if (
            requestedUsername &&
            requestedUsername.length > 100
        ) {
            return res.status(400).json({
                error:
                    "Ungültiger Benutzername."
            });
        }

        if (
            Number.isInteger(receiverId) &&
            receiverId > 0 &&
            senderId === receiverId
        ) {

            return res.status(400).json({
                error:
                    "Du kannst dir selbst keine Freundschaftsanfrage senden."
            });
        }

        // Die Edition wird NICHT aus dem Request-Body übernommen.
        // Sie kommt ausschließlich aus dem signierten JWT.
        const receiverTable =
            mode === "school"
                ? "school_users"
                : "users";

        let receiver;

        if (requestedUsername) {
            [receiver] =
                await db.execute(
                    `
                    SELECT
                        id,
                        username,
                        display_name,
                        profile_picture
                    FROM ${receiverTable}
                    WHERE username = ?
                    LIMIT 1
                    `,
                    [requestedUsername]
                );

            if (receiver.length > 0) {
                receiverId = Number(receiver[0].id);
            }
        } else {
            [receiver] =
                await db.execute(
                    `
                    SELECT
                        id,
                        username,
                        display_name,
                        profile_picture
                    FROM ${receiverTable}
                    WHERE id = ?
                    LIMIT 1
                    `,
                    [receiverId]
                );
        }

        if (
            receiver.length === 0
        ) {

            return res.status(404).json({
                error:
                    "Benutzer nicht gefunden."
            });
        }

        receiverId = Number(receiver[0].id);

        if (!Number.isInteger(receiverId) || receiverId <= 0) {
            return res.status(404).json({
                error: "Ungültiger Zielbenutzer."
            });
        }

        if (senderId === receiverId) {
            return res.status(400).json({
                error: "Du kannst dir selbst keine Freundschaftsanfrage senden."
            });
        }

        if (await areUsersBlocked(senderId, receiverId)) {
            return res.status(403).json({ error: "Dieser Benutzer kann nicht hinzugefügt werden." });
        }

        const senderTable = mode === "school" ? "school_users" : "users";
        const senderDisplayName =
            receiverTable === "school_users" || receiverTable === "users"
                ? (await db.execute(
                    `SELECT display_name FROM ${receiverTable} WHERE id = ? LIMIT 1`,
                    [senderId]
                ))[0]?.[0]?.display_name || req.user.username
                : req.user.username;

        // -------------------------------------------------
        // Beide Richtungen prüfen.
        // Dadurch entstehen keine doppelten Anfragen,
        // wenn bereits eine Anfrage vom anderen Benutzer
        // offen ist.
        // -------------------------------------------------

        const [relationships] =
            await db.execute(
                `
                SELECT
                    id,
                    sender_id,
                    receiver_id,
                    status
                FROM friend_requests
                WHERE
                    mode = ?
                    AND (
                        (
                            sender_id = ?
                            AND receiver_id = ?
                        )
                        OR
                        (
                            sender_id = ?
                            AND receiver_id = ?
                        )
                    )
                ORDER BY
                    id DESC
                LIMIT 1
                `,
                [
                    mode,
                    senderId,
                    receiverId,
                    receiverId,
                    senderId
                ]
            );

        if (
            relationships.length > 0
        ) {

            const relationship =
                relationships[0];

            if (
                relationship.status ===
                "accepted"
            ) {

                return res.status(409).json({
                    error:
                        "Ihr seid bereits befreundet.",
                    status:
                        "friends"
                });
            }

            if (
                relationship.status ===
                "pending"
            ) {

                if (
                    Number(
                        relationship.sender_id
                    ) === senderId
                ) {

                    return res.status(409).json({
                        error:
                            "Eine Freundschaftsanfrage ist bereits offen.",
                        status:
                            "outgoing",
                        requestId:
                            relationship.id
                    });

                }

                return res.status(409).json({
                    error:
                        "Diese Person hat dir bereits eine Freundschaftsanfrage gesendet.",
                    status:
                        "incoming",
                    requestId:
                        relationship.id
                });
            }

            // Eine abgelehnte Anfrage wird wiederverwendet.
            // Wenn die alte Anfrage in Gegenrichtung war,
            // werden Sender und Empfänger korrigiert.
            if (
                relationship.status ===
                "rejected"
            ) {

                await db.execute(
                    `
                    UPDATE friend_requests
                    SET
                        sender_id = ?,
                        receiver_id = ?,
                        status = 'pending',
                        mode = ?,
                        created_at = NOW()
                    WHERE id = ?
                    `,
                    [
                        senderId,
                        receiverId,
                        mode,
                        relationship.id
                    ]
                );

                io.to(
                    `user-${receiverId}`
                ).emit(
                    "friendRequest",
                    {
                        id:
                            relationship.id,

                        senderId:
                            senderId,

                        senderUsername:
                            req.user.username,

                        mode:
                            mode
                    }
                );

                return res.json({
                    success:
                        true,

                    requestId:
                        relationship.id,

                    status:
                        "pending"
                });
            }
        }

        let result;

        try {

            [result] =
                await db.execute(
                    `
                    INSERT INTO friend_requests
                    (
                        sender_id,
                        receiver_id,
                        status,
                        mode
                    )
                    VALUES (?, ?, 'pending', ?)
                    `,
                    [
                        senderId,
                        receiverId,
                        mode
                    ]
                );

        } catch (insertError) {

            // Alte Datenbanken haben teilweise noch den
            // Unique-Key (sender_id, receiver_id) ohne mode.
            // Bei einem solchen Konflikt wird nochmals geprüft,
            // ob die Anfrage inzwischen bereits existiert.
            if (
                insertError?.code ===
                "ER_DUP_ENTRY"
            ) {

                const [duplicate] =
                    await db.execute(
                        `
                        SELECT
                            id,
                            sender_id,
                            receiver_id,
                            status,
                            mode
                        FROM friend_requests
                        WHERE
                            sender_id = ?
                            AND receiver_id = ?
                            AND mode = ?
                        ORDER BY
                            id DESC
                        LIMIT 1
                        `,
                        [
                            senderId,
                            receiverId,
                            mode
                        ]
                    );

                if (
                    duplicate.length > 0
                ) {

                    const existing =
                        duplicate[0];

                    if (
                        existing.status ===
                        "accepted"
                    ) {

                        return res.status(409).json({
                            error:
                                "Ihr seid bereits befreundet.",
                            status:
                                "friends"
                        });
                    }

                    if (
                        existing.status ===
                        "pending"
                    ) {

                        return res.status(409).json({
                            error:
                                "Eine Freundschaftsanfrage ist bereits offen.",
                            status:
                                "outgoing",
                            requestId:
                                existing.id
                        });
                    }
                }

                console.error(
                    "❌ Freundschaftsanfrage: Datenbank-Unique-Key verhindert das Anlegen:",
                    insertError
                );

                return res.status(409).json({
                    error:
                        "Diese Freundschaftsanfrage existiert bereits oder die Datenbank verwendet noch einen alten Unique-Key."
                });
            }

            throw insertError;
        }

        io.to(
            `user-${receiverId}`
        ).emit(
            "friendRequest",
            {
                id:
                    result.insertId,

                senderId:
                    senderId,

                senderUsername:
                    req.user.username,

                senderDisplayName:
                    senderDisplayName,

                mode:
                    mode
            }
        );

        return res.json({
            success:
                true,

            requestId:
                result.insertId,

            status:
                "pending"
        });

    } catch (error) {

        console.error(
            "❌ Freundschaftsanfrage-Fehler:",
            error
        );

        return res.status(500).json({
            error:
                "Freundschaftsanfrage konnte nicht gesendet werden."
        });
    }
}

app.post(
    "/api/friend-requests",
    authenticateToken,
    sendFriendRequestHandler
);

// Kompatibilitätsroute für ältere/alternative Frontend-Versionen.
app.post(
    "/api/friends/add",
    authenticateToken,
    sendFriendRequestHandler
);

// Kompatibilität mit Frontends, die die Ziel-ID direkt in der URL senden.
app.post(
    "/api/friends/:userId/add",
    authenticateToken,
    sendFriendRequestHandler
);

app.post(
    "/api/add-friend",
    authenticateToken,
    sendFriendRequestHandler
);

// Weitere Kompatibilitätsrouten für ältere Frontends.
app.post(
    "/api/friends/add/:userId",
    authenticateToken,
    sendFriendRequestHandler
);

app.post(
    "/api/add-friend/:userId",
    authenticateToken,
    sendFriendRequestHandler
);


// =====================================================
// FREUNDSCHAFTSANFRAGEN ABRUFEN
// =====================================================

app.get(
    "/api/friend-requests",
    authenticateToken,
    async (req, res) => {

        try {

            const userId =
                Number(
                    req.user.userId
                );

            const mode =
                req.user.mode ===
                "school"
                    ? "school"
                    : "standard";

            const table =
                mode === "school"
                    ? "school_users"
                    : "users";

            const [requests] =
                await db.execute(
                    `
                    SELECT
                        fr.id,
                        fr.sender_id AS senderId,
                        u.username,
                        u.display_name AS displayName,
                        u.profile_picture AS profilePicture,
                        fr.status,
                        fr.created_at AS createdAt
                    FROM friend_requests fr
                    INNER JOIN ${table} u
                        ON u.id = fr.sender_id
                    WHERE
                        fr.receiver_id = ?
                        AND fr.status = 'pending'
                        AND fr.mode = ?
                    ORDER BY
                        fr.created_at DESC
                    `,
                    [
                        userId,
                        mode,
                    ]
                );

            return res.json(
                requests
            );

        } catch (error) {

            console.error(
                "❌ Freundschaftsanfragen-Ladefehler:",
                error
            );

            return res.status(500).json({
                error:
                    "Freundschaftsanfragen konnten nicht geladen werden."
            });
        }
    }
);


// =====================================================
// FREUNDSCHAFTSANFRAGE ANNEHMEN
// =====================================================

app.post(
    "/api/friend-requests/:id/accept",
    authenticateToken,
    async (req, res) => {

        try {

            const requestId =
                Number(
                    req.params.id
                );

            const userId =
                Number(
                    req.user.userId
                );

            const mode =
                req.user.mode ===
                "school"
                    ? "school"
                    : "standard";

            if (
                !Number.isInteger(
                    requestId
                ) ||
                requestId <= 0
            ) {

                return res.status(400).json({
                    error:
                        "Ungültige Anfrage-ID."
                });
            }

            const [requests] =
                await db.execute(
                    `
                    SELECT
                        id,
                        sender_id,
                        receiver_id,
                        status,
                        mode
                    FROM friend_requests
                    WHERE
                        id = ?
                        AND receiver_id = ?
                        AND status = 'pending'
                        AND mode = ?
                    LIMIT 1
                    `,
                    [
                        requestId,
                        userId,
                        mode
                    ]
                );

            if (
                requests.length === 0
            ) {

                return res.status(404).json({
                    error:
                        "Freundschaftsanfrage nicht gefunden."
                });
            }

            const request =
                requests[0];

            await db.execute(
                `
                UPDATE friend_requests
                SET status = 'accepted'
                WHERE
                    id = ?
                    AND receiver_id = ?
                    AND mode = ?
                `,
                [
                    requestId,
                    userId,
                    mode
                ]
            );

            // -------------------------------------------------
            // Privater Chat wird in BEIDEN Editionen vorbereitet.
            // -------------------------------------------------

            const acceptedTable = mode === "school" ? "school_users" : "users";
            const [acceptedUsers] = await db.execute(`
                SELECT id, username, display_name AS displayName
                FROM ${acceptedTable}
                WHERE id IN (?, ?)
            `, [request.sender_id, request.receiver_id]);
            const acceptedSender = acceptedUsers.find(u => Number(u.id) === Number(request.sender_id)) || {};
            const acceptedReceiver = acceptedUsers.find(u => Number(u.id) === Number(request.receiver_id)) || {};

            let chatId =
                null;

            chatId = await getOrCreateChat(
                request.sender_id,
                request.receiver_id,
                mode
            );

            io.to(
                `user-${request.sender_id}`
            ).emit(
                "friendRequestAccepted",
                {
                    requestId:
                        requestId,

                    userId:
                        userId,

                    username:
                        acceptedReceiver.username || "Unbekannt",

                    displayName:
                        acceptedReceiver.displayName || acceptedReceiver.username || "Unbekannt",

                    mode:
                        mode,

                    chatId:
                        chatId
                }
            );

            io.to(
                `user-${request.receiver_id}`
            ).emit(
                "friendRequestAccepted",
                {
                    requestId:
                        requestId,

                    userId:
                        request.sender_id,

                    username:
                        acceptedSender.username || "Unbekannt",

                    displayName:
                        acceptedSender.displayName || acceptedSender.username || "Unbekannt",

                    mode:
                        mode,

                    chatId:
                        chatId
                }
            );

            return res.json({
                success:
                    true,

                requestId:
                    requestId,

                friendId:
                    request.sender_id,

                chatId:
                    chatId
            });

        } catch (error) {

            console.error(
                "❌ Freundschaftsanfrage-Annehmen-Fehler:",
                error
            );

            return res.status(500).json({
                error:
                    "Freundschaftsanfrage konnte nicht angenommen werden."
            });
        }
    }
);


// =====================================================
// FREUNDSCHAFTSANFRAGE ABLEHNEN
// =====================================================

app.post(
    "/api/friend-requests/:id/reject",
    authenticateToken,
    async (req, res) => {

        try {

            const requestId =
                Number(
                    req.params.id
                );

            const userId =
                Number(
                    req.user.userId
                );

            const mode =
                req.user.mode ===
                "school"
                    ? "school"
                    : "standard";

            if (
                !Number.isInteger(
                    requestId
                ) ||
                requestId <= 0
            ) {

                return res.status(400).json({
                    error:
                        "Ungültige Anfrage-ID."
                });
            }

            const [result] =
                await db.execute(
                    `
                    UPDATE friend_requests
                    SET status = 'rejected'
                    WHERE
                        id = ?
                        AND receiver_id = ?
                        AND status = 'pending'
                        AND mode = ?
                    `,
                    [
                        requestId,
                        userId,
                        mode
                    ]
                );

            if (
                result.affectedRows ===
                0
            ) {

                return res.status(404).json({
                    error:
                        "Freundschaftsanfrage nicht gefunden."
                });
            }

            return res.json({
                success:
                    true
            });

        } catch (error) {

            console.error(
                "❌ Freundschaftsanfrage-Ablehnen-Fehler:",
                error
            );

            return res.status(500).json({
                error:
                    "Freundschaftsanfrage konnte nicht abgelehnt werden."
            });
        }
    }
);


// =====================================================
// =====================================================
// AUSGEHENDE FREUNDSCHAFTSANFRAGE ZURÜCKNEHMEN
// =====================================================

app.delete(
    "/api/friend-requests/:id/cancel",
    authenticateToken,
    async (req, res) => {
        try {
            const userId = Number(req.user.userId);
            const requestId = Number(req.params.id);
            const mode = req.user.mode === "school" ? "school" : "standard";

            if (!Number.isInteger(requestId) || requestId <= 0) {
                return res.status(400).json({ error: "Ungültige Anfrage-ID." });
            }

            const [result] = await db.execute(
                `
                DELETE FROM friend_requests
                WHERE id = ?
                  AND sender_id = ?
                  AND status = 'pending'
                  AND mode = ?
                `,
                [requestId, userId, mode]
            );

            if (!result.affectedRows) {
                return res.status(404).json({ error: "Ausgehende Anfrage nicht gefunden." });
            }

            return res.json({ success: true, requestId });
        } catch (error) {
            console.error("❌ Anfrage-zurücknehmen-Fehler:", error);
            return res.status(500).json({ error: "Anfrage konnte nicht zurückgenommen werden." });
        }
    }
);
// FREUNDE ABRUFEN
// =====================================================

app.get(
    "/api/friends",
    authenticateToken,
    async (req, res) => {

        try {

            const userId =
                Number(
                    req.user.userId
                );

            const mode =
                req.user.mode ===
                "school"
                    ? "school"
                    : "standard";

            const table =
                mode === "school"
                    ? "school_users"
                    : "users";

            const [friends] =
                await db.execute(
                    `
                    SELECT
                        u.id AS userId,
                        u.username,
                        u.display_name AS displayName,
                        u.profile_picture AS profilePicture
                    FROM friend_requests fr
                    INNER JOIN ${table} u
                        ON u.id =
                            CASE
                                WHEN fr.sender_id = ?
                                THEN fr.receiver_id
                                ELSE fr.sender_id
                            END
                    WHERE
                        (
                            fr.sender_id = ?
                            OR fr.receiver_id = ?
                        )
                        AND fr.status = 'accepted'
                        AND fr.mode = ?
                    ORDER BY
                        u.username ASC
                    `,
                    [
                        userId,
                        userId,
                        userId,
                        mode,
                    ]
                );

            return res.json(
                friends
            );

        } catch (error) {

            console.error(
                "❌ Freunde-Ladefehler:",
                error
            );

            return res.status(500).json({
                error:
                    "Freunde konnten nicht geladen werden."
            });
        }
    }
);


// =====================================================
// FREUNDSCHAFT ENTFERNEN
// =====================================================

async function removeFriend(
    req,
    res
) {

    try {

        const userId =
            Number(
                req.user.userId
            );

        const friendId =
            Number(
                req.params.userId
            );

        const mode =
            req.user.mode ===
            "school"
                ? "school"
                : "standard";

        if (
            !Number.isInteger(
                friendId
            ) ||
            friendId <= 0
        ) {

            return res.status(400).json({
                error:
                    "Ungültige Benutzer-ID."
            });
        }

        if (
            userId ===
            friendId
        ) {

            return res.status(400).json({
                error:
                    "Ungültige Freundschaft."
            });
        }

        const [rows] =
            await db.execute(
                `
                SELECT
                    id,
                    sender_id,
                    receiver_id
                FROM friend_requests
                WHERE
                    status = 'accepted'
                    AND mode = ?
                    AND (
                        (
                            sender_id = ?
                            AND receiver_id = ?
                        )
                        OR
                        (
                            sender_id = ?
                            AND receiver_id = ?
                        )
                    )
                LIMIT 1
                `,
                [
                    mode,
                    userId,
                    friendId,
                    friendId,
                    userId
                ]
            );

        if (
            rows.length === 0
        ) {

            return res.status(404).json({
                error:
                    "Freundschaft nicht gefunden."
            });
        }

        const friendship =
            rows[0];

        await db.execute(
            `
            DELETE FROM friend_requests
            WHERE
                id = ?
                AND mode = ?
            `,
            [
                friendship.id,
                mode
            ]
        );

        io.to(
            `user-${userId}`
        ).emit(
            "friendRemoved",
            {
                userId:
                    friendId,

                mode:
                    mode
            }
        );

        io.to(
            `user-${friendId}`
        ).emit(
            "friendRemoved",
            {
                userId:
                    userId,

                mode:
                    mode
            }
        );

        return res.json({
            success:
                true
        });

    } catch (error) {

        console.error(
            "❌ Entfreunden-Fehler:",
            error
        );

        return res.status(500).json({
            error:
                "Freundschaft konnte nicht entfernt werden."
        });
    }
}


// =====================================================
// ENTFREUNDEN – DELETE
// =====================================================

app.delete(
    "/api/friends/:userId",
    authenticateToken,
    removeFriend
);


// =====================================================
// ENTFREUNDEN – POST /unfriend
// =====================================================
// Kompatibilität mit älterem chat2.js

app.post(
    "/api/friends/:userId/unfriend",
    authenticateToken,
    removeFriend
);


// =====================================================
// FREUNDSCHAFTSSTATUS
// =====================================================

app.get(
    "/api/friends/:userId/status",
    authenticateToken,
    async (req, res) => {

        try {

            const userId =
                Number(
                    req.user.userId
                );

            const friendId =
                Number(
                    req.params.userId
                );

            const mode =
                req.user.mode ===
                "school"
                    ? "school"
                    : "standard";

            if (
                !Number.isInteger(
                    friendId
                ) ||
                friendId <= 0
            ) {

                return res.status(400).json({
                    error:
                        "Ungültige Benutzer-ID."
                });
            }

            const [rows] =
                await db.execute(
                    `
                    SELECT
                        id,
                        sender_id,
                        receiver_id,
                        status
                    FROM friend_requests
                    WHERE
                        mode = ?
                        AND (
                            (
                                sender_id = ?
                                AND receiver_id = ?
                            )
                            OR
                            (
                                sender_id = ?
                                AND receiver_id = ?
                            )
                        )
                    ORDER BY
                        id DESC
                    LIMIT 1
                    `,
                    [
                        mode,
                        userId,
                        friendId,
                        friendId,
                        userId
                    ]
                );

            if (
                rows.length === 0
            ) {

                return res.json({
                    status:
                        "none"
                });
            }

            const relationship =
                rows[0];

            if (
                relationship.status ===
                "accepted"
            ) {

                return res.json({
                    status:
                        "friends"
                });
            }

            if (
                relationship.status ===
                "pending"
            ) {

                if (
                    Number(
                        relationship.sender_id
                    ) === userId
                ) {

                    return res.json({
                        status: "outgoing",
                        requestId: relationship.id
                    });

                } else {

                    return res.json({
                        status:
                            "incoming",

                        requestId:
                            relationship.id
                    });
                }
            }

            return res.json({
                status:
                    relationship.status
            });

        } catch (error) {

            console.error(
                "❌ Freundschaftsstatus-Fehler:",
                error
            );

            return res.status(500).json({
                error:
                    "Freundschaftsstatus konnte nicht geladen werden."
            });
        }
    }
);


// =====================================================
// PRIVATE CHAT ÖFFNEN / ERSTELLEN
// =====================================================

app.post(
    "/api/chats",
    authenticateToken,
    async (req, res) => {
        try {
            const currentUserId = Number(req.user.userId);
            const userId = Number(req.body?.userId);
            const mode = req.user.mode === "school" ? "school" : "standard";
            const table = mode === "school" ? "school_users" : "users";

            if (!Number.isInteger(userId) || userId <= 0 || currentUserId === userId) {
                return res.status(400).json({error: "Ungültige Benutzer-ID."});
            }

            const [friendship] = await db.execute(`
                SELECT id FROM friend_requests
                WHERE mode = ? AND status = 'accepted'
                  AND ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))
                LIMIT 1
            `, [mode,currentUserId,userId,userId,currentUserId]);
            if (!friendship.length) return res.status(403).json({error:"Du kannst nur mit Freunden chatten."});

            const [users] = await db.execute(`
                SELECT id, username, display_name AS displayName, profile_picture AS profilePicture
                FROM ${table} WHERE id = ? LIMIT 1
            `, [userId]);
            if (!users.length) return res.status(404).json({error:"Benutzer nicht gefunden."});

            const chatId = await getOrCreateChat(currentUserId,userId,mode);
            const partner = users[0];
            return res.json({success:true,chatId,userId:partner.id,username:partner.username,displayName:partner.displayName || partner.username,profilePicture:partner.profilePicture || null,mode});
        } catch (error) {
            console.error("❌ Chat-Erstellungsfehler:",error);
            return res.status(500).json({error:"Chat konnte nicht geöffnet werden."});
        }
    }
);


// =====================================================
// ALLE PRIVATEN CHATS ABRUFEN
// =====================================================
// Diese Route hat in der alten server.js gefehlt.
// chat2.js ruft GET /api/chats auf.

app.get(
    "/api/chats",
    authenticateToken,
    async (req, res) => {
        try {
            const userId = Number(req.user.userId);
            const mode = req.user.mode === "school" ? "school" : "standard";
            const table = mode === "school" ? "school_users" : "users";

            const [chats] = await db.execute(`
                SELECT c.id AS chatId,
                       CASE WHEN c.user1_id = ? THEN c.user2_id ELSE c.user1_id END AS userId,
                       u.username,
                       u.profile_picture AS profilePicture,
                       u.display_name AS displayName
                FROM chats c
                INNER JOIN ${table} u ON u.id = CASE WHEN c.user1_id = ? THEN c.user2_id ELSE c.user1_id END
                INNER JOIN friend_requests fr ON (
                    (fr.sender_id = ? AND fr.receiver_id = CASE WHEN c.user1_id = ? THEN c.user2_id ELSE c.user1_id END) OR
                    (fr.receiver_id = ? AND fr.sender_id = CASE WHEN c.user1_id = ? THEN c.user2_id ELSE c.user1_id END)
                )
                WHERE (c.user1_id = ? OR c.user2_id = ?)
                  AND c.mode = ?
                  AND fr.status = 'accepted'
                  AND fr.mode = ?
                ORDER BY c.id DESC
            `, [userId,userId,userId,userId,userId,userId,userId,userId,mode,mode]);

            return res.json(chats);
        } catch (error) {
            console.error("❌ Chat-Liste-Fehler:", error);
            return res.status(500).json({ error: "Chats konnten nicht geladen werden." });
        }
    }
);

// =====================================================
// GRUPPEN-SCHEMA + API
// =====================================================

async function ensureGroupSchema() {
    await db.execute(`
        CREATE TABLE IF NOT EXISTS priv_groups (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            description VARCHAR(500) NOT NULL DEFAULT '',
            owner_id INT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_groups_owner (owner_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await db.execute(`
        CREATE TABLE IF NOT EXISTS group_members (
            id INT AUTO_INCREMENT PRIMARY KEY,
            group_id INT NOT NULL,
            user_id INT NOT NULL,
            role ENUM('owner','member') NOT NULL DEFAULT 'member',
            joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY unique_group_member (group_id, user_id),
            INDEX idx_group_members_group (group_id),
            INDEX idx_group_members_user (user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await db.execute(`
        CREATE TABLE IF NOT EXISTS group_messages (
            id INT AUTO_INCREMENT PRIMARY KEY,
            group_id INT NOT NULL,
            sender_id INT NOT NULL,
            message TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_group_messages_group (group_id),
            INDEX idx_group_messages_created (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Medien-Unterstützung für Gruppennachrichten.
    try {
        const [columns] = await db.execute(`SHOW COLUMNS FROM group_messages`);
        const names = new Set(columns.map(column => column.Field));
        if (!names.has("message_type")) {
            await db.execute(`ALTER TABLE group_messages ADD COLUMN message_type VARCHAR(20) NOT NULL DEFAULT 'text'`);
        }
        if (!names.has("media_url")) {
            await db.execute(`ALTER TABLE group_messages ADD COLUMN media_url VARCHAR(500) NULL`);
        }
    } catch (error) {
        console.warn("⚠️ Gruppen-Medien-Schema konnte nicht automatisch erweitert werden:", error.message);
    }

    // -----------------------------------------------------
    // MIGRATION FÜR BEREITS VORHANDENE GRUPPENTABELLEN
    // -----------------------------------------------------
    // Ältere Versionen haben group_members teilweise mit einer
    // Foreign-Key-Verknüpfung auf `groups` angelegt. Das neue
    // Gruppensystem verwendet bewusst `priv_groups`.
    // Außerdem hatte die alte group_members-Tabelle nicht immer
    // eine `id`-Spalte. Deshalb zählt die Gruppenliste über user_id.
    try {
        const [oldGroupFks] = await db.execute(`
            SELECT DISTINCT constraint_name
            FROM information_schema.KEY_COLUMN_USAGE
            WHERE table_schema = DATABASE()
              AND table_name = 'group_members'
              AND column_name = 'group_id'
              AND referenced_table_name = 'groups'
        `);

        for (const fk of oldGroupFks) {
            if (fk.constraint_name) {
                await db.execute(
                    `ALTER TABLE group_members DROP FOREIGN KEY \`${fk.constraint_name}\``
                );
            }
        }

        const [newGroupFks] = await db.execute(`
            SELECT DISTINCT constraint_name
            FROM information_schema.KEY_COLUMN_USAGE
            WHERE table_schema = DATABASE()
              AND table_name = 'group_members'
              AND column_name = 'group_id'
              AND referenced_table_name = 'priv_groups'
        `);

        if (newGroupFks.length === 0) {
            await db.execute(`
                ALTER TABLE group_members
                ADD CONSTRAINT fk_group_members_priv_groups
                FOREIGN KEY (group_id) REFERENCES priv_groups(id)
                ON DELETE CASCADE
            `);
        }
    } catch (migrationError) {
        console.error("⚠️ Gruppen-FK-Migration konnte nicht vollständig durchgeführt werden:", migrationError.message);
    }

    console.log("✅ Gruppen-System aktiviert.");
}

async function ensureBlockedUserSchema() {
    await db.execute(`
        CREATE TABLE IF NOT EXISTS blocked_users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            blocker_id INT NOT NULL,
            blocked_id INT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY unique_block (blocker_id, blocked_id),
            INDEX idx_blocker (blocker_id),
            INDEX idx_blocked (blocked_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log("✅ blocked_users Schema aktiviert.");
}

async function getGroupForUser(groupId, userId) {
    const [rows] = await db.execute(`
        SELECT g.id, g.name, g.description, g.owner_id AS ownerId,
               gm.role, g.created_at AS createdAt
        FROM priv_groups g
        INNER JOIN group_members gm ON gm.group_id = g.id
        WHERE g.id = ? AND gm.user_id = ?
        LIMIT 1
    `, [groupId, userId]);
    return rows[0] || null;
}

app.get("/api/groups", authenticateToken, async (req, res) => {
    try {
        if (req.user.mode === "school") return res.json([]);
        const userId = Number(req.user.userId);

        // Sicherheitsnetz: Der Gruppenersteller bleibt immer Mitglied
        // seiner eigenen Gruppe. Falls ein alter/fehlerhafter Datensatz
        // die Mitgliedschaft verloren hat, wird sie hier wiederhergestellt.
        await db.execute(`
            INSERT IGNORE INTO group_members (group_id, user_id, role)
            SELECT id, owner_id, 'owner'
            FROM priv_groups
            WHERE owner_id = ?
        `, [userId]);

        const [groups] = await db.execute(`
            SELECT g.id, g.name, g.description, g.owner_id AS ownerId,
                   g.created_at AS createdAt, COUNT(gm2.user_id) AS memberCount
            FROM priv_groups g
            INNER JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = ?
            LEFT JOIN group_members gm2 ON gm2.group_id = g.id
            GROUP BY g.id, g.name, g.description, g.owner_id, g.created_at
            ORDER BY g.created_at DESC, g.id DESC
        `, [userId]);
        return res.json(groups);
    } catch (error) {
        console.error("❌ Gruppen-Ladefehler:", error);
        return res.status(500).json({ error: "Gruppen konnten nicht geladen werden." });
    }
});

app.post("/api/groups", authenticateToken, async (req, res) => {
    try {
        if (req.user.mode === "school") return res.status(403).json({ error: "Gruppen sind nur in der Standard Edition verfügbar." });
        const ownerId = Number(req.user.userId);
        const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
        const description = typeof req.body?.description === "string" ? req.body.description.trim() : "";
        let memberIds = Array.isArray(req.body?.memberIds) ? req.body.memberIds.map(Number).filter(Number.isInteger) : [];
        memberIds = [...new Set(memberIds)].filter(id => id > 0 && id !== ownerId);
        if (!name) return res.status(400).json({ error: "Gruppenname erforderlich." });
        if (name.length > 100) return res.status(400).json({ error: "Gruppenname darf maximal 100 Zeichen lang sein." });
        if (description.length > 500) return res.status(400).json({ error: "Beschreibung darf maximal 500 Zeichen lang sein." });
        const validMembers = [];
        for (const memberId of memberIds) {
            if (await areUsersBlocked(ownerId, memberId)) continue;
            const [friend] = await db.execute(`
                SELECT id FROM friend_requests
                WHERE mode='standard' AND status='accepted'
                  AND ((sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?))
                LIMIT 1
            `, [ownerId, memberId, memberId, ownerId]);
            if (friend.length) validMembers.push(memberId);
        }
        const [result] = await db.execute(`INSERT INTO priv_groups (name,description,owner_id) VALUES (?,?,?)`, [name,description,ownerId]);
        const groupId = Number(result.insertId);
        await db.execute(`INSERT INTO group_members (group_id,user_id,role) VALUES (?,?, 'owner')`, [groupId,ownerId]);
        for (const memberId of validMembers) await db.execute(`INSERT IGNORE INTO group_members (group_id,user_id,role) VALUES (?,?, 'member')`, [groupId,memberId]);
        const group = await getGroupForUser(groupId, ownerId);
        const [members] = await db.execute(`SELECT user_id AS userId FROM group_members WHERE group_id=?`, [groupId]);
        for (const m of members) io.to(`user-${m.userId}`).emit("groupUpdated", { groupId });
        return res.status(201).json({ success:true, group:{...group, memberCount:members.length} });
    } catch (error) {
        console.error("❌ Gruppe erstellen Fehler:", error);
        return res.status(500).json({ error:"Gruppe konnte nicht erstellt werden." });
    }
});

app.get("/api/groups/:groupId", authenticateToken, async (req,res) => {
    try {
        if (req.user.mode === "school") return res.status(403).json({error:"Gruppen sind nur in der Standard Edition verfügbar."});
        const groupId=Number(req.params.groupId), userId=Number(req.user.userId);
        const group=await getGroupForUser(groupId,userId);
        if(!group) return res.status(403).json({error:"Kein Zugriff auf diese Gruppe."});
        const [members]=await db.execute(`
            SELECT u.id AS userId,u.username,u.display_name AS displayName,u.profile_picture AS profilePicture,gm.role
            FROM group_members gm INNER JOIN users u ON u.id=gm.user_id
            WHERE gm.group_id=? ORDER BY gm.role='owner' DESC,u.username ASC
        `,[groupId]);
        return res.json({...group,memberCount:members.length,members});
    } catch(error){ console.error("❌ Gruppen-Detailfehler:",error); return res.status(500).json({error:"Gruppe konnte nicht geladen werden."}); }
});

app.post("/api/groups/:groupId/members", authenticateToken, async (req,res) => {
    try {
        if (req.user.mode === "school") return res.status(403).json({error:"Gruppen sind nur in der Standard Edition verfügbar."});
        const groupId=Number(req.params.groupId), userId=Number(req.user.userId);
        const group=await getGroupForUser(groupId,userId);
        if(!group) return res.status(403).json({error:"Kein Zugriff auf diese Gruppe."});
                let ids=Array.isArray(req.body?.userIds)?req.body.userIds.map(Number).filter(Number.isInteger):[];
        ids=[...new Set(ids)].filter(id=>id>0&&id!==userId);
        if(!ids.length) return res.status(400).json({error:"Keine Benutzer ausgewählt."});
        const added=[];
        for(const id of ids){
            if(await areUsersBlocked(userId,id)) continue;
            const [friend]=await db.execute(`SELECT id FROM friend_requests WHERE mode='standard' AND status='accepted' AND ((sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?)) LIMIT 1`,[userId,id,id,userId]);
            if(!friend.length) continue;
            const [exists]=await db.execute(`SELECT 1 AS memberExists FROM group_members WHERE group_id=? AND user_id=? LIMIT 1`,[groupId,id]);
            if(exists.length) continue;
            await db.execute(`INSERT INTO group_members (group_id,user_id,role) VALUES (?,?, 'member')`,[groupId,id]);
            added.push(id); io.to(`user-${id}`).emit("groupUpdated",{groupId});
        }
        const [members]=await db.execute(`SELECT user_id AS userId FROM group_members WHERE group_id=?`,[groupId]);
        io.to(`group-${groupId}`).emit("groupUpdated",{groupId});
        return res.json({success:true,added,memberCount:members.length});
    } catch(error){ console.error("❌ Gruppen-Mitglieder Fehler:",error); return res.status(500).json({error:"Mitglieder konnten nicht hinzugefügt werden."}); }
});


app.put("/api/groups/:groupId", authenticateToken, async (req,res) => {
    try {
        if (req.user.mode === "school") return res.status(403).json({error:"Gruppen sind nur in der Standard Edition verfügbar."});
        const groupId = Number(req.params.groupId), userId = Number(req.user.userId);
        const group = await getGroupForUser(groupId, userId);
        if (!group) return res.status(403).json({error:"Kein Zugriff auf diese Gruppe."});
        if (Number(group.ownerId) !== userId) return res.status(403).json({error:"Nur der Admin kann den Gruppennamen ändern."});
        const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
        if (!name) return res.status(400).json({error:"Gruppenname erforderlich."});
        if (name.length > 100) return res.status(400).json({error:"Gruppenname darf maximal 100 Zeichen lang sein."});
        await db.execute(`UPDATE priv_groups SET name=? WHERE id=?`, [name, groupId]);
        io.to(`group-${groupId}`).emit("groupUpdated", {groupId, name});
        const [members] = await db.execute(`SELECT user_id AS userId FROM group_members WHERE group_id=?`, [groupId]);
        for (const m of members) io.to(`user-${m.userId}`).emit("groupUpdated", {groupId, name});
        return res.json({success:true, groupId, name});
    } catch (error) {
        console.error("❌ Gruppe umbenennen:", error);
        return res.status(500).json({error:"Gruppenname konnte nicht geändert werden."});
    }
});

app.delete("/api/groups/:groupId/members/:memberId", authenticateToken, async (req,res) => {
    try {
        if (req.user.mode === "school") return res.status(403).json({error:"Gruppen sind nur in der Standard Edition verfügbar."});
        const groupId = Number(req.params.groupId), userId = Number(req.user.userId), memberId = Number(req.params.memberId);
        const group = await getGroupForUser(groupId, userId);
        if (!group) return res.status(403).json({error:"Kein Zugriff auf diese Gruppe."});
        if (Number(group.ownerId) !== userId) return res.status(403).json({error:"Nur der Admin kann Mitglieder entfernen."});
        if (!Number.isInteger(memberId) || memberId <= 0 || memberId === userId) return res.status(400).json({error:"Der Admin kann sich nicht selbst kicken."});
        const [exists] = await db.execute(`SELECT user_id AS userId FROM group_members WHERE group_id=? AND user_id=? LIMIT 1`, [groupId, memberId]);
        if (!exists.length) return res.status(404).json({error:"Mitglied ist nicht in der Gruppe."});
        await db.execute(`DELETE FROM group_members WHERE group_id=? AND user_id=?`, [groupId, memberId]);
        io.to(`group-${groupId}`).emit("groupUpdated", {groupId, removedUserId:memberId});
        io.to(`user-${memberId}`).emit("groupMemberRemoved", {groupId});
        const [members] = await db.execute(`SELECT user_id AS userId FROM group_members WHERE group_id=?`, [groupId]);
        for (const m of members) io.to(`user-${m.userId}`).emit("groupUpdated", {groupId});
        return res.json({success:true, groupId, memberId});
    } catch (error) {
        console.error("❌ Gruppenmitglied entfernen:", error);
        return res.status(500).json({error:"Mitglied konnte nicht entfernt werden."});
    }
});

app.delete("/api/groups/:groupId/leave", authenticateToken, async (req,res) => {
    try {
        if (req.user.mode === "school") return res.status(403).json({error:"Gruppen sind nur in der Standard Edition verfügbar."});
        const groupId = Number(req.params.groupId), userId = Number(req.user.userId);
        const group = await getGroupForUser(groupId, userId);
        if (!group) return res.status(403).json({error:"Du bist kein Mitglied dieser Gruppe."});
        const [members] = await db.execute(`SELECT user_id AS userId, role FROM group_members WHERE group_id=? ORDER BY role='owner' DESC, user_id ASC`, [groupId]);
        if (members.length <= 1) {
            await db.execute(`DELETE FROM group_messages WHERE group_id=?`, [groupId]);
            await db.execute(`DELETE FROM group_members WHERE group_id=?`, [groupId]);
            await db.execute(`DELETE FROM priv_groups WHERE id=?`, [groupId]);
        } else if (Number(group.ownerId) === userId) {
            const nextOwner = members.find(m => Number(m.userId) !== userId);
            await db.execute(`UPDATE group_members SET role='member' WHERE group_id=?`, [groupId]);
            await db.execute(`UPDATE group_members SET role='owner' WHERE group_id=? AND user_id=?`, [groupId, nextOwner.userId]);
            await db.execute(`UPDATE priv_groups SET owner_id=? WHERE id=?`, [nextOwner.userId, groupId]);
            await db.execute(`DELETE FROM group_members WHERE group_id=? AND user_id=?`, [groupId, userId]);
        } else {
            await db.execute(`DELETE FROM group_members WHERE group_id=? AND user_id=?`, [groupId, userId]);
        }
        io.to(`group-${groupId}`).emit("groupUpdated", {groupId, leftUserId:userId});
        io.to(`user-${userId}`).emit("groupLeft", {groupId});
        return res.json({success:true, groupId});
    } catch (error) {
        console.error("❌ Gruppe verlassen:", error);
        return res.status(500).json({error:"Gruppe konnte nicht verlassen werden."});
    }
});

app.get("/api/groups/:groupId/messages", authenticateToken, async (req,res) => {
    try {
        if(req.user.mode==="school") return res.status(403).json({error:"Gruppen sind nur in der Standard Edition verfügbar."});
        const groupId=Number(req.params.groupId),userId=Number(req.user.userId);
        const group=await getGroupForUser(groupId,userId); if(!group) return res.status(403).json({error:"Kein Zugriff auf diese Gruppe."});
        const [messages]=await db.execute(`
            SELECT
                gm.id,
                gm.group_id AS groupId,
                gm.sender_id AS senderId,
                u.username,
                u.display_name AS displayName,
                u.profile_picture AS profilePicture,
                gm.message AS text,
                gm.message_type AS messageType,
                gm.media_url AS mediaUrl,
                gm.created_at AS createdAt
            FROM group_messages gm
            INNER JOIN users u ON u.id=gm.sender_id
            WHERE gm.group_id=? AND NOT EXISTS(
                SELECT 1 FROM blocked_users b
                WHERE (b.blocker_id=? AND b.blocked_id=gm.sender_id)
                   OR (b.blocker_id=gm.sender_id AND b.blocked_id=?)
            )
            ORDER BY gm.created_at ASC,gm.id ASC
        `,[groupId,userId,userId]);
        return res.json(messages);
    } catch(error){ console.error("❌ Gruppen-Nachrichten Fehler:",error); return res.status(500).json({error:"Gruppennachrichten konnten nicht geladen werden."}); }
});

app.post("/api/groups/:groupId/media", authenticateToken, groupMediaUpload.single("media"), async (req,res) => {
    try {
        if(req.user.mode==="school") {
            if(req.file) try { fs.unlinkSync(req.file.path); } catch (_) {}
            return res.status(403).json({error:"Gruppen sind nur in der Standard Edition verfügbar."});
        }

        const groupId=Number(req.params.groupId);
        const userId=Number(req.user.userId);
        const group=await getGroupForUser(groupId,userId);

        if(!group) {
            if(req.file) try { fs.unlinkSync(req.file.path); } catch (_) {}
            return res.status(403).json({error:"Kein Zugriff auf diese Gruppe."});
        }

        if(!req.file) return res.status(400).json({error:"Keine Datei ausgewählt."});

        const mime=String(req.file.mimetype || "").toLowerCase();
        let messageType = mime.startsWith("image/") ? "image" : mime.startsWith("video/") ? "video" : "voice";
        const mediaUrl=`/uploads/images/${req.file.filename}`;

        const [result]=await db.execute(`
            INSERT INTO group_messages (group_id,sender_id,message,message_type,media_url)
            VALUES (?,?,?,?,?)
        `,[groupId,userId,"",messageType,mediaUrl]);

        const [rows]=await db.execute(`
            SELECT
                gm.id,
                gm.group_id AS groupId,
                gm.sender_id AS senderId,
                u.username,
                u.display_name AS displayName,
                u.profile_picture AS profilePicture,
                gm.message AS text,
                gm.message_type AS messageType,
                gm.media_url AS mediaUrl,
                gm.created_at AS createdAt
            FROM group_messages gm
            INNER JOIN users u ON u.id=gm.sender_id
            WHERE gm.id=? LIMIT 1
        `,[result.insertId]);

        const message=rows[0];
        const [members]=await db.execute(`SELECT user_id AS userId FROM group_members WHERE group_id=?`,[groupId]);

        for(const member of members) {
            if(Number(member.userId)!==userId && await areUsersBlocked(userId,Number(member.userId))) continue;
            io.to(`user-${member.userId}`).emit("groupMessage",message);
        }

        return res.json(message);
    } catch(error) {
        if(req.file) try { fs.unlinkSync(req.file.path); } catch (_) {}
        console.error("❌ Gruppen-Medienfehler:",error);
        return res.status(500).json({error:"Medium konnte nicht in die Gruppe gesendet werden."});
    }
});

app.post("/api/groups/:groupId/messages", authenticateToken, async (req,res) => {
    try {
        if(req.user.mode==="school") return res.status(403).json({error:"Gruppen sind nur in der Standard Edition verfügbar."});
        const groupId=Number(req.params.groupId),userId=Number(req.user.userId),text=typeof req.body?.message==="string"?req.body.message.trim():"";
        const group=await getGroupForUser(groupId,userId); if(!group) return res.status(403).json({error:"Kein Zugriff auf diese Gruppe."});
        if(!text) return res.status(400).json({error:"Nachricht darf nicht leer sein."});
        if(text.length>5000) return res.status(400).json({error:"Nachricht darf maximal 5000 Zeichen lang sein."});
        const [result]=await db.execute(`INSERT INTO group_messages (group_id,sender_id,message) VALUES (?,?,?)`,[groupId,userId,text]);
        const [rows]=await db.execute(`
            SELECT
                gm.id,gm.group_id AS groupId,gm.sender_id AS senderId,
                u.username,u.display_name AS displayName,u.profile_picture AS profilePicture,
                gm.message AS text,gm.message_type AS messageType,gm.media_url AS mediaUrl,gm.created_at AS createdAt
            FROM group_messages gm
            INNER JOIN users u ON u.id=gm.sender_id
            WHERE gm.id=? LIMIT 1
        `,[result.insertId]);
        const message=rows[0]; const [members]=await db.execute(`SELECT user_id AS userId FROM group_members WHERE group_id=?`,[groupId]);
        for(const member of members){ if(Number(member.userId)!==userId && await areUsersBlocked(userId,Number(member.userId))) continue; io.to(`user-${member.userId}`).emit("groupMessage",message); }
        return res.json(message);
    } catch(error){ console.error("❌ Gruppennachricht Fehler:",error); return res.status(500).json({error:"Gruppennachricht konnte nicht gesendet werden."}); }
});


// =====================================================
// CHAT-NACHRICHTEN LADEN
// =====================================================

app.get(
    "/api/chats/:chatId/messages",
    authenticateToken,
    async (req, res) => {
        try {
            const mode = req.user.mode === "school" ? "school" : "standard";
            const userTable = mode === "school" ? "school_users" : "users";
            const viewerId = Number(req.user.userId);
            const chatId = Number(req.params.chatId);
            if (!Number.isInteger(chatId) || chatId <= 0) return res.status(400).json({error:"Ungültige Chat-ID."});

            const [chats] = await db.execute(`
                SELECT id,user1_id,user2_id,mode FROM chats
                WHERE id = ? AND mode = ? AND (user1_id = ? OR user2_id = ?)
                LIMIT 1
            `,[chatId,mode,viewerId,viewerId]);
            if (!chats.length) return res.status(403).json({error:"Kein Zugriff auf diesen Chat."});

            const otherUserId = Number(chats[0].user1_id) === viewerId ? Number(chats[0].user2_id) : Number(chats[0].user1_id);
            const [rows] = await db.execute(`
                SELECT m.id, m.chat_id, m.sender_id,
                       u.username, u.display_name AS displayName,
                       u.profile_picture AS profilePicture,
                       m.message, m.message_type, m.media_url,
                       m.created_at, m.edited_at, m.deleted_at
                FROM messages m
                INNER JOIN ${userTable} u ON u.id = m.sender_id
                WHERE m.chat_id = ?
                  AND NOT EXISTS (
                      SELECT 1 FROM blocked_users b
                      WHERE (b.blocker_id = ? AND b.blocked_id = m.sender_id)
                         OR (b.blocker_id = m.sender_id AND b.blocked_id = ?)
                  )
                ORDER BY m.created_at ASC, m.id ASC
            `,[chatId, viewerId, viewerId]);

            return res.json(rows);
        } catch (error) {
            console.error("❌ Nachrichten-Ladefehler:",error);
            return res.status(500).json({error:"Nachrichten konnten nicht geladen werden."});
        }
    }
);


// =====================================================
// NACHRICHT BEARBEITEN
// =====================================================

app.patch(
    "/api/messages/:messageId",
    authenticateToken,
    async (req, res) => {

        try {

            const mode =
                req.user.mode === "school"
                    ? "school"
                    : "standard";

            const messageId =
                Number(
                    req.params.messageId
                );

            const text =
                typeof req.body?.text ===
                "string"
                    ? req.body.text.trim()
                    : "";

            if (
                !Number.isInteger(
                    messageId
                ) ||
                messageId <= 0
            ) {

                return res.status(400).json({
                    error:
                        "Ungültige Nachrichten-ID."
                });
            }

            if (!text) {

                return res.status(400).json({
                    error:
                        "Die Nachricht darf nicht leer sein."
                });
            }

            if (
                text.length > 5000
            ) {

                return res.status(400).json({
                    error:
                        "Die Nachricht darf maximal 5000 Zeichen enthalten."
                });
            }

            const userId =
                Number(
                    req.user.userId
                );

            const [rows] =
                await db.query(
                    `
                    SELECT
                        m.id,
                        m.chat_id,
                        m.sender_id,
                        m.message_type
                    FROM messages m
                    INNER JOIN chats c
                        ON c.id = m.chat_id
                    WHERE
                        m.id = ?
                        AND c.mode = ?
                        AND (
                            c.user1_id = ?
                            OR c.user2_id = ?
                        )
                    LIMIT 1
                    `,
                    [
                        messageId,
                        mode,
                        userId,
                        userId
                    ]
                );

            if (
                rows.length === 0
            ) {

                return res.status(404).json({
                    error:
                        "Nachricht nicht gefunden."
                });
            }

            const message =
                rows[0];

            if (
                Number(
                    message.sender_id
                ) !== userId
            ) {

                return res.status(403).json({
                    error:
                        "Du kannst nur deine eigenen Nachrichten bearbeiten."
                });
            }

            if (
                message.message_type !==
                "text"
            ) {

                return res.status(400).json({
                    error:
                        "Nur Textnachrichten können bearbeitet werden."
                });
            }

            await db.query(
                `
                UPDATE messages
                SET
                    message = ?,
                    edited_at = NOW()
                WHERE id = ?
                `,
                [
                    text,
                    messageId
                ]
            );

            io.to(
                `chat-${message.chat_id}`
            ).emit(
                "messageEdited",
                {
                    id:
                        messageId,

                    chatId:
                        message.chat_id,

                    text:
                        text
                }
            );

            return res.json({
                id:
                    messageId,

                chatId:
                    message.chat_id,

                text:
                    text
            });

        } catch (error) {

            console.error(
                "❌ Fehler beim Bearbeiten:",
                error
            );

            return res.status(500).json({
                error:
                    "Nachricht konnte nicht bearbeitet werden."
            });
        }
    }
);


// =====================================================
// NACHRICHT LÖSCHEN
// =====================================================

app.delete(
    "/api/messages/:messageId",
    authenticateToken,
    async (req, res) => {

        try {

            const mode =
                req.user.mode === "school"
                    ? "school"
                    : "standard";

            const messageId =
                Number(
                    req.params.messageId
                );

            if (
                !Number.isInteger(
                    messageId
                ) ||
                messageId <= 0
            ) {

                return res.status(400).json({
                    error:
                        "Ungültige Nachrichten-ID."
                });
            }

            const userId =
                Number(
                    req.user.userId
                );

            const [rows] =
                await db.query(
                    `
                    SELECT
                        m.id,
                        m.chat_id,
                        m.sender_id,
                        m.deleted_at
                    FROM messages m
                    INNER JOIN chats c
                        ON c.id = m.chat_id
                    WHERE
                        m.id = ?
                        AND c.mode = ?
                        AND (
                            c.user1_id = ?
                            OR c.user2_id = ?
                        )
                    LIMIT 1
                    `,
                    [
                        messageId,
                        mode,
                        userId,
                        userId
                    ]
                );

            if (
                rows.length === 0
            ) {

                return res.status(404).json({
                    error:
                        "Nachricht nicht gefunden."
                });
            }

            const message =
                rows[0];

            if (
                Number(
                    message.sender_id
                ) !== userId
            ) {

                return res.status(403).json({
                    error:
                        "Du kannst nur deine eigenen Nachrichten löschen."
                });
            }

            if (
                message.deleted_at
            ) {

                return res.status(400).json({
                    error:
                        "Die Nachricht wurde bereits gelöscht."
                });
            }

            await db.query(
                `
                UPDATE messages
                SET
                    message = '',
                    message_type = 'deleted',
                    media_url = NULL,
                    deleted_at = NOW()
                WHERE id = ?
                `,
                [
                    messageId
                ]
            );

            io.to(
                `chat-${message.chat_id}`
            ).emit(
                "messageDeleted",
                {
                    id:
                        messageId,

                    chatId:
                        message.chat_id
                }
            );

            return res.json({
                messageId:
                    messageId,

                chatId:
                    message.chat_id
            });

        } catch (error) {

            console.error(
                "❌ Fehler beim Löschen:",
                error
            );

            return res.status(500).json({
                error:
                    "Nachricht konnte nicht gelöscht werden."
            });
        }
    }
);


// =====================================================
// GEBLOCKTE BENUTZER
// =====================================================

app.get("/api/blocked-users", authenticateToken, async (req, res) => {
    try {
        if (req.user.mode === "school") return res.json([]);
        const userId = Number(req.user.userId);
        const [rows] = await db.execute(`
            SELECT u.id AS userId, u.username, u.display_name AS displayName,
                   u.profile_picture AS profilePicture, b.created_at AS blockedAt
            FROM blocked_users b
            INNER JOIN users u ON u.id = b.blocked_id
            WHERE b.blocker_id = ?
            ORDER BY b.created_at DESC, u.username ASC
        `, [userId]);
        return res.json(rows);
    } catch (error) {
        console.error("❌ Geblockte Benutzer konnten nicht geladen werden:", error);
        return res.status(500).json({ error: "Geblockte Benutzer konnten nicht geladen werden." });
    }
});


// =====================================================
// BLOCKIEREN
// =====================================================

app.post(
    "/api/users/:userId/block",
    authenticateToken,
    async (req, res) => {

        try {

            if (
                req.user.mode ===
                "school"
            ) {

                return res.status(403).json({
                    error:
                        "Blockieren ist in der School Edition nicht verfügbar."
                });
            }

            const blockerId =
                Number(
                    req.user.userId
                );

            const blockedId =
                Number(
                    req.params.userId
                );

            if (
                !Number.isInteger(
                    blockedId
                ) ||
                blockedId <= 0
            ) {

                return res.status(400).json({
                    error:
                        "Ungültige Benutzer-ID."
                });
            }

            if (
                blockerId ===
                blockedId
            ) {

                return res.status(400).json({
                    error:
                        "Du kannst dich nicht selbst blockieren."
                });
            }

            const [users] =
                await db.execute(
                    `
                    SELECT id
                    FROM users
                    WHERE id = ?
                    LIMIT 1
                    `,
                    [
                        blockedId
                    ]
                );

            if (
                users.length === 0
            ) {

                return res.status(404).json({
                    error:
                        "Benutzer nicht gefunden."
                });
            }

            const [existing] =
                await db.execute(
                    `
                    SELECT id
                    FROM blocked_users
                    WHERE
                        blocker_id = ?
                        AND blocked_id = ?
                    LIMIT 1
                    `,
                    [
                        blockerId,
                        blockedId
                    ]
                );

            if (
                existing.length > 0
            ) {

                return res.json({
                    success:
                        true,

                    blocked:
                        true
                });
            }

            await db.execute(
                `
                INSERT INTO blocked_users
                (
                    blocker_id,
                    blocked_id
                )
                VALUES (?, ?)
                `,
                [
                    blockerId,
                    blockedId
                ]
            );

            io.to(
                `user-${blockedId}`
            ).emit(
                "userBlocked",
                {
                    userId:
                        blockerId
                }
            );

            io.to(
                `user-${blockerId}`
            ).emit(
                "userBlocked",
                {
                    userId:
                        blockedId
                }
            );

            return res.json({
                success:
                    true,

                blocked:
                    true
            });

        } catch (error) {

            console.error(
                "❌ Blockierungsfehler:",
                error
            );

            return res.status(500).json({
                error:
                    "Benutzer konnte nicht blockiert werden."
            });
        }
    }
);


// =====================================================
// ENTBLOCKEN
// =====================================================

app.delete(
    "/api/users/:userId/block",
    authenticateToken,
    async (req, res) => {

        try {

            if (
                req.user.mode ===
                "school"
            ) {

                return res.status(403).json({
                    error:
                        "Blockieren ist in der School Edition nicht verfügbar."
                });
            }

            const blockerId =
                Number(
                    req.user.userId
                );

            const blockedId =
                Number(
                    req.params.userId
                );

            if (
                !Number.isInteger(
                    blockedId
                ) ||
                blockedId <= 0
            ) {

                return res.status(400).json({
                    error:
                        "Ungültige Benutzer-ID."
                });
            }

            const [result] =
                await db.execute(
                    `
                    DELETE FROM blocked_users
                    WHERE
                        blocker_id = ?
                        AND blocked_id = ?
                    `,
                    [
                        blockerId,
                        blockedId
                    ]
                );

            if (
                result.affectedRows ===
                0
            ) {

                return res.status(404).json({
                    error:
                        "Benutzer ist nicht blockiert."
                });
            }

            io.to(
                `user-${blockedId}`
            ).emit(
                "userUnblocked",
                {
                    userId:
                        blockerId
                }
            );

            io.to(
                `user-${blockerId}`
            ).emit(
                "userUnblocked",
                {
                    userId:
                        blockedId
                }
            );

            return res.json({
                success:
                    true,

                blocked:
                    false
            });

        } catch (error) {

            console.error(
                "❌ Entblockungsfehler:",
                error
            );

            return res.status(500).json({
                error:
                    "Benutzer konnte nicht entblockt werden."
            });
        }
    }
);

// =====================================================
// BLOCKIERSTATUS
// =====================================================

app.get(
    "/api/users/:userId/block-status",
    authenticateToken,
    async (req, res) => {

        try {

            // Blockieren nur in der Standard Edition
            if (
                req.user.mode ===
                "school"
            ) {

                return res.status(403).json({
                    error:
                        "Blockieren ist in der School Edition nicht verfügbar."
                });

            }

            const currentUserId =
                Number(
                    req.user.userId
                );

            const otherUserId =
                Number(
                    req.params.userId
                );

            if (
                !Number.isInteger(
                    otherUserId
                ) ||
                otherUserId <= 0
            ) {

                return res.status(400).json({
                    error:
                        "Ungültige Benutzer-ID."
                });

            }

            // Prüfen, ob ICH die andere Person blockiert habe
            const [blockedByMeRows] =
                await db.execute(
                    `
                    SELECT id
                    FROM blocked_users
                    WHERE
                        blocker_id = ?
                        AND blocked_id = ?
                    LIMIT 1
                    `,
                    [
                        currentUserId,
                        otherUserId
                    ]
                );

            // Prüfen, ob DIE ANDERE PERSON mich blockiert hat
            const [blockedByOtherRows] =
                await db.execute(
                    `
                    SELECT id
                    FROM blocked_users
                    WHERE
                        blocker_id = ?
                        AND blocked_id = ?
                    LIMIT 1
                    `,
                    [
                        otherUserId,
                        currentUserId
                    ]
                );

            return res.json({

                blockedByMe:
                    blockedByMeRows.length > 0,

                blockedByOther:
                    blockedByOtherRows.length > 0

            });

        } catch (error) {

            console.error(
                "❌ Blockstatus-Fehler:",
                error
            );

            return res.status(500).json({
                error:
                    "Blockstatus konnte nicht geladen werden."
            });

        }

    }
);

// =====================================================
// SOCKET.IO AUTHENTIFIZIERUNG
// =====================================================

io.use((socket, next) => {

    try {

        const cookieHeader =
            socket.handshake.headers.cookie || "";

        const cookies = {};

        cookieHeader.split(";").forEach(part => {
            const index = part.indexOf("=");

            if (index === -1) return;

            const key = part.slice(0, index).trim();
            const value = part.slice(index + 1).trim();

            cookies[key] = decodeURIComponent(value);
        });

        const token = cookies.session;

        if (!token) {
            return next(new Error("Nicht eingeloggt"));
        }

        const user =
            jwt.verify(
                token,
                process.env.JWT_SECRET
            );

        if (!user || !user.userId) {
            return next(new Error("Ungültige Sitzung"));
        }

        socket.user = user;
        next();

    } catch (error) {

        console.error(
            "❌ Socket-Authentifizierung fehlgeschlagen:",
            error.message
        );

        next(new Error("Ungültige Sitzung"));
    }
});


// =====================================================
// SOCKET.IO
// =====================================================

io.on(
    "connection",
    async socket => {

        const userId =
            Number(
                socket.user.userId
            );

        const username =
            socket.user.username ||
            "Unbekannt";

        const mode =
            socket.user.mode === "school"
                ? "school"
                : "standard";

        let displayName = username;
        try {
            const userTable = mode === "school" ? "school_users" : "users";
            const [nameRows] = await db.execute(
                `SELECT display_name FROM ${userTable} WHERE id = ? LIMIT 1`,
                [userId]
            );
            if (nameRows.length && nameRows[0].display_name) {
                displayName = nameRows[0].display_name;
            }
        } catch (error) {
            console.warn("Anzeigename konnte für Socket nicht geladen werden:", error.message);
        }

        socket.join(
            `user-${userId}`
        );

        console.log(
            `Ein Benutzer ist verbunden: ${username} ${socket.id} (${mode})`
        );

        sendPendingFriendRequests(socket);

        // =================================================
        // CHAT VERLASSEN
        // =================================================

        socket.on(
            "leaveChat",
            chatId => {

                const numericChatId =
                    Number(
                        chatId
                    );

                if (
                    Number.isInteger(
                        numericChatId
                    ) &&
                    numericChatId > 0
                ) {

                    socket.leave(
                        `chat-${numericChatId}`
                    );
                }
            }
        );


        // =================================================
        // TEXTNACHRICHT
        // =================================================

        socket.on(
            "chatMessage",
            async data => {

                try {

                    if (
                        !data ||
                        typeof data.text !==
                            "string"
                    ) {

                        return;
                    }

                    const text =
                        data.text.trim();

                    if (!text) {
                        return;
                    }

                    if (
                        text.length > 5000
                    ) {

                        return socket.emit(
                            "chatError",
                            {
                                error:
                                    "Nachricht darf maximal 5000 Zeichen lang sein."
                            }
                        );
                    }

                    const chatId =
                        Number(
                            data.chatId
                        );

                    if (
                        !Number.isInteger(
                            chatId
                        ) ||
                        chatId <= 0
                    ) {

                        return socket.emit(
                            "chatError",
                            {
                                error:
                                    "Ungültige Chat-ID."
                            }
                        );
                    }

                    const [chats] =
                        await db.execute(
                            `
                            SELECT
                                id,
                                user1_id,
                                user2_id,
                                mode
                            FROM chats
                            WHERE
                                id = ?
                                AND mode = ?
                                AND (
                                    user1_id = ?
                                    OR user2_id = ?
                                )
                            LIMIT 1
                            `,
                            [
                                chatId,
                                mode,
                                userId,
                                userId
                            ]
                        );

                    if (
                        chats.length === 0
                    ) {

                        return socket.emit(
                            "chatError",
                            {
                                error:
                                    "Kein Zugriff auf diesen Chat."
                            }
                        );
                    }

                    const chat =
                        chats[0];

                    const receiverId =
                        Number(
                            chat.user1_id
                        ) === userId
                            ? Number(
                                chat.user2_id
                            )
                            : Number(
                                chat.user1_id
                            );

                    const blocked =
                        await areUsersBlocked(
                            userId,
                            receiverId
                        );

                    const [result] =
                        await db.execute(
                            `
                            INSERT INTO messages
                            (
                                chat_id,
                                sender_id,
                                message,
                                message_type
                            )
                            VALUES (?, ?, ?, ?)
                            `,
                            [
                                chatId,
                                userId,
                                text,
                                "text"
                            ]
                        );

                    const message = {

                        id:
                            result.insertId,

                        chatId:
                            chatId,

                        senderId:
                            userId,

                        username:
                            username,

                        displayName:
                            displayName || username,

                        text:
                            text,

                        messageType:
                            "text",

                        mediaUrl:
                            null,

                        createdAt:
                            new Date()
                    };

                    if (
                        blocked
                    ) {

                        socket.emit(
                            "messageBlocked",
                            {
                                chatId:
                                    chatId,

                                messageId:
                                    result.insertId,

                                text:
                                    text,

                                reason:
                                    "Benutzer blockiert"
                            }
                        );

                        console.log(
                            `${username} [Chat ${chatId}]: Nachricht gespeichert (wartet wegen Blockierung)`
                        );

                        return;
                    }

                    console.log(
                        `${username} [Chat ${chatId}]: ${text}`
                    );

                    io.to(
                        `chat-${chatId}`
                    ).emit(
                        "chatMessage",
                        message
                    );

                    io.to(
                        `user-${receiverId}`
                    ).emit(
                        "newMessageNotification",
                        {
                            chatId:
                                chatId,

                            senderId:
                                userId,

                            senderUsername:
                                username,

                            senderDisplayName:
                                displayName || username,

                            text:
                                text
                        }
                    );
                    if (!io.sockets.adapter.rooms.get(`user-${receiverId}`)?.size) {
                        void pushToUser(receiverId, mode, {
                            title: displayName || username || "PrivLines",
                            body: "Du hast eine neue Nachricht in PrivLines.",
                            url: "/chat.html"
                        });
                    }

                } catch (error) {

                    console.error(
                        "❌ Nachrichtenfehler:",
                        error
                    );

                    socket.emit(
                        "chatError",
                        {
                            error:
                                "Nachricht konnte nicht gesendet werden."
                        }
                    );
                }
            }
        );

                // =================================================
        // SCHULKANAL BEITRETEN
        // =================================================

        socket.on(
            "joinSchoolChannel",
            async schoolId => {

                try {

                    if (
                        mode !==
                        "school"
                    ) {

                        return socket.emit(
                            "schoolChannelError",
                            {
                                error:
                                    "Nur Schul-Benutzer können Schulkanäle verwenden."
                            }
                        );
                    }

                    const numericSchoolId =
                        Number(
                            schoolId
                        );

                    if (
                        !Number.isInteger(
                            numericSchoolId
                        ) ||
                        numericSchoolId <= 0
                    ) {

                        return socket.emit(
                            "schoolChannelError",
                            {
                                error:
                                    "Ungültige Schul-ID."
                            }
                        );
                    }

                    // ---------------------------------------------
                    // Prüfen, ob der Benutzer Mitglied der Schule ist
                    // ---------------------------------------------

                    const [members] =
                        await db.execute(
                            `
                            SELECT
                                id
                            FROM school_members
                            WHERE
                                school_id = ?
                                AND user_id = ?
                            LIMIT 1
                            `,
                            [
                                numericSchoolId,
                                userId
                            ]
                        );

                    if (
                        members.length === 0
                    ) {

                        return socket.emit(
                            "schoolChannelError",
                            {
                                error:
                                    "Du bist kein Mitglied dieser Schule."
                            }
                        );
                    }

                    // ---------------------------------------------
                    // Alte Schulkanal-Räume verlassen
                    // ---------------------------------------------

                    for (
                        const room
                        of socket.rooms
                    ) {

                        if (
                            room.startsWith(
                                "school-"
                            )
                        ) {

                            socket.leave(
                                room
                            );
                        }
                    }

                    socket.join(
                        `school-${numericSchoolId}`
                    );

                    console.log(
                        `${username} ist Schulkanal ${numericSchoolId} beigetreten`
                    );

                    socket.emit(
                        "schoolChannelJoined",
                        {
                            schoolId:
                                numericSchoolId
                        }
                    );

                } catch (error) {

                    console.error(
                        "❌ Schulkanal-Join-Fehler:",
                        error
                    );

                    socket.emit(
                        "schoolChannelError",
                        {
                            error:
                                "Schulkanal konnte nicht geöffnet werden."
                        }
                    );
                }
            }
        );


        // =================================================
        // SCHULKANAL NACHRICHT
        // =================================================

        socket.on(
            "schoolChatMessage",
            async data => {

                try {

                    if (
                        mode !==
                        "school"
                    ) {

                        return socket.emit(
                            "schoolChannelError",
                            {
                                error:
                                    "Nur Schul-Benutzer können Schulnachrichten senden."
                            }
                        );
                    }

                    if (
                        !data ||
                        typeof data.text !==
                            "string"
                    ) {

                        return;
                    }

                    const text =
                        data.text.trim();

                    if (!text) {
                        return;
                    }

                    if (
                        text.length > 5000
                    ) {

                        return socket.emit(
                            "schoolChannelError",
                            {
                                error:
                                    "Nachricht darf maximal 5000 Zeichen lang sein."
                            }
                        );
                    }

                    const schoolId =
                        Number(
                            data.schoolId
                        );

                    if (
                        !Number.isInteger(
                            schoolId
                        ) ||
                        schoolId <= 0
                    ) {

                        return socket.emit(
                            "schoolChannelError",
                            {
                                error:
                                    "Ungültige Schul-ID."
                            }
                        );
                    }

                    // ---------------------------------------------
                    // Mitgliedschaft prüfen
                    // ---------------------------------------------

                    const [members] =
                        await db.execute(
                            `
                            SELECT
                                id
                            FROM school_members
                            WHERE
                                school_id = ?
                                AND user_id = ?
                            LIMIT 1
                            `,
                            [
                                schoolId,
                                userId
                            ]
                        );

                    if (
                        members.length === 0
                    ) {

                        return socket.emit(
                            "schoolChannelError",
                            {
                                error:
                                    "Du bist kein Mitglied dieser Schule."
                            }
                        );
                    }

                    // ---------------------------------------------
                    // Prüfen, ob Socket tatsächlich im Schulraum ist
                    // ---------------------------------------------

                    if (
                        !socket.rooms.has(
                            `school-${schoolId}`
                        )
                    ) {

                        return socket.emit(
                            "schoolChannelError",
                            {
                                error:
                                    "Du bist diesem Schulkanal noch nicht beigetreten."
                            }
                        );
                    }

                    // ---------------------------------------------
                    // Nachricht speichern
                    // ---------------------------------------------

                    const [result] =
                        await db.execute(
                            `
                            INSERT INTO school_messages
                            (
                                school_id,
                                sender_id,
                                message
                            )
                            VALUES (?, ?, ?)
                            `,
                            [
                                schoolId,
                                userId,
                                text
                            ]
                        );

                    const messageId =
                        result.insertId;

                    // ---------------------------------------------
                    // Gespeicherte Nachricht erneut laden
                    // Dadurch ist sie für ALLE Clients identisch
                    // und auch beim eigenen Benutzer sichtbar.
                    // ---------------------------------------------

                    const [messages] =
                        await db.execute(
                            `
                            SELECT
                                sm.id,
                                sm.school_id AS schoolId,
                                sm.sender_id AS senderId,
                                su.username,
                                su.display_name AS displayName,
                                su.profile_picture AS profilePicture,
                                sm.message,
                                sm.created_at AS createdAt
                            FROM school_messages sm
                            INNER JOIN school_users su
                                ON su.id = sm.sender_id
                            WHERE
                                sm.id = ?
                            LIMIT 1
                            `,
                            [
                                messageId
                            ]
                        );

                    if (
                        messages.length === 0
                    ) {

                        return socket.emit(
                            "schoolChannelError",
                            {
                                error:
                                    "Gespeicherte Nachricht konnte nicht geladen werden."
                            }
                        );
                    }

                    const message =
                        messages[0];

                    console.log(
                        `${username} [Schulkanal ${schoolId}]: ${text}`
                    );

                    // ---------------------------------------------
                    // WICHTIG:
                    // An den KOMPLETTEN Schulraum senden.
                    // Dadurch sieht auch der Absender seine Nachricht.
                    // ---------------------------------------------

                    socket.to(
                        `school-${schoolId}`
                    ).emit(
                        "schoolChatMessage",
                        message
                    );

                    // Explizit auch an den Absender senden.
                    // So erscheint die Nachricht sofort, selbst wenn
                    // der Client den Room-Status gerade aktualisiert.
                    socket.emit(
                        "schoolChatMessage",
                        message
                    );

                } catch (error) {

                    console.error(
                        "❌ Schulnachrichtenfehler:",
                        error
                    );

                    socket.emit(
                        "schoolChannelError",
                        {
                            error:
                                "Schulnachricht konnte nicht gesendet werden."
                        }
                    );
                }
            }
        );



        // =================================================
        // GRUPPEN-ROOMS
        // =================================================
        socket.on("joinGroup", async groupId => {
            const id = Number(groupId);
            if (!Number.isInteger(id) || id <= 0 || mode === "school") return;
            try {
                const group = await getGroupForUser(id, userId);
                if (group) socket.join(`group-${id}`);
            } catch (error) {
                console.warn("Gruppen-Room konnte nicht betreten werden:", error.message);
            }
        });

        socket.on("leaveGroup", groupId => {
            const id = Number(groupId);
            if (Number.isInteger(id) && id > 0) socket.leave(`group-${id}`);
        });

        // =================================================
        // PRIVATE + GRUPPEN WEBRTC-SIGNALING
        // =================================================
        socket.on("call:offer", async data => {
            const toUserId = Number(data?.toUserId);
            if (!Number.isInteger(toUserId) || toUserId <= 0) return;
            const recipientRoom = `user-${toUserId}`;
            const recipientOnline = !!io.sockets.adapter.rooms.get(recipientRoom)?.size;
            if (!recipientOnline && typeof data?.callId === "string" && data.callId && data.offer) {
                try {
                    await db.execute(`
                        INSERT INTO pending_call_offers
                            (call_id, recipient_user_id, mode, caller_user_id, caller_name, video, offer, expires_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 90 SECOND))
                        ON DUPLICATE KEY UPDATE caller_user_id=VALUES(caller_user_id), caller_name=VALUES(caller_name), video=VALUES(video), offer=VALUES(offer), expires_at=VALUES(expires_at)
                    `, [String(data.callId).slice(0, 128), toUserId, mode, userId, displayName, data.video ? 1 : 0, JSON.stringify(data.offer)]);
                } catch (error) {
                    console.warn("Anrufangebot konnte nicht zwischengespeichert werden:", error.message);
                }
            }
            io.to(`user-${toUserId}`).emit("call:incoming", {
                callId: data.callId,
                fromUserId: userId,
                fromUsername: displayName,
                video: !!data.video,
                offer: data.offer
            });
            if (!recipientOnline) {
                await pushToUser(toUserId, mode, {
                    kind: "call",
                    title: `Anruf von ${displayName}`,
                    body: data.video ? "Eingehender Videoanruf" : "Eingehender Anruf",
                    callId: String(data.callId || ""),
                    url: "/chat.html"
                });
            }
        });

        socket.on("call:fetch-pending", async () => {
            try {
                const [pendingCalls] = await db.execute(`
                    SELECT call_id AS callId, caller_user_id AS fromUserId,
                           caller_name AS fromUsername, video, offer
                    FROM pending_call_offers
                    WHERE recipient_user_id=? AND mode=? AND expires_at > NOW()
                    ORDER BY created_at ASC
                `, [userId, mode]);
                await db.execute("DELETE FROM pending_call_offers WHERE recipient_user_id=? AND mode=?", [userId, mode]);
                for (const call of pendingCalls) {
                    socket.emit("call:incoming", {
                        ...call,
                        offer: typeof call.offer === "string" ? JSON.parse(call.offer) : call.offer
                    });
                }
                const [pendingGroups] = await db.execute(`
                    SELECT call_id AS callId, group_id AS groupId,
                           caller_user_id AS fromUserId, caller_name AS fromUsername, video
                    FROM pending_group_call_invites
                    WHERE recipient_user_id=? AND mode=? AND expires_at > NOW()
                    ORDER BY created_at ASC
                `, [userId, mode]);
                await db.execute("DELETE FROM pending_group_call_invites WHERE recipient_user_id=? AND mode=?", [userId, mode]);
                for (const invite of pendingGroups) {
                    socket.emit("groupCall:incoming", { ...invite, video: !!invite.video });
                }
                await db.execute("DELETE FROM pending_group_call_invites WHERE expires_at <= NOW()");
                await db.execute("DELETE FROM pending_call_offers WHERE expires_at <= NOW()");
            } catch (error) {
                console.warn("Ausstehende Anrufe konnten nicht geladen werden:", error.message);
            }
        });

        socket.on("call:answer", data => {
            const toUserId = Number(data?.toUserId);
            if (!Number.isInteger(toUserId) || toUserId <= 0) return;
            io.to(`user-${toUserId}`).emit("call:answer", {
                callId: data.callId,
                fromUserId: userId,
                answer: data.answer
            });
        });

        socket.on("call:ice", data => {
            const toUserId = Number(data?.toUserId);
            if (!Number.isInteger(toUserId) || toUserId <= 0) return;
            io.to(`user-${toUserId}`).emit("call:ice", {
                callId: data.callId,
                fromUserId: userId,
                candidate: data.candidate
            });
        });

        socket.on("call:reject", data => {
            const toUserId = Number(data?.toUserId);
            if (!Number.isInteger(toUserId) || toUserId <= 0) return;
            io.to(`user-${toUserId}`).emit("call:rejected", {
                callId: data.callId,
                fromUserId: userId,
                reason: data.reason || "rejected"
            });
        });

        socket.on("call:busy", data => {
            const toUserId = Number(data?.toUserId);
            if (!Number.isInteger(toUserId) || toUserId <= 0) return;
            io.to(`user-${toUserId}`).emit("call:rejected", {
                callId: data.callId,
                fromUserId: userId,
                reason: "busy"
            });
        });

        socket.on("call:end", data => {
            const toUserId = Number(data?.toUserId);
            if (!Number.isInteger(toUserId) || toUserId <= 0) return;
            io.to(`user-${toUserId}`).emit("call:ended", {
                callId: data.callId,
                fromUserId: userId
            });
        });

        socket.on("groupCall:invite", async data => {
            try {
                const groupId = Number(data?.groupId);
                const callId = typeof data?.callId === "string" ? data.callId.slice(0, 128) : "";
                if (mode === "school" || !Number.isInteger(groupId) || groupId <= 0 || !callId) return;
                const group = await getGroupForUser(groupId, userId);
                if (!group) return;
                const [members] = await db.execute(`
                    SELECT user_id AS userId
                    FROM group_members
                    WHERE group_id=? AND user_id<>?
                `, [groupId, userId]);

                for (const member of members) {
                    const recipientId = Number(member.userId);
                    const recipientOnline = !!io.sockets.adapter.rooms.get(`user-${recipientId}`)?.size;
                    if (recipientOnline) {
                        io.to(`user-${recipientId}`).emit("groupCall:incoming", {
                            callId,
                            groupId,
                            fromUserId: userId,
                            fromUsername: displayName,
                            video: !!data.video
                        });
                        continue;
                    }

                    await db.execute(`
                        INSERT INTO pending_group_call_invites
                            (call_id, recipient_user_id, mode, group_id, caller_user_id, caller_name, video, expires_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 90 SECOND))
                        ON DUPLICATE KEY UPDATE group_id=VALUES(group_id), caller_user_id=VALUES(caller_user_id), caller_name=VALUES(caller_name), video=VALUES(video), expires_at=VALUES(expires_at)
                    `, [callId, recipientId, mode, groupId, userId, displayName, data.video ? 1 : 0]);

                    void pushToUser(recipientId, mode, {
                        kind: "call",
                        title: `Gruppenanruf von ${displayName}`,
                        body: data.video ? "Eingehender Gruppen-Videoanruf" : "Eingehender Gruppenanruf",
                        callId,
                        url: "/chat.html"
                    });
                }
            } catch (error) {
                console.error("❌ Gruppenanruf-Einladung:", error);
            }
        });

        socket.on("groupCall:accepted", data => {
            const callerId = Number(data?.callerId);
            if (!Number.isInteger(callerId) || callerId <= 0) return;
            io.to(`user-${callerId}`).emit("groupCall:accepted", {
                callId: data.callId,
                groupId: Number(data.groupId),
                userId,
                username: displayName,
                video: !!data.video
            });
        });

        socket.on("groupCall:rejected", data => {
            const callerId = Number(data?.callerId);
            if (!Number.isInteger(callerId) || callerId <= 0) return;
            io.to(`user-${callerId}`).emit("groupCall:rejected", {
                callId: data.callId,
                groupId: Number(data.groupId),
                userId,
                username: displayName
            });
        });

        socket.on("groupCall:offer", data => {
            const toUserId = Number(data?.toUserId);
            if (!Number.isInteger(toUserId) || toUserId <= 0) return;
            io.to(`user-${toUserId}`).emit("groupCall:offer", {
                callId: data.callId,
                groupId: Number(data.groupId),
                fromUserId: userId,
                fromUsername: displayName,
                video: !!data.video,
                offer: data.offer
            });
        });

        socket.on("groupCall:answer", data => {
            const toUserId = Number(data?.toUserId);
            if (!Number.isInteger(toUserId) || toUserId <= 0) return;
            io.to(`user-${toUserId}`).emit("groupCall:answer", {
                callId: data.callId,
                groupId: Number(data.groupId),
                fromUserId: userId,
                answer: data.answer
            });
        });

        socket.on("groupCall:ice", data => {
            const toUserId = Number(data?.toUserId);
            if (!Number.isInteger(toUserId) || toUserId <= 0) return;
            io.to(`user-${toUserId}`).emit("groupCall:ice", {
                callId: data.callId,
                groupId: Number(data.groupId),
                fromUserId: userId,
                candidate: data.candidate
            });
        });

        socket.on("groupCall:end", async data => {
            try {
                const groupId = Number(data?.groupId);
                if (!Number.isInteger(groupId) || groupId <= 0) return;
                const group = await getGroupForUser(groupId, userId);
                if (!group) return;
                await db.execute("DELETE FROM pending_group_call_invites WHERE call_id=? AND group_id=?", [String(data?.callId || "").slice(0, 128), groupId]);
                io.to(`group-${groupId}`).emit("groupCall:ended", {
                    callId: data.callId,
                    groupId,
                    fromUserId: userId
                });
            } catch (error) {
                console.warn("Gruppenanruf konnte nicht beendet werden:", error.message);
            }
        });

        // =================================================
        // DISCONNECT
        // =================================================

        socket.on(
            "disconnect",
            reason => {

                console.log(
                    `Benutzer getrennt: ${username} (${socket.id}) – ${reason}`
                );
            }
        );


    });


// =====================================================
// AUSSTEHENDE FREUNDSCHAFTSANFRAGEN AN SOCKET SENDEN
// =====================================================

async function sendPendingFriendRequests(
    socket
) {

    try {

        const userId =
            Number(
                socket.user.userId
            );

        const mode =
            socket.user.mode ||
            "standard";

        const table =
            mode === "school"
                ? "school_users"
                : "users";

        const [requests] =
            await db.execute(
                `
                SELECT
                    fr.id,
                    fr.sender_id AS senderId,
                    fr.receiver_id AS receiverId,
                    fr.status,
                    fr.mode,
                    u.username,
                    u.profile_picture AS profilePicture
                FROM friend_requests fr
                INNER JOIN ${table} u
                    ON u.id = fr.sender_id
                WHERE
                    fr.receiver_id = ?
                    AND fr.status = 'pending'
                    AND fr.mode = ?
                ORDER BY
                    fr.id DESC
                `,
                [
                    userId,
                    mode,
                ]
            );

        socket.emit(
            "pendingFriendRequests",
            requests
        );

    } catch (error) {

        console.error(
            "❌ Fehler beim Laden der Freundschaftsanfragen:",
            error
        );
    }
}


// =====================================================
// MULTER-FEHLER
// =====================================================

app.use(
    (
        error,
        req,
        res,
        next
    ) => {

        if (
            error instanceof
            multer.MulterError
        ) {

            if (
                error.code ===
                "LIMIT_FILE_SIZE"
            ) {

                return res.status(400).json({
                    error:
                        "Die Datei ist zu groß. Maximal 100 MB für Medien erlaubt."
                });
            }

            return res.status(400).json({
                error:
                    "Fehler beim Datei-Upload."
            });
        }

        if (
            error &&
            error.message ===
                "Nur JPG, PNG, GIF und WebP sind erlaubt."
        ) {

            return res.status(400).json({
                error:
                    error.message
            });
        }

        next(error);
    }
);


// =====================================================
// ALLGEMEINE FEHLERBEHANDLUNG
// =====================================================

app.use(
    (
        error,
        req,
        res,
        next
    ) => {

        console.error(
            "❌ Unbehandelter Serverfehler:",
            error
        );

        if (
            res.headersSent
        ) {

            return next(
                error
            );
        }

        return res.status(500).json({
            error:
                "Interner Serverfehler."
        });
    }
);


// =====================================================
// ANZEIGENAME ÄNDERN
// =====================================================

app.post("/api/change-display-name", authenticateToken, async (req, res) => {
    try {
        const displayName = typeof req.body?.displayName === "string" ? req.body.displayName.trim() : "";
        if (displayName.length < 1 || displayName.length > 50) return res.status(400).json({error:"Der Anzeigename muss zwischen 1 und 50 Zeichen lang sein."});
        const table = getUserTable(req);
        const userId = Number(req.user.userId);
        await db.execute(`UPDATE ${table} SET display_name = ? WHERE id = ?`, [displayName, userId]);

        const [updatedUserRows] = await db.execute(
            `SELECT username, display_name AS displayName FROM ${table} WHERE id = ? LIMIT 1`,
            [userId]
        );
        const updatedUser = updatedUserRows[0] || {};
        await emitProfileUpdated(
            userId,
            req.user.mode === "school" ? "school" : "standard",
            updatedUser.username,
            updatedUser.displayName || displayName
        );

        return res.json({success:true, displayName});
    } catch (error) {
        console.error("❌ Anzeigename-Fehler:", error);
        return res.status(500).json({error:"Anzeigename konnte nicht geändert werden."});
    }
});


// =====================================================
// SERVER-FEHLER
// =====================================================

server.on(
    "error",
    error => {

        if (
            error.code ===
            "EADDRINUSE"
        ) {

            console.error(
                `❌ Port ${PORT} wird bereits verwendet.`
            );

            process.exit(1);

        } else {

            console.error(
                "❌ Serverfehler:",
                error
            );
        }
    }
);


// =====================================================
// FREUNDSCHAFTS-SCHEMA SICHERSTELLEN
// =====================================================

async function ensureFriendRequestSchema() {
    await db.execute(`
        CREATE TABLE IF NOT EXISTS friend_requests (
            id INT AUTO_INCREMENT PRIMARY KEY,
            sender_id INT NOT NULL,
            receiver_id INT NOT NULL,
            status ENUM('pending','accepted','rejected') NOT NULL DEFAULT 'pending',
            mode VARCHAR(20) NOT NULL DEFAULT 'standard',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_friend_receiver_status_mode (receiver_id, status, mode),
            INDEX idx_friend_sender_status_mode (sender_id, status, mode)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    const [columns] = await db.execute(`SHOW COLUMNS FROM friend_requests`);
    const hasMode = columns.some(c => c.Field === "mode");
    if (!hasMode) {
        await db.execute(`ALTER TABLE friend_requests ADD COLUMN mode VARCHAR(20) NOT NULL DEFAULT 'standard'`);
        console.log("🔧 friend_requests.mode wurde hinzugefügt.");
    }

    // Alte Datensätze ohne Edition gehören zur Standard Edition.
    await db.execute(`UPDATE friend_requests SET mode = 'standard' WHERE mode IS NULL OR mode = ''`);

    // Alte Unique-Keys (sender_id, receiver_id) entfernen.
    const [indexes] = await db.execute(`SHOW INDEX FROM friend_requests`);
    const groups = {};
    for (const row of indexes) {
        if (row.Key_name === "PRIMARY") continue;
        groups[row.Key_name] ??= [];
        groups[row.Key_name].push(row);
    }
    for (const [name, rows] of Object.entries(groups)) {
        const ordered = rows.sort((a,b) => Number(a.Seq_in_index)-Number(b.Seq_in_index));
        const cols = ordered.map(x => x.Column_name);
        const isBadUnique = ordered[0]?.Non_unique === 0 && cols.length === 2 && cols[0] === "sender_id" && cols[1] === "receiver_id";
        if (isBadUnique) {
            await db.execute(`ALTER TABLE friend_requests DROP INDEX \`${name.replace(/`/g, "") }\``);
            console.log(`🔧 Alter Friend-Unique-Key ${name} entfernt.`);
        }
    }

    console.log("✅ friend_requests Schema ist editionssicher.");
}


// =====================================================
// FREUNDSCHAFTS-INDEX MIGRATION
// =====================================================
// Ältere PrivLines-Datenbanken hatten teilweise:
// UNIQUE(sender_id, receiver_id)
//
// Das ist für Standard + School falsch, weil dieselben
// numerischen IDs in beiden Tabellen vorkommen können.
// Der Unique-Key muss deshalb mode mit berücksichtigen.

async function ensureFriendRequestUniqueIndex() {

    try {

        const [indexes] =
            await db.execute(
                `
                SHOW INDEX
                FROM friend_requests
                WHERE Key_name = 'unique_friend_request'
                `
            );

        const uniqueColumns =
            indexes
                .sort(
                    (a, b) =>
                        Number(a.Seq_in_index) -
                        Number(b.Seq_in_index)
                )
                .map(
                    index =>
                        index.Column_name
                );

        const correctIndex =
            uniqueColumns.length === 3 &&
            uniqueColumns[0] === "sender_id" &&
            uniqueColumns[1] === "receiver_id" &&
            uniqueColumns[2] === "mode";

        if (correctIndex) {
            return;
        }

        const [allIndexes] = await db.execute(`SHOW INDEX FROM friend_requests`);
        const hasCorrectUnique = Object.values(allIndexes.reduce((acc, row) => {
            if (row.Key_name === "PRIMARY") return acc;
            (acc[row.Key_name] ??= []).push(row);
            return acc;
        }, {})).some(rows => {
            const ordered = rows.sort((a,b) => Number(a.Seq_in_index)-Number(b.Seq_in_index));
            return ordered[0]?.Non_unique === 0 && ordered.map(x=>x.Column_name).join(",") === "sender_id,receiver_id,mode";
        });

        if (hasCorrectUnique) {
            console.log("✅ friend_requests Unique-Key ist bereits korrekt vorhanden.");
            return;
        }

        if (!correctIndex) {

            // Nur den bekannten alten Index entfernen.
            if (indexes.length > 0) {

                await db.execute(
                    `
                    ALTER TABLE friend_requests
                    DROP INDEX unique_friend_request
                    `
                );

                console.log(
                    "🔧 Alter friend_requests-Unique-Key wurde korrigiert."
                );
            }

            // Eventuelle doppelte Datensätze innerhalb derselben
            // Edition bereinigen, bevor der neue Unique-Key angelegt wird.
            const [duplicates] =
                await db.execute(
                    `
                    SELECT
                        sender_id,
                        receiver_id,
                        mode,
                        COUNT(*) AS amount,
                        GROUP_CONCAT(
                            id
                            ORDER BY
                                CASE
                                    WHEN status = 'accepted'
                                    THEN 0
                                    ELSE 1
                                END,
                                id DESC
                            SEPARATOR ','
                        ) AS ids
                    FROM friend_requests
                    GROUP BY
                        sender_id,
                        receiver_id,
                        mode
                    HAVING COUNT(*) > 1
                    `
                );

            for (
                const duplicate of duplicates
            ) {

                const ids =
                    String(
                        duplicate.ids || ""
                    )
                        .split(",")
                        .map(Number)
                        .filter(
                            Number.isInteger
                        );

                const keepId =
                    ids.shift();

                if (
                    !keepId ||
                    ids.length === 0
                ) {
                    continue;
                }

                const placeholders =
                    ids.map(() => "?").join(",");

                await db.execute(
                    `
                    DELETE FROM friend_requests
                    WHERE id IN (${placeholders})
                    `,
                    ids
                );

                console.log(
                    `🔧 ${ids.length} doppelte Freundschaftsanfrage(n) bereinigt (behalten: ${keepId}).`
                );
            }

            await db.execute(
                `
                ALTER TABLE friend_requests
                ADD UNIQUE INDEX unique_friend_request
                (
                    sender_id,
                    receiver_id,
                    mode
                )
                `
            );

            console.log(
                "✅ friend_requests Unique-Key ist jetzt editionssicher."
            );
        }

    } catch (error) {

        console.error(
            "⚠️ friend_requests-Index konnte nicht automatisch korrigiert werden:",
            error
        );

        console.error(
            "   Prüfe in MariaDB: UNIQUE(sender_id, receiver_id, mode)"
        );
    }
}


// =====================================================
// USER-NAMEN / ANZEIGENAME MIGRATION
// =====================================================

async function ensureUserNameSchema() {
    for (const table of ["users", "school_users"]) {
        const [columns] = await db.execute(`SHOW COLUMNS FROM ${table} LIKE 'display_name'`);
        if (columns.length === 0) {
            await db.execute(`ALTER TABLE ${table} ADD COLUMN display_name VARCHAR(50) NOT NULL DEFAULT '' AFTER username`);
        }
        await db.execute(`UPDATE ${table} SET display_name = username WHERE display_name IS NULL OR display_name = ''`);
    }
    console.log("✅ Zwei Namen pro Account aktiviert: Anzeigename + eindeutiger Benutzername.");
}

async function ensurePrivateChatSchema() {
    const [columns] = await db.execute(`SHOW COLUMNS FROM chats LIKE 'mode'`);
    if (columns.length === 0) {
        await db.execute(`ALTER TABLE chats ADD COLUMN mode VARCHAR(20) NOT NULL DEFAULT 'standard'`);
    }

    const [indexes] = await db.execute(`SHOW INDEX FROM chats`);
    const groups = {};
    for (const row of indexes) {
        if (row.Key_name === "PRIMARY") continue;
        groups[row.Key_name] ??= [];
        groups[row.Key_name].push(row);
    }
    for (const [name, rows] of Object.entries(groups)) {
        const ordered = rows.sort((a,b) => Number(a.Seq_in_index)-Number(b.Seq_in_index));
        const cols = ordered.map(x => x.Column_name);
        if (ordered[0]?.Non_unique === 0 && cols.length === 2 && cols[0] === "user1_id" && cols[1] === "user2_id") {
            await db.execute(`ALTER TABLE chats DROP INDEX \`${name.replace(/`/g, "") }\``);
            console.log(`🔧 Alter Chat-Unique-Key ${name} entfernt.`);
        }
    }

    const [finalIndexes] = await db.execute(`SHOW INDEX FROM chats`);
    const finalGroups = {};
    for (const row of finalIndexes) {
        if (row.Key_name === "PRIMARY") continue;
        finalGroups[row.Key_name] ??= [];
        finalGroups[row.Key_name].push(row);
    }
    const hasCorrect = Object.values(finalGroups).some(rows => {
        const ordered = rows.sort((a,b) => Number(a.Seq_in_index)-Number(b.Seq_in_index));
        return ordered[0]?.Non_unique === 0 && ordered.map(x=>x.Column_name).join(",") === "user1_id,user2_id,mode";
    });
    if (!hasCorrect) {
        try {
            await db.execute(`CREATE UNIQUE INDEX unique_chat_users_mode ON chats(user1_id,user2_id,mode)`);
        } catch (error) {
            if (error?.code !== "ER_DUP_KEYNAME") throw error;
        }
    }
    console.log("✅ Private Chats sind für Standard und School getrennt aktiviert.");
}


// =====================================================

async function ensureUserNameSchema() {
    for (const table of ["users", "school_users"]) {
        const [columns] = await db.execute(`SHOW COLUMNS FROM ${table} LIKE 'display_name'`);
        if (columns.length === 0) {
            await db.execute(`ALTER TABLE ${table} ADD COLUMN display_name VARCHAR(50) NOT NULL DEFAULT '' AFTER username`);
        }
        await db.execute(`UPDATE ${table} SET display_name = username WHERE display_name IS NULL OR display_name = ''`);
    }
    console.log("✅ Zwei Namen pro Account aktiviert: Anzeigename + eindeutiger Benutzername.");
}

async function ensurePrivateChatSchema() {
    const [columns] = await db.execute(`SHOW COLUMNS FROM chats LIKE 'mode'`);
    if (columns.length === 0) {
        await db.execute(`ALTER TABLE chats ADD COLUMN mode VARCHAR(20) NOT NULL DEFAULT 'standard'`);
    }

    const [indexes] = await db.execute(`SHOW INDEX FROM chats`);
    const groups = {};
    for (const row of indexes) {
        if (row.Key_name === "PRIMARY") continue;
        groups[row.Key_name] ??= [];
        groups[row.Key_name].push(row);
    }
    for (const [name, rows] of Object.entries(groups)) {
        const ordered = rows.sort((a,b) => Number(a.Seq_in_index)-Number(b.Seq_in_index));
        const cols = ordered.map(x => x.Column_name);
        if (ordered[0]?.Non_unique === 0 && cols.length === 2 && cols[0] === "user1_id" && cols[1] === "user2_id") {
            await db.execute(`ALTER TABLE chats DROP INDEX \`${name.replace(/`/g, "") }\``);
            console.log(`🔧 Alter Chat-Unique-Key ${name} entfernt.`);
        }
    }

    const [finalIndexes] = await db.execute(`SHOW INDEX FROM chats`);
    const finalGroups = {};
    for (const row of finalIndexes) {
        if (row.Key_name === "PRIMARY") continue;
        finalGroups[row.Key_name] ??= [];
        finalGroups[row.Key_name].push(row);
    }
    const hasCorrect = Object.values(finalGroups).some(rows => {
        const ordered = rows.sort((a,b) => Number(a.Seq_in_index)-Number(b.Seq_in_index));
        return ordered[0]?.Non_unique === 0 && ordered.map(x=>x.Column_name).join(",") === "user1_id,user2_id,mode";
    });
    if (!hasCorrect) {
        try {
            await db.execute(`CREATE UNIQUE INDEX unique_chat_users_mode ON chats(user1_id,user2_id,mode)`);
        } catch (error) {
            if (error?.code !== "ER_DUP_KEYNAME") throw error;
        }
    }
    console.log("✅ Private Chats sind für Standard und School getrennt aktiviert.");
}

async function ensurePushSchema() {
    await db.execute(`
        CREATE TABLE IF NOT EXISTS push_subscriptions (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            user_id BIGINT NOT NULL,
            mode VARCHAR(20) NOT NULL DEFAULT 'standard',
            endpoint VARCHAR(2048) NOT NULL,
            endpoint_hash CHAR(64) NOT NULL,
            p256dh VARCHAR(128) NOT NULL,
            auth VARCHAR(64) NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY push_endpoint_unique (endpoint_hash),
            KEY push_user_lookup (user_id, mode)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await db.execute(`
        CREATE TABLE IF NOT EXISTS pending_call_offers (
            call_id VARCHAR(128) NOT NULL,
            recipient_user_id BIGINT UNSIGNED NOT NULL,
            mode VARCHAR(20) NOT NULL DEFAULT 'standard',
            caller_user_id BIGINT UNSIGNED NOT NULL,
            caller_name VARCHAR(100) NOT NULL,
            video TINYINT(1) NOT NULL DEFAULT 0,
            offer LONGTEXT NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            expires_at DATETIME NOT NULL,
            PRIMARY KEY (call_id, recipient_user_id, mode),
            KEY pending_calls_expiration (expires_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await db.execute(`
        CREATE TABLE IF NOT EXISTS pending_group_call_invites (
            call_id VARCHAR(128) NOT NULL,
            recipient_user_id BIGINT UNSIGNED NOT NULL,
            mode VARCHAR(20) NOT NULL DEFAULT 'standard',
            group_id BIGINT UNSIGNED NOT NULL,
            caller_user_id BIGINT UNSIGNED NOT NULL,
            caller_name VARCHAR(100) NOT NULL,
            video TINYINT(1) NOT NULL DEFAULT 0,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            expires_at DATETIME NOT NULL,
            PRIMARY KEY (call_id, recipient_user_id, mode),
            KEY pending_group_calls_expiration (expires_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("✅ Hintergrund-Push für Nachrichten und Anrufe aktiviert.");
}


// =====================================================
// SERVER START
// =====================================================

server.listen(
    PORT,
    async () => {

        console.log("");
        console.log(
            "=========================================="
        );
        console.log(
            "        PRIVLINES SERVER STARTET"
        );
        console.log(
            "=========================================="
        );
        console.log(
            `🌐 http://localhost:${PORT}`
        );
        console.log(
            "------------------------------------------"
        );
        console.log(
            "🔐 Standard Login → users"
        );
        console.log(
            "🏫 School Login → school_users"
        );
        console.log(
            "💬 Freundschaftssystem aktiviert"
        );
        console.log(
            "💬 Private Chats aktiviert"
        );
        console.log(
            "🔔 Benachrichtigungen aktiviert"
        );
        console.log(
            "📷 Profilbilder aktiviert"
        );
        console.log(
            "🖼️ Bild-Uploads aktiviert"
        );
        console.log(
            "🚫 Blockieren aktiviert"
        );
        console.log(
            "📨 Nachrichten nach Entblocken möglich"
        );
        console.log(
            "🤝 Entfreunden aktiviert"
        );
        console.log(
            "🏫 Schulkanäle aktiviert"
        );
        console.log(
            "📚 School Edition aktiviert"
        );
        console.log(
            "🛒 Standard Edition Shop bleibt aktiv"
        );
        console.log(
            "🤖 PrivLines AI aktiviert"
        );
        console.log(
            "☁️ Cloudflare Workers AI"
        );
        console.log(
            "------------------------------------------"
        );
        console.log(
            "📁 Erlaubte Bilder: JPG, PNG, GIF, WebP"
        );
        console.log(
            "📦 Maximale Bildgröße: 10 MB"
        );
        console.log(
            "=========================================="
        );
        console.log("");

        try {

            await db.execute(
                "SELECT 1"
            );

            console.log(
                "✅ MariaDB-Verbindung erfolgreich."
            );

            await ensureSchoolChannelSystem();
            await ensureBlockedUserSchema();
            await ensureGroupSchema();
            await ensureUserNameSchema();
            await ensurePrivateChatSchema();
            await rotateAllExpiredSchoolCodes();
            setInterval(rotateAllExpiredSchoolCodes, 60 * 60 * 1000);

            await ensurePushSchema();
            await ensureFriendRequestSchema();
            await ensureFriendRequestUniqueIndex();

        } catch (error) {

            console.error(
                "❌ MariaDB-Verbindung fehlgeschlagen:",
                error
            );
        }
    }
);
