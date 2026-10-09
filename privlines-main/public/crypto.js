// =====================================================
// E2EE – SCHLÜSSELVERWALTUNG
// =====================================================

const E2EE = {

    // -------------------------------------------------
    // Neues Schlüsselpaar erzeugen
    // -------------------------------------------------

    async generateKeyPair() {

        return await crypto.subtle.generateKey(
            {
                name: "RSA-OAEP",
                modulusLength: 3072,
                publicExponent: new Uint8Array([1, 0, 1]),
                hash: "SHA-256"
            },
            true,
            ["encrypt", "decrypt"]
        );

    },


    // -------------------------------------------------
    // Public Key exportieren
    // -------------------------------------------------

    async exportPublicKey(publicKey) {

        const keyData =
            await crypto.subtle.exportKey(
                "spki",
                publicKey
            );

        return this.arrayBufferToBase64(keyData);

    },


    // -------------------------------------------------
    // Private Key exportieren
    // -------------------------------------------------

    async exportPrivateKey(privateKey) {

        const keyData =
            await crypto.subtle.exportKey(
                "pkcs8",
                privateKey
            );

        return this.arrayBufferToBase64(keyData);

    },


    // -------------------------------------------------
    // Private Key wieder importieren
    // -------------------------------------------------

    async importPrivateKey(base64) {

        const keyData =
            this.base64ToArrayBuffer(base64);

        return await crypto.subtle.importKey(
            "pkcs8",
            keyData,
            {
                name: "RSA-OAEP",
                hash: "SHA-256"
            },
            true,
            ["decrypt"]
        );

    },


    // -------------------------------------------------
    // Public Key importieren
    // -------------------------------------------------

    async importPublicKey(base64) {

        const keyData =
            this.base64ToArrayBuffer(base64);

        return await crypto.subtle.importKey(
            "spki",
            keyData,
            {
                name: "RSA-OAEP",
                hash: "SHA-256"
            },
            true,
            ["encrypt"]
        );

    },


    // -------------------------------------------------
    // ArrayBuffer → Base64
    // -------------------------------------------------

    arrayBufferToBase64(buffer) {

        const bytes =
            new Uint8Array(buffer);

        let binary = "";

        for (const byte of bytes) {
            binary += String.fromCharCode(byte);
        }

        return btoa(binary);

    },


    // -------------------------------------------------
    // Base64 → ArrayBuffer
    // -------------------------------------------------

    base64ToArrayBuffer(base64) {

        const binary =
            atob(base64);

        const bytes =
            new Uint8Array(binary.length);

        for (let i = 0; i < binary.length; i++) {

            bytes[i] =
                binary.charCodeAt(i);

        }

        return bytes.buffer;

    }

};