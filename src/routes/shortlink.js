const express = require("express");
const router = express.Router();
const { CREATOR } = require("../config");
const { noCache } = require("../utils/http");
const { shortenLink } = require("../utils/shortlink");

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🐇 URL SHORTENER: /api/shorten
//    - GET  /api/shorten?url=...           -> random short code
//    - GET  /api/shorten?url=...&name=xyz  -> custom short code
//    - POST /api/shorten  (body: { url, name })  -> same, via JSON body
//
//    Just shortens an existing link — no file upload, no backend
//    hosting involved. Reuses the same short-link table (and the
//    same /:code proxy route) as file uploads, so both file links
//    and plain shortened URLs are served the same way.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function isValidUrl(str) {
  try {
    const u = new URL(str);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

router.all("/api/shorten", async (req, res) => {
  noCache(res);
  const url = req.query.url || (req.body && req.body.url);
  const customName = req.query.name || (req.body && req.body.name);

  if (!url) {
    return res.status(400).json({
      success: false,
      code: 400,
      creator: CREATOR,
      message: "Provide a ?url= parameter (or 'url' in the JSON body)"
    });
  }

  if (!isValidUrl(url)) {
    return res.status(400).json({
      success: false,
      code: 400,
      creator: CREATOR,
      message: "That doesn't look like a valid http(s) URL"
    });
  }

  if (customName && !/^[A-Za-z0-9_-]{3,32}$/.test(customName)) {
    return res.status(400).json({
      success: false,
      code: 400,
      creator: CREATOR,
      message: "Custom name must be 3-32 characters: letters, numbers, - or _ only"
    });
  }

  try {
    const shortUrl = await shortenLink(req, url, customName, "", null, "redirect");

    return res.json({
      success: true,
      code: 200,
      creator: CREATOR,
      result: {
        original: url,
        url: shortUrl,
        short: shortUrl
      }
    });
  } catch (e) {
    // Custom name taken, DB error, etc. — log detail server-side only.
    console.error("[shorten] failed:", e.message);

    const isTaken = /already taken/i.test(e.message);
    return res.status(isTaken ? 409 : 500).json({
      success: false,
      code: isTaken ? 409 : 500,
      creator: CREATOR,
      message: isTaken ? "That custom name is already taken" : "Could not shorten this link. Please try again."
    });
  }
});

module.exports = router;
