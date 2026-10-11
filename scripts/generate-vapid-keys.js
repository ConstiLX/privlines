const { generateKeyPairSync } = require("crypto");

const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "der" }
});

// P-256 DER keys end in the uncompressed public point and the 32-byte scalar.
const publicBytes = publicKey.subarray(-65);
const privateBytes = privateKey.subarray(-32);
if (publicBytes.length !== 65 || publicBytes[0] !== 4 || privateBytes.length !== 32) {
    throw new Error("OpenSSL returned an unexpected P-256 key format.");
}
console.log(`VAPID_PUBLIC_KEY=${publicBytes.toString("base64url")}`);
console.log(`VAPID_PRIVATE_KEY=${privateBytes.toString("base64url")}`);
console.log("VAPID_SUBJECT=mailto:admin@your-domain.example");
