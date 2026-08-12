const express = require("express");
const router = express.Router();
const { CREATOR } = require("../config");
const { noCache, ax } = require("../utils/http");
const { cacheMedia } = require("../utils/cache");

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📸 INSTAGRAM
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

router.get("/api/instagram", async (req, res) => {
  noCache(res);
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ status: false, creator: CREATOR });

    const { data } = await ax.get(
      `https://api-faa.my.id/faa/igdl?url=${encodeURIComponent(url)}`
    );

    const proxy = cacheMedia(req, data.result, ".mp4");

    res.json({ status: true, creator: CREATOR, url: proxy });
  } catch {
    res.json({ status: false, creator: CREATOR });
  }
});

router.get("/api/insta", async (req, res) => {
  noCache(res);
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ status: false, creator: CREATOR });

    const { data } = await ax.get(
      `https://api-aswin-sparky.koyeb.app/api/downloader/igdl?url=${encodeURIComponent(url)}`
    );

    const proxy = cacheMedia(req, data.data[0].url, ".mp4");
    const thumbnail = cacheMedia(req, data.data[0].thumbnail, ".jpg");

    res.json({
      status: true,
      creator: CREATOR,
      thumbnail,
      url: proxy
    });
  } catch {
    res.json({ status: false, creator: CREATOR });
  }
});

router.get("/api/insta2", async (req, res) => {
  noCache(res);
  try {
    const { url } = req.query;
    if (!url) return res.json({ status: false, creator: CREATOR });

    const { data } = await ax.get(
      `https://api-aswin-sparky.koyeb.app/api/downloader/igdl?url=${encodeURIComponent(url)}`
    );

    const fileExt = data.ext ? `.${data.ext}` : ".mp4";
    const proxy = cacheMedia(req, data.data[0].url, fileExt);
    const thumbnail = cacheMedia(req, data.data[0].thumbnail, ".jpg");

    res.json({
      status: true,
      creator: CREATOR,
      quality: data.quality,
      ext: data.ext,
      thumbnail,
      url: proxy
    });
  } catch (e) {
    res.json({ status: false, creator: CREATOR, error: e.message });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📘 FACEBOOK
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

router.get("/api/fb", async (req, res) => {
  noCache(res);
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ status: false, creator: CREATOR, message: "Facebook URL required" });

    const { data } = await ax.get(
      `https://api-aswin-sparky.koyeb.app/api/downloader/fbdl?url=${encodeURIComponent(url)}`,
      { timeout: 120000 }
    );

    const hd = cacheMedia(req, data?.data?.high || null, ".mp4");
    const sd = cacheMedia(req, data?.data?.low || null, ".mp4");

    res.json({
      status: true,
      creator: CREATOR,
      title: data?.data?.title || null,
      thumbnail: data?.data?.thumbnail || null,
      hd,
      sd
    });
  } catch (err) {
    res.status(500).json({ status: false, creator: CREATOR, message: err.message });
  }
});

router.get("/api/fb2", async (req, res) => {
  noCache(res);
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ status: false, creator: CREATOR });

    const { data } = await ax.get(
      `https://apiskeith.top/download/fbdown?url=${encodeURIComponent(url)}`
    );

    const proxy = cacheMedia(req, data.result, ".mp4");

    res.json({ status: true, creator: CREATOR, result: proxy });
  } catch {
    res.json({ status: false, creator: CREATOR });
  }
});

router.get("/api/fb3", async (req, res) => {
  noCache(res);
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ status: false, creator: CREATOR });

    const { data } = await ax.get(
      `https://rabbitapi.nett.to/api/fb?url=${encodeURIComponent(url)}`
    );

    const sd = cacheMedia(req, data.sd, ".mp4");
    const hd = cacheMedia(req, data.hd, ".mp4");

    res.json({ status: true, creator: CREATOR, sd, hd });
  } catch {
    res.json({ status: false, creator: CREATOR });
  }
});

router.get("/api/facebook", async (req, res) => {
  noCache(res);
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ status: false, creator: CREATOR });

    const { data } = await ax.get(
      `https://apis.davidcyril.name.ng/facebook2?url=${encodeURIComponent(url)}`
    );

    const proxy = cacheMedia(req, data.video, ".mp4");

    res.json({ status: true, creator: CREATOR, result: proxy });
  } catch {
    res.json({ status: false, creator: CREATOR });
  }
});

module.exports = router;
