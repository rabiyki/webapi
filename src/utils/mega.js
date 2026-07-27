const fs = require("fs");
const path = require("path");
const { Storage } = require("megajs"); // npm i megajs
const { ax } = require("./http");

// 👇 GitHub raw URL — tomar repo er raw link
const MEGA_ACCOUNTS_URL = "https://raw.githubusercontent.com/xoo59568-art/webapi/refs/heads/main/data/megaaccount.json";

const LOCAL_ACCOUNTS_PATH = path.join(__dirname, "..", "data", "megaaccount.json");

// Cache so we don't hit GitHub on every single upload
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
let cachedAccounts = null;
let cachedAt = 0;

function loadLocalAccounts() {
  if (!fs.existsSync(LOCAL_ACCOUNTS_PATH)) {
    throw new Error("data/megaaccount.json not found");
  }

  const raw = fs.readFileSync(LOCAL_ACCOUNTS_PATH, "utf-8");
  const accounts = JSON.parse(raw);

  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new Error("data/megaaccount.json is empty — add at least one account");
  }

  return accounts.filter(a => a.email && a.password);
}

async function loadRemoteAccounts() {
  const { data } = await ax.get(MEGA_ACCOUNTS_URL, { timeout: 10000 });
  const accounts = typeof data === "string" ? JSON.parse(data) : data;

  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new Error("Remote megaaccount.json is empty or invalid");
  }

  return accounts.filter(a => a.email && a.password);
}

/**
 * Loads mega accounts. If MEGA_ACCOUNTS_URL is set (a GitHub raw link,
 * etc.), fetches the account list from there — cached for CACHE_TTL_MS
 * so every upload doesn't re-fetch. Falls back to the local
 * data/megaaccount.json file if the URL isn't set, or if the remote
 * fetch fails and a local file exists as backup.
 */
async function loadAccounts() {
  const now = Date.now();
  if (cachedAccounts && (now - cachedAt) < CACHE_TTL_MS) {
    return cachedAccounts;
  }

  let accounts;

  if (MEGA_ACCOUNTS_URL) {
    try {
      accounts = await loadRemoteAccounts();
    } catch (e) {
      console.error("[mega] remote account fetch failed, falling back to local file:", e.message);
      accounts = loadLocalAccounts();
    }
  } else {
    accounts = loadLocalAccounts();
  }

  cachedAccounts = accounts;
  cachedAt = now;
  return accounts;
}

async function pickRandomAccount() {
  const accounts = await loadAccounts();
  const idx = Math.floor(Math.random() * accounts.length);
  return accounts[idx];
}

/**
 * Same pattern as the baileys session-id project's mega.js:
 *   const link = await upload(buffer, "file.json");
 *
 * Picks a random account (remote or local), logs in, uploads the
 * buffer, and returns just the mega.nz link (string).
 */
async function upload(buffer, name) {
  const account = await pickRandomAccount();

  const storage = await new Storage({
    email: account.email,
    password: account.password,
    userAgent: "Mozilla/5.0"
  }).ready;

  try {
    const uploadedFile = await storage.upload({
      name,
      size: buffer.length
    }, buffer).complete;

    const link = await uploadedFile.link({ noKey: false });
    return link;
  } finally {
    // Always close the session so we don't leak open connections
    storage.close();
  }
}

/**
 * Wrapper for our /api/upload route, which works with multer's
 * file object ({ originalname, mimetype, size, buffer }) and
 * expects the { realUrl, size, type, uploaded } shape the other
 * providers (ar-hosting, catbox, etc.) return.
 */
async function uploadFileToMega(file) {
  const link = await upload(file.buffer, file.originalname);

  return {
    realUrl: link,
    size: file.size || null,
    type: file.mimetype || null,
    uploaded: new Date().toISOString()
  };
}

module.exports = { upload, uploadFileToMega, pickRandomAccount, loadAccounts };
