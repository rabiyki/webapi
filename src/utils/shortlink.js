const path = require("path");
const Link = require("../models/Link");

// Avoids visually-confusing characters (0/O, 1/l/I)
const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

function randomCode(len = 5) {
  let code = "";
  for (let i = 0; i < len; i++) {
    code += CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  return code;
}

function extractExtension(url) {
  try {
    const { pathname } = new URL(url);
    const ext = path.extname(pathname); // e.g. ".mp4", ".jpg" — includes the dot
    return ext || "";
  } catch {
    return "";
  }
}

/**
 * Looks up a previously-uploaded file by its content hash.
 * Returns the existing short code if found, otherwise null.
 * Used to skip re-uploading duplicate files entirely.
 */
async function findExistingByHash(hash) {
  if (!hash) return null;
  const existing = await Link.findOne({ hash }).lean();
  return existing ? existing.code : null;
}

/**
 * Returns an existing "12hsy.mp4"-style filename for this URL if we've
 * shortened it before, otherwise generates a fresh unique one and stores it.
 *
 * The extension is taken from the real URL's path when it has one
 * (ar-hosting, catbox, etc.). Some backends (like mega.nz links) never
 * carry an extension in the URL itself — for those, pass fallbackExt
 * (usually derived from the originally uploaded file's name) so the
 * short link still ends in ".jpg", ".mp4", etc.
 *
 * hash (optional): the uploaded file's content hash — stored alongside
 * the link so future uploads of the same file can be detected via
 * findExistingByHash() instead of re-uploading to a backend.
 */
async function getOrCreateFilename(realUrl, fallbackExt = "", hash = null) {
  const existing = await Link.findOne({ url: realUrl }).lean();
  if (existing) return existing.code;

  const ext = extractExtension(realUrl) || fallbackExt || "";
  let filename;
  let attempts = 0;

  do {
    filename = randomCode(5) + ext;
    attempts++;
    if (attempts > 15) throw new Error("Could not generate a unique filename");
  } while (await Link.exists({ code: filename }));

  await Link.create({ code: filename, url: realUrl, hash: hash || undefined });
  return filename;
}

/**
 * Turns any external URL into "https://mydomain.com/12hsy.mp4"
 * fallbackExt (optional): e.g. ".jpg" — used when realUrl itself has no
 * extension in its path (mega.nz links are the main case for this).
 * hash (optional): content hash to store for future duplicate detection.
 */
async function shortenLink(req, realUrl, customName, fallbackExt = "", hash = null) {
  if (!realUrl) return null;

  const filename = await getOrCreateFilename(realUrl, fallbackExt, hash);
  const base = `${req.protocol}://${req.get("host")}`;
  return `${base}/${filename}`;
}

module.exports = { shortenLink, randomCode, findExistingByHash };
