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
 * Logs into a random Mega account and uploads the given buffer.
 * Returns { realUrl, size, type, uploaded }
 */
async function uploadFileToMega(file) {
  const account = pickRandomAccount();

  const storage = await new Storage({
    email: account.email,
    password: account.password,
    userAgent: "Mozilla/5.0"
  }).ready;

  try {
    const uploadedFile = await storage.upload({
      name: file.originalname,
      size: file.size
    }, file.buffer).complete;

    const link = await uploadedFile.link({ noKey: false });

    return {
      realUrl: link,
      size: file.size || null,
      type: file.mimetype || null,
      uploaded: new Date().toISOString()
    };
  } finally {
    // Always close the session so we don't leak open connections
    storage.close();
  }
}

module.exports = { uploadFileToMega, pickRandomAccount, loadAccounts };
