const express = require("express");
const router = express.Router();
const axios = require("axios");
const { File } = require("megajs"); // npm i megajs (already installed for mega.js)
const Link = require("../models/Link");
const { noCache, safeDestroy } = require("../utils/http");

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🐇 SHORT-LINK STREAM PROXY
//    Matches things like /12hsy.mp4, /aB3k9.jpg — 4-10 random chars
//    followed by a real extension, OR a plain code with no extension
//    (used by the /api/shorten URL shortener, e.g. /my-link).
//    Must be mounted LAST in app.js so it never shadows your other
//    page/API routes.
//
//    Mega.nz links can't be streamed with a plain HTTP GET (the file
//    is encrypted) — those go through megajs's File.download() instead.
//    Every other file backend still streams via plain axios, unchanged.
//
//    If the saved link is type "redirect" (made via /api/shorten),
//    we just 302-redirect to the real url instead of streaming —
//    file-upload links (type "file", the original/default behavior)
//    are completely unaffected by this.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const MEGA_URL_RE = /^https?:\/\/mega\.nz\/(file|#!)/i;

async function streamFromMega(url, req, res) {
  const file = File.fromURL(url);
  await file.loadAttributes(); // fetches name, size, etc. from Mega

  res.setHeader("Content-Type", "application/octet-stream");
  if (file.size) res.setHeader("Content-Length", file.size);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("x-rabbit-cdn", "RabbitX Edge");

  if (req.query.download) {
    res.setHeader("Content-Disposition", `attachment; filename="${file.name || req.params.code}"`);
  }

  const stream = file.download();

  stream.on("end",   () => safeDestroy(stream));
  stream.on("close", () => safeDestroy(stream));
  stream.on("error", () => safeDestroy(stream));
  req.on("close",    () => safeDestroy(stream));
  res.on("finish",   () => safeDestroy(stream));

  stream.pipe(res);
}

async function streamFromHttp(url, req, res) {
  const response = await axios({
    url,
    method: "GET",
    responseType: "stream",
    timeout: 30000,
    headers: { "User-Agent": "Mozilla/5.0" }
  });

  const stream = response.data;

  if (response.headers["content-type"])   res.setHeader("Content-Type", response.headers["content-type"]);
  if (response.headers["content-length"]) res.setHeader("Content-Length", response.headers["content-length"]);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("x-rabbit-cdn", "RabbitX Edge");

  if (req.query.download) {
    res.setHeader("Content-Disposition", `attachment; filename="${req.params.code}"`);
  }

  stream.on("end",   () => safeDestroy(stream));
  stream.on("close", () => safeDestroy(stream));
  stream.on("error", () => safeDestroy(stream));
  req.on("close",    () => safeDestroy(stream));
  res.on("finish",   () => safeDestroy(stream));

  stream.pipe(res);
}

router.get("/:code([A-Za-z0-9_-]{3,32}(?:\\.[A-Za-z0-9]{2,5})?)", async (req, res) => {
  noCache(res);

  try {
    const link = await Link.findOneAndUpdate(
      { code: req.params.code },
      { $inc: { hits: 1 } }
    );

    // Nothing saved under this name -> nothing is served. No fallback fetch.
    if (!link) {
      return res.status(404).json({ status: false, message: "File not found" });
    }

    // Plain URL-shortener link -> just redirect, don't stream/proxy anything.
    if (link.type === "redirect") {
      return res.redirect(302, link.url);
    }

    // Everything below is the original, unchanged file-streaming behavior.
    if (MEGA_URL_RE.test(link.url)) {
      await streamFromMega(link.url, req, res);
    } else {
      await streamFromHttp(link.url, req, res);
    }
  } catch (e) {
    res.status(404).json({ status: false, message: "File not found" });
  }
});

module.exports = router;
