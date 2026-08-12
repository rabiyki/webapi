const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const crypto = require("crypto");
const FormData = require("form-data");
const { CREATOR } = require("../config");
const { noCache, ax, safeDestroy } = require("../utils/http");
const { shortenLink, findExistingByHash } = require("../utils/shortlink");
const { uploadFileToMega } = require("../utils/mega");

const upload = multer({
  storage: multer.memoryStorage()
  // no fileSize limit — memoryStorage bhoroshai boro file hole RAM usage barbe,
  // tai server er RAM onujayi target koto boro file expect kora jai eita mathay rakhte hobe
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🐇 THE ONLY UPLOAD ENDPOINT: /api/upload
//    - POST /api/upload  (multipart "file" field)  -> random hosting backend
//    - GET  /api/upload?url=...                    -> upload-from-url
//    - POST /api/upload  (body: { url })           -> upload-from-url
//    Response never reveals which backend was used. Every link returned
//    is a short "/xxxxx.ext" URL streamed live by proxy.js — no redirect.
//
//    Backend selection: random order, with automatic fallback — if the
//    picked backend throws/fails, the next one in the shuffled order is
//    tried automatically. Only if ALL backends fail does the request fail,
//    and even then the client only ever sees a generic message — never
//    which backends exist or why any of them failed (that detail is only
//    logged server-side, never sent in the response).
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const MEGA_URL_RE = /^https?:\/\/mega\.nz\/(file|#!)/i;

// Backends that accept a raw file upload
const FILE_PROVIDERS = ["ar-hosting", "cdnfile", "nekohime", "catbox", "mega"];

// Backends that can fetch a remote URL on our behalf
const URL_PROVIDERS = ["ar-hosting", "catbox"];

// Fisher-Yates shuffle — returns a new array, doesn't mutate the original
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function uploadFileToArHosting(file) {
  const form = new FormData();
  form.append("file", file.buffer, { filename: file.originalname, contentType: file.mimetype });

  const { data } = await ax.post("https://ar-hosting.pages.dev/upload", form, {
    headers: { ...form.getHeaders() },
    timeout: 120000,
    maxBodyLength: Infinity
  });

  return {
    realUrl: data.url,
    size: data.size,
    type: data.media_type,
    uploaded: data.uploaded_on
  };
}

async function uploadFileToCdnfile(file) {
  const form = new FormData();
  form.append("file", file.buffer, file.originalname);

  const { data } = await ax.post("https://cdnfile.pages.dev/upload", form, {
    headers: form.getHeaders(),
    maxBodyLength: Infinity
  });

  return {
    realUrl: data.url,
    size: file.size || null,
    type: file.mimetype || null,
    uploaded: new Date().toISOString()
  };
}

async function uploadFileToNekohime(file) {
  const form = new FormData();
  form.append("file", file.buffer, file.originalname);

  const { data } = await ax.post("https://cdn.nekohime.site/upload", form, {
    headers: form.getHeaders(),
    timeout: 60000,
    maxBodyLength: Infinity
  });

  const uploaded = data?.files?.[0];
  if (!uploaded?.url) throw new Error("Nekohime upload failed");

  return {
    realUrl: uploaded.url,
    size: file.size || null,
    type: file.mimetype || null,
    uploaded: new Date().toISOString()
  };
}

async function uploadFileToCatbox(file) {
  const form = new FormData();
  form.append("reqtype", "fileupload");
  form.append("fileToUpload", file.buffer, file.originalname);

  const { data } = await ax.post("https://catbox.moe/user/api.php", form, {
    headers: form.getHeaders(),
    timeout: 60000,
    maxBodyLength: Infinity
  });

  const realUrl = typeof data === "string" ? data.trim() : "";
  if (!realUrl.startsWith("http")) throw new Error("Catbox upload failed: " + realUrl);

  return {
    realUrl,
    size: file.size || null,
    type: file.mimetype || null,
    uploaded: new Date().toISOString()
  };
}

async function uploadUrlToArHosting(url) {
  const { data } = await ax.get(`https://ar-hosting.pages.dev/hosturl?url=${encodeURIComponent(url)}`);
  return {
    realUrl: data.url,
    size: data.size,
    type: data.media_type,
    uploaded: data.uploaded_on
  };
}

async function uploadUrlToCatbox(url) {
  const form = new FormData();
  form.append("reqtype", "urlupload");
  form.append("url", url);

  const { data } = await ax.post("https://catbox.moe/user/api.php", form, {
    headers: form.getHeaders(),
    timeout: 60000
  });

  const realUrl = typeof data === "string" ? data.trim() : "";
  if (!realUrl.startsWith("http")) throw new Error("Catbox url-upload failed: " + realUrl);

  return { realUrl, size: null, type: null, uploaded: new Date().toISOString() };
}

const FILE_HANDLERS = {
  "ar-hosting": uploadFileToArHosting,
  "cdnfile": uploadFileToCdnfile,
  "nekohime": uploadFileToNekohime,
  "catbox": uploadFileToCatbox,
  "mega": uploadFileToMega
};

const URL_HANDLERS = {
  "ar-hosting": uploadUrlToArHosting,
  "catbox": uploadUrlToCatbox
};

// Categories we actually check for a mismatch. Anything outside this
// set (e.g. "application/zip") is left alone — too many legit hosts
// respond with a generic/unrelated content-type for uncommon files.
const CHECKED_TYPE_CATEGORIES = ["image", "video", "audio"];

/**
 * Some backends (especially image-oriented file hosts) return a
 * "success" response with a URL even when that URL doesn't actually
 * serve the uploaded file — e.g. an audio/video upload gets silently
 * rejected or purged, but the link they hand back still resolves to
 * something (their own placeholder/error image, a different cached
 * file, etc). A plain reachability check misses this entirely.
 *
 * So on top of "does the URL respond", this also confirms the
 * response's real Content-Type is in the same category (image/video/
 * audio) as what was uploaded — e.g. upload a video, get back a link
 * that serves a jpeg -> treated as a failure, not a success.
 *
 * expectedTypePrefix: "image" | "video" | "audio" | ... (from the
 * uploaded file's mimetype, before the "/"). Pass null/undefined to
 * skip the category check (used for upload-by-url, where we don't
 * know what type to expect ahead of time).
 *
 * mega.nz links are skipped entirely (encrypted, can't HEAD/GET them
 * for a content-type; proxy.js streams those via the megajs SDK,
 * which reads the true type from Mega's own file attributes instead).
 */
async function verifyUrlMatchesUpload(url, expectedTypePrefix) {
  if (MEGA_URL_RE.test(url)) return { ok: true };

  const categoryMismatch = (contentType) => {
    if (!expectedTypePrefix || !contentType) return false;
    const actualPrefix = contentType.split("/")[0].toLowerCase().trim();
    if (!CHECKED_TYPE_CATEGORIES.includes(actualPrefix)) return false; // unrelated/generic type, don't block on it
    return actualPrefix !== expectedTypePrefix.toLowerCase().trim();
  };

  try {
    const res = await ax.head(url, { timeout: 15000, validateStatus: () => true });
    if (res.status >= 200 && res.status < 400) {
      const contentType = res.headers["content-type"];
      if (categoryMismatch(contentType)) {
        return { ok: false, reason: `expected ${expectedTypePrefix}/*, got ${contentType}` };
      }
      return { ok: true };
    }
  } catch (_) {
    // HEAD unsupported/blocked by some hosts — fall back to a ranged GET below
  }

  try {
    const res = await ax.get(url, {
      timeout: 15000,
      responseType: "stream",
      headers: { Range: "bytes=0-0" },
      validateStatus: () => true
    });
    safeDestroy(res.data);
    if (res.status < 200 || res.status >= 400) return { ok: false, reason: `status ${res.status}` };

    const contentType = res.headers["content-type"];
    if (categoryMismatch(contentType)) {
      return { ok: false, reason: `expected ${expectedTypePrefix}/*, got ${contentType}` };
    }
    return { ok: true };
  } catch (_) {
    return { ok: false, reason: "unreachable" };
  }
}

/**
 * Tries each provider (in random order) one by one.
 * Returns the first successful result whose URL actually resolves
 * AND actually serves the right kind of file (see
 * verifyUrlMatchesUpload above). If every provider fails, throws an
 * error listing what went wrong on each one — this detail is for
 * server logs only, it never reaches the HTTP response.
 */
async function tryProvidersInOrder(providers, handlers, arg, expectedTypePrefix = null) {
  const order = shuffle(providers);
  const errors = [];

  for (const provider of order) {
    try {
      const result = await handlers[provider](arg);

      const check = await verifyUrlMatchesUpload(result.realUrl, expectedTypePrefix);
      if (!check.ok) {
        errors.push(`${provider}: ${check.reason}`);
        continue;
      }

      return { result, provider };
    } catch (e) {
      errors.push(`${provider}: ${e.message}`);
    }
  }

  const err = new Error(
    `All upload backends failed (tried ${order.join(", ")}) -> ${errors.join(" | ")}`
  );
  err.allFailed = true;
  throw err;
}

// Files at or above this size skip the other backends entirely and go
// straight to mega (the other backends tend to reject/choke on big files).
const LARGE_FILE_THRESHOLD = 30 * 1024 * 1024; // 30MB

async function uploadFile(file) {
  const providers = (file.size && file.size > LARGE_FILE_THRESHOLD)
    ? ["mega"]
    : FILE_PROVIDERS;

  const expectedTypePrefix = file.mimetype ? file.mimetype.split("/")[0] : null;
  const { result } = await tryProvidersInOrder(providers, FILE_HANDLERS, file, expectedTypePrefix);
  return result;
}

async function uploadUrl(url) {
  const { result } = await tryProvidersInOrder(URL_PROVIDERS, URL_HANDLERS, url);
  return result;
}

router.all("/api/upload", upload.single("file"), async (req, res) => {
  noCache(res);
  const url = req.query.url || (req.body && req.body.url);
  const customName = req.query.name || (req.body && req.body.name);

  try {
    let result;
    let fileHash = null;

    if (req.file) {
      // Duplicate detection: same file content -> same short link,
      // no re-upload to any backend needed.
      fileHash = crypto.createHash("sha256").update(req.file.buffer).digest("hex");
      const existingCode = await findExistingByHash(fileHash);

      if (existingCode) {
        const base = `${req.protocol}://${req.get("host")}`;
        const shortUrl = `${base}/${existingCode}`;
        return res.json({
          success: true,
          code: 200,
          creator: CREATOR,
          result: {
            size: req.file.size || null,
            type: req.file.mimetype || null,
            uploaded: new Date().toISOString(),
            url: shortUrl,
            cdn: shortUrl
          }
        });
      }

      result = await uploadFile(req.file);
    } else if (url) {
      result = await uploadUrl(url);
    } else {
      return res.status(400).json({
        success: false,
        code: 400,
        creator: CREATOR,
        message: "Provide a file (multipart 'file' field) or a ?url= parameter"
      });
    }

    // File uploads: keep the short link's extension consistent with the
    // original filename (some backends, like mega.nz, don't carry an
    // extension in their own URL, so this fallback keeps ".jpg"/".mp4"/etc.
    // showing up correctly on the short link either way).
    const fallbackExt = req.file ? path.extname(req.file.originalname || "") : "";
    const shortUrl = await shortenLink(req, result.realUrl, customName, fallbackExt, fileHash);

    return res.json({
      success: true,
      code: 200,
      creator: CREATOR,
      result: {
        size: result.size,
        type: result.type,
        uploaded: result.uploaded,
        url: shortUrl,
        cdn: shortUrl
      }
    });

  } catch (e) {
    // Log the real reason server-side only (which backends were tried,
    // why each one failed) — the client only ever sees a clean, generic
    // message. Nothing about internal providers or their errors leaks out.
    console.error("[upload] all backends failed:", e.message);

    return res.status(502).json({
      success: false,
      code: 502,
      creator: CREATOR,
      message: "Upload failed. Please try again in a moment."
    });
  } finally {
    if (req.file) req.file.buffer = null;
  }
});

module.exports = router;
