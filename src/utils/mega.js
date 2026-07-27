const fs = require("fs");
const path = require("path");
const { Storage } = require("megajs"); // npm i megajs

const ACCOUNTS_PATH = path.join(__dirname, "..", "data", "megaaccount.json");

/**
 * Loads every {email, password} pair from data/megaaccount.json.
 * File can have 1 account or 50 — doesn't matter.
 */
function loadAccounts() {
  if (!fs.existsSync(ACCOUNTS_PATH)) {
    throw new Error("data/megaaccount.json not found");
  }

  const raw = fs.readFileSync(ACCOUNTS_PATH, "utf-8");
  const accounts = JSON.parse(raw);

  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new Error("data/megaaccount.json is empty — add at least one account");
  }

  return accounts.filter(a => a.email && a.password);
}

function pickRandomAccount() {
  const accounts = loadAccounts();
  const idx = Math.floor(Math.random() * accounts.length);
  return accounts[idx];
}

/**
 * Same pattern as the baileys session-id project's mega.js:
 *   const link = await upload(buffer, "file.json");
 *
 * Picks a random account from data/megaaccount.json, logs in,
 * uploads the buffer, and returns just the mega.nz link (string).
 */
async function upload(buffer, name) {
  const account = pickRandomAccount();

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
