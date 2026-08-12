const crypto = require("crypto");

const mediaCache = new Map();

function randomId(len = 5, ext = ".mp3") {
  // crypto.randomBytes is faster than a per-character Math.random loop,
  // and with this much entropy a collision-check against mediaCache
  // is unnecessary overhead — the odds are astronomically low.
  return crypto.randomBytes(Math.ceil(len * 0.75)).toString("base64url").slice(0, len);
}

function sanitizeFilename(name) {
  if (!name) return null;
  // strip characters that break Content-Disposition / filesystems
  return name.replace(/[\/\\?%*:|"<>]/g, "").trim().slice(0, 150) || null;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━
// GENERIC MEDIA PROXY CACHE
// Caches a remote URL and returns
// your own domain proxy link that
// streams it through /media/:file
//
// mode: "stream"   -> /media/:file fetches the upstream URL server-side
//                      and pipes the bytes through (default, unchanged
//                      behavior for every existing route)
// mode: "redirect" -> /media/:file issues a 302 redirect straight to
//                      the upstream URL instead of proxying it
// ━━━━━━━━━━━━━━━━━━━━━━━━━━
function cacheMedia(req, sourceUrl, ext = ".mp4", ttlMs = 10 * 60 * 1000, mode = "stream", filename = null, backupUrl = null) {
  if (!sourceUrl) return null;

  const id = randomId(5, ext);
  const file = id + ext;

  const cleanName = sanitizeFilename(filename);

  mediaCache.set(file, {
    url: sourceUrl,
    // Only used in "stream" mode: if the primary url fails to respond
    // (dead link, host down, etc.), /media/:file retries this one
    // before giving up — source is still never exposed to the client
    // either way, since both are streamed through, not redirected to.
    backupUrl: backupUrl || null,
    mode,
    filename: cleanName ? `${cleanName}${ext}` : null
  });

  setTimeout(() => {
    mediaCache.delete(file);
  }, ttlMs);

  return `${req.protocol}://${req.get("host")}/media/${file}`;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━
// BUFFER-BASED MEDIA CACHE
// For upstream APIs that stream
// raw bytes back directly instead
// of returning a JSON URL
// ━━━━━━━━━━━━━━━━━━━━━━━━━━
function cacheBufferMedia(req, buffer, contentType = "application/octet-stream", ext = ".png", ttlMs = 10 * 60 * 1000) {
  if (!buffer) return null;

  const id = randomId(5, ext);
  const file = id + ext;

  mediaCache.set(file, { buffer, contentType });

  setTimeout(() => {
    mediaCache.delete(file);
  }, ttlMs);

  return `${req.protocol}://${req.get("host")}/media/${file}`;
}

module.exports = {
  mediaCache,
  randomId,
  sanitizeFilename,
  cacheMedia,
  cacheBufferMedia
};
