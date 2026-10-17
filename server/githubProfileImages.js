const path = require("path");

const API_BASE = "https://api.github.com";

function getConfig() {
    const token = process.env.GITHUB_PROFILE_IMAGES_TOKEN;
    const repository = process.env.GITHUB_PROFILE_IMAGES_REPO || "ConstiLX/privlines-profile-images";
    if (!token || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) return null;
    return {
        token,
        repository,
        branch: process.env.GITHUB_PROFILE_IMAGES_BRANCH || "main"
    };
}

function isConfigured() {
    return !!getConfig();
}

function apiUrl(config, filePath = "") {
    const encodedPath = filePath
        .split("/")
        .map(segment => encodeURIComponent(segment))
        .join("/");
    return `${API_BASE}/repos/${config.repository}/contents/${encodedPath}`;
}

async function request(url, method, body, accept = "application/vnd.github+json") {
    const config = getConfig();
    if (!config) throw new Error("GitHub-Profilbildspeicher ist nicht konfiguriert.");

    const response = await fetch(url, {
        method,
        headers: {
            Authorization: `Bearer ${config.token}`,
            Accept: accept,
            "X-GitHub-Api-Version": "2022-11-28",
            ...(body ? { "Content-Type": "application/json" } : {})
        },
        ...(body ? { body: JSON.stringify(body) } : {})
    });

    if (response.status === 404) return null;
    if (!response.ok) {
        const error = new Error(`GitHub-Profilbildspeicher antwortete mit HTTP ${response.status}.`);
        error.status = response.status;
        throw error;
    }
    return response;
}

async function upload(filename, contents, commitMessage) {
    const config = getConfig();
    if (!config) throw new Error("GitHub-Profilbildspeicher ist nicht konfiguriert.");
    const filePath = `profiles/${path.basename(filename)}`;
    const response = await request(apiUrl(config, filePath), "PUT", {
        message: commitMessage || "Store PrivLines profile image",
        content: contents.toString("base64"),
        branch: config.branch
    });
    return response.json();
}

async function get(filename) {
    const config = getConfig();
    if (!config) return null;
    const filePath = `profiles/${path.basename(filename)}`;
    const response = await request(
        apiUrl(config, filePath),
        "GET",
        null,
        "application/vnd.github.raw+json"
    );
    if (!response) return null;
    const contentTypes = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".gif": "image/gif",
        ".webp": "image/webp"
    };
    return {
        contents: Buffer.from(await response.arrayBuffer()),
        contentType: contentTypes[path.extname(filename).toLowerCase()] || "application/octet-stream"
    };
}

async function remove(filename, commitMessage) {
    const config = getConfig();
    if (!config) return false;
    const filePath = `profiles/${path.basename(filename)}`;
    const metadataResponse = await request(apiUrl(config, filePath), "GET");
    if (!metadataResponse) return false;
    const metadata = await metadataResponse.json();
    const deleteResponse = await request(apiUrl(config, filePath), "DELETE", {
        message: commitMessage || "Remove PrivLines profile image",
        sha: metadata.sha,
        branch: config.branch
    });
    return !!deleteResponse;
}

module.exports = { get, isConfigured, remove, upload };
