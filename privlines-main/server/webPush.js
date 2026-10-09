const crypto = require("crypto");

const b64url = value => Buffer.from(value).toString("base64url");
const fromB64url = value => Buffer.from(String(value || ""), "base64url");

function getKeys() {
    const publicKey = fromB64url(process.env.VAPID_PUBLIC_KEY);
    const privateKey = fromB64url(process.env.VAPID_PRIVATE_KEY);
    if (publicKey.length !== 65 || privateKey.length !== 32) return null;
    return { publicKey, privateKey };
}

function vapidToken(endpoint, keys) {
    const url = new URL(endpoint);
    const publicKey = keys.publicKey;
    const key = crypto.createPrivateKey({
        key: {
            kty: "EC",
            crv: "P-256",
            x: b64url(publicKey.subarray(1, 33)),
            y: b64url(publicKey.subarray(33, 65)),
            d: b64url(keys.privateKey)
        },
        format: "jwk"
    });
    const header = b64url(JSON.stringify({ typ: "JWT", alg: "ES256" }));
    const claims = b64url(JSON.stringify({
        aud: `${url.protocol}//${url.host}`,
        exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
        sub: process.env.VAPID_SUBJECT || "mailto:admin@privlines.app"
    }));
    const input = `${header}.${claims}`;
    const signature = crypto.sign("sha256", Buffer.from(input), {
        key,
        dsaEncoding: "ieee-p1363"
    });
    return `${input}.${b64url(signature)}`;
}

function encryptPayload(subscription, payload) {
    const userPublicKey = fromB64url(subscription.keys?.p256dh);
    const authSecret = fromB64url(subscription.keys?.auth);
    if (userPublicKey.length !== 65 || authSecret.length !== 16) {
        throw new Error("Ungültige Push-Schlüssel.");
    }

    const ecdh = crypto.createECDH("prime256v1");
    ecdh.generateKeys();
    const serverPublicKey = ecdh.getPublicKey();
    const sharedSecret = ecdh.computeSecret(userPublicKey);
    const keyInfo = Buffer.concat([
        Buffer.from("WebPush: info\0", "utf8"),
        userPublicKey,
        serverPublicKey
    ]);
    const inputKeyMaterial = Buffer.from(crypto.hkdfSync(
        "sha256", sharedSecret, authSecret, keyInfo, 32
    ));
    const salt = crypto.randomBytes(16);
    const contentKey = Buffer.from(crypto.hkdfSync(
        "sha256", inputKeyMaterial, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16
    ));
    const nonce = Buffer.from(crypto.hkdfSync(
        "sha256", inputKeyMaterial, salt, Buffer.from("Content-Encoding: nonce\0"), 12
    ));

    const cipher = crypto.createCipheriv("aes-128-gcm", contentKey, nonce);
    const plaintext = Buffer.concat([Buffer.from(JSON.stringify(payload)), Buffer.from([2])]);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
    const recordSize = Buffer.alloc(4);
    recordSize.writeUInt32BE(4096);
    return Buffer.concat([
        salt,
        recordSize,
        Buffer.from([serverPublicKey.length]),
        serverPublicKey,
        ciphertext
    ]);
}

async function sendPush(subscription, payload) {
    const keys = getKeys();
    if (!keys) return { ok: false, reason: "vapid_not_configured" };
    const response = await fetch(subscription.endpoint, {
        method: "POST",
        headers: {
            "Authorization": `vapid t=${vapidToken(subscription.endpoint, keys)}, k=${b64url(keys.publicKey)}`,
            "Content-Encoding": "aes128gcm",
            "Content-Type": "application/octet-stream",
            "TTL": "86400"
        },
        body: encryptPayload(subscription, payload)
    });
    return { ok: response.ok, status: response.status };
}

module.exports = { getKeys, sendPush };
