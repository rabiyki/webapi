const express = require("express");
const router = express.Router();
const axios = require("axios");
const multer = require("multer");
const { CREATOR } = require("../config");
const { noCache, ax, ssAgent, safeDestroy } = require("../utils/http");
const { cacheBufferMedia } = require("../utils/cache");
const { removeBgViaMagicStudio } = require("../utils/magicstudioRemoveBg");
const { toOggOpus } = require("../utils/audioConvert");
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
// 🔄 MP3 -> OGG CONVERTER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

router.get("/api/tools/mp3toogg", async (req, res) => {
  noCache(res);
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({
      status: false, creator: CREATOR, message: "MP3 URL required"
    });

    const { buffer, contentType } = await toOggOpus(url);
    const proxy = cacheBufferMedia(req, buffer, contentType, ".ogg");

    res.json({
      status: "success",
      creator: CREATOR,
      result: {
        url: proxy
      }
    });
  } catch (err) {
    res.status(500).json({
      status: false, creator: CREATOR, message: err.message || "Failed to convert MP3 to OGG."
    });
  }
});

router.post("/api/tools/mp3toogg", upload.single("file"), async (req, res) => {
  noCache(res);
  try {
    if (!req.file) return res.status(400).json({
      status: false, creator: CREATOR, message: "MP3 file required"
    });

    const { buffer, contentType } = await toOggOpus(req.file.buffer);
    const proxy = cacheBufferMedia(req, buffer, contentType, ".ogg");

    res.json({
      status: "success",
      creator: CREATOR,
      result: {
        url: proxy
      }
    });
  } catch (err) {
    res.status(500).json({
      status: false, creator: CREATOR, message: err.message || "Failed to convert MP3 to OGG."
    });
  } finally {
    if (req.file) req.file.buffer = null;
  }
});






module.exports = router;
