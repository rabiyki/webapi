const express = require("express");
const router = express.Router();
const axios = require("axios");
const multer = require("multer");
const { CREATOR } = require("../config");
const { noCache, ax, ssAgent, safeDestroy } = require("../utils/http");
const { cacheBufferMedia } = require("../utils/cache");
const { removeBgViaMagicStudio } = require("../utils/magicstudioRemoveBg");
const { removeBgViaDeekuude } = require("../utils/dRemoveBg");
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }
});

const { identifySong } = require("../utils/audd");

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🎵 SONG IDENTIFY
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

router.get("/api/tools/identify", async (req, res) => {
  noCache(res);
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({
      status: false, creator: CREATOR, message: "Media URL required"
    });

    const result = await identifySong(url);

    res.json({ status: "success", creator: CREATOR, result });
  } catch (err) {
    res.status(500).json({
      status: false, creator: CREATOR, message: err.message || "Failed to identify song."
    });
  }
});

router.post("/api/tools/identify", upload.single("file"), async (req, res) => {
  noCache(res);
  try {
    if (!req.file) return res.status(400).json({
      status: false, creator: CREATOR, message: "Audio/video file required"
    });

    const result = await identifySong(req.file.buffer, req.file.mimetype || "audio/mpeg");

    res.json({ status: "success", creator: CREATOR, result });
  } catch (err) {
    res.status(500).json({
      status: false, creator: CREATOR, message: err.message || "Failed to identify song."
    });
  } finally {
    if (req.file) req.file.buffer = null;
  }
});


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🌐 WEB SCREENSHOT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

router.get("/tool/webss", async (req, res) => {
  noCache(res);
  let stream;
  try {
    let { url, m } = req.query;
    if (!url) return res.status(400).json({ status: false, creator: CREATOR, message: "URL parameter required" });

    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    m = (m || "desktop").toLowerCase();

    const encodedUrl = encodeURIComponent(url);
    const api = m === "mobile"
      ? `https://jerrycoder.oggyapi.workers.dev/tool/ss?url=${encodedUrl}`
      : `https://jerrycoder.oggyapi.workers.dev/tool/fullss?url=${encodedUrl}`;

    const response = await axios({
      method: "GET",
      url: api,
      responseType: "stream",
      timeout: 30000,
      httpsAgent: ssAgent,
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    stream = response.data;

    res.setHeader("Content-Type", response.headers["content-type"] || "image/png");
    res.setHeader("Content-Disposition", "inline");
    noCache(res);

    stream.on("end",   () => safeDestroy(stream));
    stream.on("close", () => safeDestroy(stream));
    stream.on("error", () => safeDestroy(stream));

    req.on("close", () => safeDestroy(stream));
    res.on("finish", () => safeDestroy(stream));

    stream.pipe(res);
  } catch (e) {
    safeDestroy(stream);
    res.status(500).json({ status: false, creator: CREATOR, error: e.message });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🖼️ REMOVE BACKGROUND
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

router.get("/api/removebg", async (req, res) => {
  noCache(res);
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({
      status: false, creator: CREATOR, message: "Image URL required"
    });

    const { buffer, contentType } = await removeBgViaMagicStudio(url);
    const proxy = cacheBufferMedia(req, buffer, contentType, ".png");

    res.json({
      status: "success",
      creator: CREATOR,
      result: {
        url: proxy
      }
    });
  } catch (err) {
    res.status(500).json({
      status: false,
      creator: CREATOR,
      message: "Failed to remove background"
    });
  }
});

router.post("/api/removebg", upload.single("image"), async (req, res) => {
  noCache(res);
  try {
    if (!req.file) return res.status(400).json({
      status: false, creator: CREATOR, message: "Image file required"
    });

    const { buffer, contentType } = await removeBgViaMagicStudio(
      req.file.buffer,
      req.file.mimetype || "image/jpeg"
    );
    const proxy = cacheBufferMedia(req, buffer, contentType, ".png");

    res.json({
      status: "success",
      creator: CREATOR,
      result: {
        url: proxy
      }
    });
  } catch (err) {
    res.status(500).json({
      status: false,
      creator: CREATOR,
      message: "Failed to remove background"
    });
  } finally {
    if (req.file) req.file.buffer = null;
  }
});


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🖼️ REMOVE BACKGROUND (DEEKUUDE)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

router.get("/api/tools/undress", async (req, res) => {
  noCache(res);
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({
      status: false, creator: CREATOR, message: "Image URL required"
    });

    const { buffer, contentType } = await removeBgViaDeekuude(req, url);
    const proxy = cacheBufferMedia(req, buffer, contentType, ".png");

    res.json({
      status: "success",
      creator: CREATOR,
      result: {
        url: proxy
      }
    });
  } catch (err) {
    res.status(500).json({
      status: false,
      creator: CREATOR,
      message: "Failed to remove dress"
    });
  }
});

router.post("/api/tools/undress", upload.single("image"), async (req, res) => {
  noCache(res);
  try {
    if (!req.file) return res.status(400).json({
      status: false, creator: CREATOR, message: "Image file required"
    });

    const { buffer, contentType } = await removeBgViaDeekuude(
      req,
      req.file.buffer,
      req.file.mimetype || "image/jpeg"
    );
    const proxy = cacheBufferMedia(req, buffer, contentType, ".png");

    res.json({
      status: "success",
      creator: CREATOR,
      result: {
        url: proxy
      }
    });
  } catch (err) {
    res.status(500).json({
      status: false,
      creator: CREATOR,
      message: "Failed to remove background"
    });
  } finally {
    if (req.file) req.file.buffer = null;
  }
});



// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🎤 LYRICS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

router.get("/api/lyrics", async (req, res) => {
  noCache(res);
  try {
    const { song } = req.query;
    if (!song) return res.status(400).json({ status: false, creator: CREATOR });

    const { data } = await ax.get(
      `https://apis.davidcyril.name.ng/lyrics3?song=${encodeURIComponent(song)}`
    );

    res.json({ status: true, creator: CREATOR, result: data.result });
  } catch {
    res.json({ status: false, creator: CREATOR });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🎬 RANDOM LEAK VIDEO
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const GITHUB_MP4 = "https://raw.githubusercontent.com/xoo59568-art/newapi/refs/heads/main/database/leakvideo.json";

router.get("/api/leak/terabox", async (req, res) => {
  noCache(res);
  let stream;
  try {
    const json = req.query.json === "true";

    const { data } = await ax.get(GITHUB_MP4);

    if (!Array.isArray(data) || data.length === 0) return res.status(404).json({
      success: false, creator: CREATOR, message: "No video links found"
    });

    const random = data[Math.floor(Math.random() * data.length)];

    if (json) return res.json({ success: true, creator: CREATOR, result: { url: random } });

    const response = await axios({ url: random, method: "GET", responseType: "stream", timeout: 60000 });

    stream = response.data;

    res.setHeader("Content-Type", "video/mp4");
    noCache(res);

    stream.on("end",   () => safeDestroy(stream));
    stream.on("close", () => safeDestroy(stream));
    stream.on("error", () => safeDestroy(stream));

    req.on("close",   () => safeDestroy(stream));
    res.on("finish",  () => safeDestroy(stream));

    stream.pipe(res);
  } catch (e) {
    safeDestroy(stream);
    res.status(500).json({ success: false, creator: CREATOR, error: e.message });
  }
});

module.exports = router;
