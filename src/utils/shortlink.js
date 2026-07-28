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
 * customName (optional): a user-requested code (e.g. "my-link" for
 * plain URL shortening). If given and free, it's used as-is (no
 * extension appended). If already taken by a DIFFERENT url, throws.
 * If it already points to the SAME url, that's returned as-is (idempotent).
 *
 * fallbackExt (optional): used only when generating a RANDOM code and
 * the real URL's path has no extension of its own (e.g. mega.nz links).
 *
 * hash (optional): the uploaded file's content hash — stored alongside
 * the link so future uploads of the same file can be detected via
 * findExistingByHash() instead of re-uploading to a backend.
 *
 * type (optional): "file" (default) = old behavior, proxy.js streams
 * the content. "redirect" = proxy.js just 302-redirects to the real url
 * (used by the plain /api/shorten URL shortener).
 */
async function getOrCreateFilename(realUrl, fallbackExt = "", hash = null, customName = null, type = "file") {
  const existing = await Link.findOne({ url: realUrl }).lean();
  if (existing && !customName) return existing.code;

  if (customName) {
    const taken = await Link.findOne({ code: customName }).lean();
    if (taken) {
      if (taken.url === realUrl) return taken.code; // already points here, fine
      throw new Error("That custom name is already taken");
    }
    await Link.create({ code: customName, url: realUrl, hash: hash || undefined, type });
    return customName;
  }

  const ext = extractExtension(realUrl) || fallbackExt || "";
  let filename;
  let attempts = 0;

  do {
    filename = randomCode(5) + ext;
    attempts++;
    if (attempts > 15) throw new Error("Could not generate a unique filename");
  } while (await Link.exists({ code: filename }));

  await Link.create({ code: filename, url: realUrl, hash: hash || undefined, type });
  return filename;
}

/**
 * Turns any external URL into "https://mydomain.com/12hsy.mp4"
 * (or "https://mydomain.com/my-name" if customName is given).
 * type: "file" (default, streams via proxy — unchanged old behavior)
 *       or "redirect" (proxy.js sends a 302 to the real url instead).
 */
async function shortenLink(req, realUrl, customName, fallbackExt = "", hash = null, type = "file") {
  if (!realUrl) return null;

  const filename = await getOrCreateFilename(realUrl, fallbackExt, hash, customName || null, type);
  const base = `${req.protocol}://${req.get("host")}`;
  return `${base}/${filename}`;
}

module.exports = { shortenLink, randomCode, findExistingByHash };
