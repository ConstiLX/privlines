const crypto = require("crypto");

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
let cachedAccessToken = null;

function base64url(value) {
    return Buffer.from(value).toString("base64url");
}

function getServiceAccount() {
    const encoded = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
    if (!encoded) return null;

    try {
        const account = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
        if (account.type !== "service_account" || !account.project_id || !account.client_email || !account.private_key) {
            return null;
        }
        return account;
    } catch (error) {
        console.warn("Firebase-Servicekonto konnte nicht gelesen werden:", error.message);
        return null;
    }
}

function createSignedAssertion(account) {
    const now = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claims = base64url(JSON.stringify({
        iss: account.client_email,
        scope: FCM_SCOPE,
        aud: TOKEN_URL,
        iat: now,
        exp: now + 3600
    }));
    const unsigned = `${header}.${claims}`;
    const signature = crypto.sign("RSA-SHA256", Buffer.from(unsigned), account.private_key);
    return `${unsigned}.${base64url(signature)}`;
}

async function getAccessToken(account) {
    if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60_000) {
        return cachedAccessToken.value;
    }

    const assertion = createSignedAssertion(account);
    const response = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
            assertion
        })
    });
    const result = await response.json();
    if (!response.ok || !result.access_token) {
        throw new Error(`Google OAuth fehlgeschlagen (HTTP ${response.status}).`);
    }

    cachedAccessToken = {
        value: result.access_token,
        expiresAt: Date.now() + Number(result.expires_in || 3600) * 1000
    };
    return cachedAccessToken.value;
}

async function sendAndroidPush(token, payload) {
    const account = getServiceAccount();
    if (!account) return { ok: false, disabled: true };

    const accessToken = await getAccessToken(account);
    const timeSensitive = payload?.kind === "call" || payload?.kind === "group-call" || payload?.kind === "call-ended";
    const response = await fetch(
        `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.project_id)}/messages:send`,
        {
            method: "POST",
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                message: {
                    token,
                    data: Object.fromEntries(
                        Object.entries(payload).map(([key, value]) => [key, String(value ?? "")])
                    ),
                    android: {
                        priority: "HIGH",
                        ttl: timeSensitive ? "90s" : "86400s"
                    }
                }
            })
        }
    );
    const result = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, result };
}

module.exports = { getServiceAccount, sendAndroidPush };
