const express = require("express");
const router = express.Router();
const multer = require("multer");
const FormData = require("form-data");
const { CREATOR } = require("../config");
const { noCache, ax } = require("../utils/http");
const { shortenLink } = require("../utils/shortlink");
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
//    tried automatically. Only if ALL backends fail does the request fail.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Backends that accept a raw file upload
// ⚠️ TEMPORARY: shudhu mega test korar jonno onno providers off kora ache.
// Test sesh hole ei line ta age jemon chilo shei rokom revert kore dio:
// const FILE_PROVIDERS = ["ar-hosting", "cdnfile", "nekohime", "catbox", "mega"];
const FILE_PROVIDERS = ["mega"];

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

/**
 * Tries each provider (in random order) one by one.
 * Returns the first successful result. If every provider fails,
 * throws an error listing what went wrong on each one.
 */
async function tryProvidersInOrder(providers, handlers, arg) {
  const order = shuffle(providers);
  const errors = [];

  for (const provider of order) {
    try {
      const result = await handlers[provider](arg);
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

async function uploadFile(file) {
  const { result } = await tryProvidersInOrder(FILE_PROVIDERS, FILE_HANDLERS, file);
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

    if (req.file) {
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

    const shortUrl = await shortenLink(req, result.realUrl, customName);

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
    // All backends failed -> clean failure message, no internal details leaked
    return res.status(502).json({
      success: false,
      code: 502,
      creator: CREATOR,
      message: "Upload failed: all backend servers are currently unavailable. Please try again later."
    });
  } finally {
    if (req.file) req.file.buffer = null;
  }
});

module.exports = router;
